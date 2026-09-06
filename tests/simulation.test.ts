import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, building, isStopped, newState } from '../src/simulation';
import { CELL, DEFS, total, type Kind } from '../src/data';

const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*10);i++)sim.tick(.1);};
function empty(){const s=newState();s.buildings=[];return new Simulation(s);}
function put(sim:Simulation,kind:Kind,x:number,z:number,dir=0){const b=building(kind,x,z,dir,sim.state.nextId++);sim.state.buildings.push(b);sim.reindex();return b;}
function build(sim:Simulation,kind:Kind,x:number,z:number,dir=0){
  // Clear any newly interactive scenery through ordinary, targeted gathering.
  for(const node of sim.scenery.filter(n=>sim.overlapsScenery(n,x,z)&&sim.sceneryVisible(n))){
    if(['lumber','mine','quarry'].includes(kind)&&node.siteId===sim.siteAt(x,z)?.id)continue;
    sim.state.player={x:node.x+node.radius+.5,z:node.z};
    while(sim.sceneryVisible(node)){advance(sim,1.1);sim.gather(node.id);}
  }
  sim.state.player={x:x*CELL,z:(z+2)*CELL};const b=sim.place(kind,x,z,dir);assert.notEqual(typeof b,'string',String(b));return b as ReturnType<typeof building>;
}
function workshop(){
  const sim=new Simulation();
  sim.state.player={x:-6*CELL,z:3*CELL};
  for(let i=0;i<2;i++){sim.gather();advance(sim,1.1);}
  build(sim,'lumber',-6,2);build(sim,'windmill',-4,-1);build(sim,'sawmill',-2,2);
  build(sim,'mine',-6,-3);build(sim,'furnace',-2,-3);
  for(const z of [2,-3]){for(const x of [-5,-4,-3,-1,0,1])build(sim,'conveyor',x,z);build(sim,'storage',2,z);}
  build(sim,'post',0,-1);return sim;
}

test('new expeditions remain completely unbuilt until the player constructs something',()=>{
  const sim=new Simulation(),before=structuredClone(sim.state.inventory);advance(sim,90);
  assert.deepEqual(sim.state.buildings,[]);assert.deepEqual(sim.state.produced,{});
  assert.deepEqual(sim.state.inventory,before);assert.equal(sim.state.unlock,0);assert.equal(sim.supply,0);assert.equal(sim.state.built,0);assert.equal(sim.state.nextId,1);
  assert.deepEqual(Simulation.restore(sim.serialize()).state.buildings,[]);
});

test('a player-built workshop produces planks and ingots without manual feeding',()=>{
  const sim=workshop();advance(sim,90);
  assert.ok((sim.state.produced.ingot||0)>=10);assert.ok((sim.state.produced.plank||0)>10);assert.equal(sim.state.unlock,1);
  assert.ok(total(sim.at(2,-3)!.input)>0);assert.ok(total(sim.at(2,2)!.input)>0);
});

test('missing input and power cannot create goods; a blocked output conserves the batch',()=>{
  const sim=empty(),f=put(sim,'furnace',0,0);advance(sim,20);assert.equal(f.produced,0);assert.equal(f.status,'Insufficient power');
  put(sim,'windmill',0,2);advance(sim,20);assert.equal(f.produced,0);assert.equal(f.status,'Needs input');
  f.input={ore:2};f.output={ingot:12};advance(sim,20);assert.equal(f.input.ore,2);assert.equal(f.status,'Output blocked');
  f.output={};advance(sim,4);assert.equal(f.input.ore,0);assert.equal(f.output.ingot,1);assert.equal(f.produced,1);
});

test('stopped indicators distinguish faults from healthy idle and reduced-speed machinery',()=>{
  const belt=building('conveyor',0,0,0,1);assert.equal(isStopped(belt),false);
  belt.item='gear';belt.status='Output blocked';assert.equal(isStopped(belt),true);
  const furnace=building('furnace',1,0,0,2);furnace.status='Insufficient power';furnace.power=.75;assert.equal(isStopped(furnace),false);
  furnace.power=0;assert.equal(isStopped(furnace),true);
  furnace.status='Needs input';assert.equal(isStopped(furnace),true);
  const storage=building('storage',2,0,0,3);storage.status='Output blocked';assert.equal(isStopped(storage),false);
});

test('belt travel never duplicates goods and full storage creates backpressure',()=>{
  const sim=empty();const start=put(sim,'storage',-3,0);start.input={gear:12};
  for(let x=-2;x<=2;x++)put(sim,'conveyor',x,0);
  const end=put(sim,'storage',3,0);end.input={gear:100};advance(sim,30);
  const count=()=>sim.state.buildings.reduce((n,b)=>n+total(b.input)+total(b.output)+(b.item?1:0),0);
  assert.equal(count(),112);assert.equal(total(end.input),100);assert.ok(sim.state.buildings.some(b=>b.item));
  end.input={};advance(sim,90);assert.equal(count(),12);assert.equal(total(end.input),12);
});

test('splitter shares goods and merger arbitrates competing inputs',()=>{
  const sim=empty(),source=put(sim,'storage',-1,0);source.input={gear:30};
  put(sim,'splitter',0,0);const targets=[put(sim,'storage',1,0,0),put(sim,'storage',0,1,1),put(sim,'storage',0,-1,3)];
  advance(sim,90);const counts=targets.map(t=>total(t.input));assert.equal(counts.reduce((a,b)=>a+b,0),30);assert.ok(Math.max(...counts)-Math.min(...counts)<=1,counts.toString());
  const merged=empty();const a=put(merged,'storage',-1,0,0),b=put(merged,'storage',0,-1,1);a.input={gear:8};b.input={ingot:8};put(merged,'merger',0,0);const dest=put(merged,'storage',1,0);advance(merged,12);
  assert.ok((dest.input.gear||0)>0);assert.ok((dest.input.ingot||0)>0);
});

test('power networks isolate disconnected loads and proportionally slow overloaded machines',()=>{
  const sim=empty();put(sim,'windmill',-5,0);const post=put(sim,'post',0,0);const far=put(sim,'furnace',4,0);assert.equal(far.power,1);
  sim.state.buildings=sim.state.buildings.filter(b=>b.id!==post.id);sim.reindex();assert.equal(far.power,0);
  const overloaded=empty();put(overloaded,'windmill',0,0);for(let i=0;i<8;i++){const a=i*Math.PI/4;put(overloaded,'furnace',Math.round(Math.sin(a)*3),Math.round(Math.cos(a)*3));}
  assert.equal(overloaded.demand,32);assert.ok(overloaded.state.buildings.filter(b=>b.kind==='furnace').every(b=>b.power===.375));
});

test('placement rejects occupied cells, invalid resources, locked machinery and insufficient funds',()=>{
  const sim=new Simulation();build(sim,'mine',-6,-3);const before=JSON.stringify(sim.state.inventory);
  assert.equal(typeof sim.place('storage',-6,-3,0),'string');assert.equal(typeof sim.place('mine',0,0,0),'string');assert.equal(typeof sim.place('assembler',0,0,0),'string');
  assert.equal(typeof sim.place('storage',30,30,0),'string');assert.equal(JSON.stringify(sim.state.inventory),before);
  sim.state.inventory={};assert.equal(typeof sim.place('storage',0,0,0),'string');
});

test('dismantling returns construction costs, buffers and reserved batch ingredients',()=>{
  const sim=empty();put(sim,'windmill',0,2);const f=build(sim,'furnace',0,0);f.input={ore:2};advance(sim,1);assert.equal(f.active,true);assert.equal(f.input.ore,0);
  const before=structuredClone(sim.state.inventory);sim.dismantle(f.id);
  assert.equal(sim.state.inventory.ore,(before.ore||0)+(DEFS.furnace.cost.ore||0)+2);
  assert.equal(sim.state.inventory.log,(before.log||0)+(DEFS.furnace.cost.log||0));
});

test('save/load during transport and processing preserves deterministic production',()=>{
  const a=workshop();advance(a,17.3);const b=Simulation.restore(a.serialize());advance(a,90);advance(b,90);
  assert.deepEqual(a.state,b.state);
  assert.throws(()=>Simulation.restore('{"version":99}'));
  const bad=JSON.parse(a.serialize());bad.buildings[0].output={ore:-1};assert.throws(()=>Simulation.restore(JSON.stringify(bad)));
  const unsafe=JSON.parse(a.serialize());unsafe.buildings[0].status='<img src=x onerror=alert(1)>';assert.throws(()=>Simulation.restore(JSON.stringify(unsafe)));
  const invalidProgress=JSON.parse(a.serialize());invalidProgress.buildings[0].progress='not a number';assert.throws(()=>Simulation.restore(JSON.stringify(invalidProgress)));
});

test('assembly reserves input capacity for both ingredients under an oversupplied gear line',()=>{
  const sim=empty();put(sim,'windmill',0,2);const a=put(sim,'assembler',0,0);const gears=put(sim,'storage',-1,0);gears.input={gear:40};
  advance(sim,30);assert.equal(a.input.gear,4);assert.equal(a.produced,0);
  const planks=put(sim,'storage',0,-1,1);planks.input={plank:30};advance(sim,60);assert.ok(a.produced>=8);assert.ok((a.input.gear||0)<=4);
});

test('a fresh workshop earns the guild commission and permanent throughput mastery using earned materials',()=>{
  const sim=workshop();advance(sim,90);assert.equal(sim.state.unlock,1);
  sim.state.player={x:2*CELL,z:-CELL};sim.dismantle(sim.at(2,-3)!.id);
  build(sim,'press',2,-3);build(sim,'post',3,-1);
  advance(sim,90);assert.equal(sim.state.unlock,2);
  sim.state.player={x:2*CELL,z:4*CELL};sim.dismantle(sim.at(2,2)!.id);
  build(sim,'assembler',5,1);
  sim.state.player={x:-6*CELL,z:3*CELL};sim.collect(sim.at(-6,2)!);
  advance(sim,60);sim.collect(sim.at(-6,2)!);
  build(sim,'windmill',3,4); // Assembly expands beyond the starter windmill's capacity.
  build(sim,'depot',7,0);
  for(const [x,z,d] of [[3,-3,0],[4,-3,0],[5,-3,1],[5,-2,1],[5,-1,1],[5,0,1],[2,2,0],[3,2,0],[4,2,0],[5,2,3],[6,1,0],[7,1,3]])build(sim,'conveyor',x,z,d);
  advance(sim,500);
  assert.ok(sim.state.delivered>=20,JSON.stringify({delivered:sim.state.delivered,buildings:sim.state.buildings.filter(b=>b.kind==='assembler'||b.kind==='press')}));
  assert.equal(sim.state.unlock,3);assert.equal(sim.state.won,false,'The first commission opens the advanced campaign.');
  assert.equal(sim.state.campaign.mastery,true,JSON.stringify(sim.state.challenge));
  assert.ok(sim.state.campaign.badges.includes('Guild supplier'));
  const saved=Simulation.restore(sim.serialize());assert.equal(saved.state.campaign.mastery,true);
});
