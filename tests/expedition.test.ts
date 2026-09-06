import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,building,newState} from '../src/simulation';
import {CELL,SITES,CRAFTS,canAfford,type Kind} from '../src/data';
import {applyAction,isAction,validMove} from '../src/protocol';

const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*10);i++)sim.tick(.1);};
function atSite(sim:Simulation,id:string){const p=SITES.find(p=>p.id===id)!;sim.state.player={x:p.x*CELL,z:(p.z+1)*CELL};sim.discover();return p;}
function put(sim:Simulation,kind:Kind,x:number,z:number){const b=building(kind,x,z,0,sim.state.nextId++);sim.state.buildings.push(b);sim.reindex();return b;}

test('mining enforces proximity, discovery, cooldown, tool requirement and finite reserves',()=>{
  const sim=new Simulation();assert.match(sim.gather(),/Walk near/);
  const coal=atSite(sim,'coal-west');assert.ok(sim.state.discovered.includes(coal.id));
  assert.match(sim.gather(),/Mined 5 coal/);assert.equal(sim.state.inventory.coal,5);assert.equal(sim.state.deposits[coal.id],coal.amount-5);
  sim.gather();assert.equal(sim.state.inventory.coal,5);
  advance(sim,1.1);sim.state.deposits[coal.id]=2;sim.gather();assert.equal(sim.state.inventory.coal,7);assert.equal(sim.state.deposits[coal.id],0);
  advance(sim,1.1);assert.match(sim.gather(coal.id),/exhausted/);
  atSite(sim,'crystal-north');assert.match(sim.gather(),/steel pickaxe/);assert.equal(sim.state.inventory.crystal,undefined);
});

test('earned frontier supplies reach the steel pickaxe and aether engine without a circular dependency',()=>{
  const sim=new Simulation();
  atSite(sim,'coal-west');for(let i=0;i<8;i++){sim.gather();advance(sim,1.1);}
  atSite(sim,'copper-east');for(let i=0;i<8;i++){sim.gather();advance(sim,1.1);}
  atSite(sim,'east-iron');for(let i=0;i<8;i++){sim.gather();advance(sim,1.1);}
  for(let i=0;i<30;i++)assert.match(sim.craft('ingot'),/Crafted/);
  for(let i=0;i<11;i++)assert.match(sim.craft('steel'),/Crafted/);
  assert.match(sim.craft('pickaxe'),/Crafted/);assert.equal(sim.state.inventory.pickaxe,1);
  const before=structuredClone(sim.state.inventory);sim.craft('pickaxe');assert.deepEqual(sim.state.inventory,before);
  atSite(sim,'crystal-north');for(let i=0;i<5;i++){sim.gather();advance(sim,1.1);}
  for(let i=0;i<3;i++)assert.match(sim.craft('circuit'),/Crafted/);
  for(let i=0;i<4;i++)sim.craft('gear');
  sim.state.player={x:0,z:2*CELL};const engine=sim.place('resonator',0,0,0);assert.notEqual(typeof engine,'string');
  if(typeof engine==='string')throw new Error(engine);sim.feed(engine);advance(sim,1);assert.equal(sim.generation(engine),96);
  assert.ok(!canAfford({},CRAFTS.pickaxe.cost));
});

test('fuel engines power connected loads, accept conveyor fuel, and stop when fuel runs out',()=>{
  const state=newState();state.buildings=[];const sim=new Simulation(state);
  const steam=put(sim,'steam',0,0),furnace=put(sim,'furnace',2,0);furnace.input={ore:8};
  advance(sim,1);assert.equal(furnace.power,0);assert.equal(steam.status,'Needs fuel');
  steam.input={coal:1};advance(sim,.1);assert.equal(sim.supply,72);assert.equal(furnace.power,1);
  const restored=Simulation.restore(sim.serialize());advance(sim,20.2);advance(restored,20.2);assert.deepEqual(sim.state,restored.state);
  assert.equal(sim.supply,0);assert.equal(furnace.power,0);assert.equal(steam.input.coal,0);
  const chest=put(sim,'storage',-1,0);chest.input={coal:2};advance(sim,3);assert.equal(sim.supply,72);assert.ok(steam.fuelRemaining>0);
});

test('drills extract their actual mineral, conserve last reserves, and refund interrupted extraction',()=>{
  const state=newState();state.buildings=[];state.inventory.pickaxe=1;const sim=new Simulation(state);
  const site=atSite(sim,'copper-east');sim.state.deposits[site.id]=2;
  const drill=put(sim,'quarry',site.x,site.z);put(sim,'windmill',site.x-2,site.z);
  advance(sim,1);assert.equal(sim.state.deposits[site.id],1);sim.dismantle(drill.id);assert.equal(sim.state.deposits[site.id],2);
  const second=put(sim,'quarry',site.x,site.z);advance(sim,10);assert.equal(second.output.copper,2);assert.equal(second.output.coal,undefined);assert.equal(second.status,'Deposit exhausted');assert.equal(sim.state.deposits[site.id],0);
});

test('legacy saves migrate and malformed exploration/fuel data is rejected',()=>{
  const sim=new Simulation();put(sim,'windmill',0,0);put(sim,'lumber',-6,2);put(sim,'depot',7,0);
  const legacy=JSON.parse(sim.serialize());delete legacy.deposits;delete legacy.discovered;delete legacy.miningReady;for(const b of legacy.buildings)delete b.fuelRemaining;
  const restored=Simulation.restore(JSON.stringify(legacy));assert.equal(restored.state.deposits['coal-west'],900);assert.equal(restored.state.buildings.length,legacy.buildings.length);
  const invalid=JSON.parse(restored.serialize());invalid.deposits['coal-west']=-1;assert.throws(()=>Simulation.restore(JSON.stringify(invalid)));
  const badFuel=JSON.parse(restored.serialize());badFuel.buildings[0].fuelRemaining=Infinity;assert.throws(()=>Simulation.restore(JSON.stringify(badFuel)));
});

test('server action validation rejects malformed and privileged commands; shared spending is atomic',()=>{
  for(const a of [{type:'place',kind:'unknown',x:0,z:0,dir:0},{type:'place',kind:'storage',x:NaN,z:0,dir:0},{type:'craft',recipe:'__proto__'},{type:'rotate',id:1,dir:99},{type:'import',state:{}},null])assert.equal(isAction(a),false);
  const sim=new Simulation();sim.state.inventory={log:8};
  assert.match(applyAction(sim,{type:'place',kind:'storage',x:0,z:0,dir:0}),/Built/);
  assert.match(applyAction(sim,{type:'place',kind:'storage',x:1,z:0,dir:0}),/materials/);assert.equal(sim.state.inventory.log,0);
});

test('movement validation rejects teleports, off-island coordinates and tunneling through machines',()=>{
  const state=newState();state.buildings=[];const sim=new Simulation(state);
  assert.equal(validMove(sim,{x:0,z:0},{x:.7,z:0},.1),true);
  assert.equal(validMove(sim,{x:0,z:0},{x:10,z:0},.1),false);
  assert.equal(validMove(sim,{x:0,z:0},{x:Infinity,z:0},.1),false);
  put(sim,'storage',0,0);assert.equal(validMove(sim,{x:-2,z:0},{x:2,z:0},.5),false);
});
