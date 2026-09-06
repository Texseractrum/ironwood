import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CELL,DEFS,type Kind} from '../src/data';
import {Simulation,building,type Building} from '../src/simulation';
import {applyAction,isAction} from '../src/protocol';
import {hasRoute,tutorialStep} from '../src/tutorial';

const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<seconds*10;i++)sim.tick(.1);};
function build(sim:Simulation,kind:Kind,x:number,z:number,dir=0){
  for(const node of sim.scenery.filter(n=>sim.overlapsScenery(n,x,z)&&sim.sceneryVisible(n))){
    if(['lumber','mine','quarry'].includes(kind)&&node.siteId===sim.siteAt(x,z)?.id)continue;
    sim.state.player={x:node.x+node.radius+.5,z:node.z};
    while(sim.sceneryVisible(node)){advance(sim,1.1);sim.gather(node.id);}
  }
  sim.state.player={x:x*CELL,z:(z+2)*CELL};const b=sim.place(kind,x,z,dir);
  assert.notEqual(typeof b,'string',String(b));return b as Building;
}
const stage=(sim:Simulation,id:string)=>{
  assert.equal(tutorialStep(sim)?.id,id);
  assert.equal(tutorialStep(Simulation.restore(sim.serialize()))?.id,id,'reload resumes the same objective');
};

test('tutorial walks an empty island through powered wood and iron production using starting supplies',()=>{
  const sim=new Simulation();stage(sim,'lumber');
  assert.match(tutorialStep(sim)!.copy,/Hover over the dark-green recipe book at the bottom to open it/);
  const camp=build(sim,'lumber',-6,2);stage(sim,'power-lumber camp');
  const farWind=build(sim,'windmill',2,0);stage(sim,'power-lumber camp');
  assert.equal(tutorialStep(sim)?.action,'post');
  assert.equal(sim.dismantle(farWind.id),null);
  const wind=build(sim,'windmill',-4,-1);stage(sim,'sawmill');
  const saw=build(sim,'sawmill',-2,2);stage(sim,'timber-route');
  sim.craft('plank');stage(sim,'timber-route');assert.equal(sim.state.produced.plank,undefined);
  build(sim,'conveyor',-5,2);const reverse=build(sim,'conveyor',-4,2,2);build(sim,'conveyor',-3,2);
  assert.equal(hasRoute(sim,camp,saw),false);stage(sim,'timber-route');
  applyAction(sim,{type:'rotate',id:reverse.id,dir:0});stage(sim,'storage');
  build(sim,'storage',0,2);stage(sim,'plank-route');
  build(sim,'conveyor',-1,2);stage(sim,'planks');
  advance(sim,25);stage(sim,'mine');assert.ok((sim.state.produced.plank||0)>=6);
  const mine=build(sim,'mine',-6,-3);stage(sim,'furnace');
  const furnace=build(sim,'furnace',-2,-3);stage(sim,'ore-route');
  for(const x of [-5,-4,-3])build(sim,'conveyor',x,-3);
  assert.equal(hasRoute(sim,mine,furnace),true);stage(sim,'ingots');
  // Losing power prompts a repair instead of waiting forever for production.
  sim.state.player={x:wind.x*CELL,z:(wind.z+2)*CELL};sim.dismantle(wind.id);stage(sim,'power-lumber camp');
  build(sim,'windmill',-4,-1);stage(sim,'ingots');
  advance(sim,60);assert.equal(sim.state.unlock,1);assert.equal(tutorialStep(sim),null);
  assert.ok(Object.values(sim.state.inventory).every(n=>n>=0));
});

test('producing planks early does not skip the storage and connection lessons',()=>{
  const sim=new Simulation();const camp=build(sim,'lumber',-6,2);build(sim,'windmill',-4,-1);
  const saw=build(sim,'sawmill',-2,2);sim.feed(saw);advance(sim,13);
  assert.equal(sim.state.produced.plank,6);stage(sim,'timber-route');
  for(const x of [-5,-4,-3])build(sim,'conveyor',x,2);
  assert.equal(hasRoute(sim,camp,saw),true);stage(sim,'storage');
  build(sim,'storage',0,2,2);build(sim,'conveyor',-1,2);stage(sim,'plank-route');
});

test('dispatch depots are built through validated actions, unlock with assembly, and refund their costs',()=>{
  const sim=new Simulation(),action={type:'place',kind:'depot',x:1,z:0,dir:0} as const;
  assert.equal(isAction(action),true);assert.match(applyAction(sim,action),/Produce 8 gears/);
  assert.equal(sim.state.buildings.length,0);
  sim.state.unlock=2;const before=structuredClone(sim.state.inventory);
  assert.match(applyAction(sim,action),/Built dispatch depot/);
  assert.equal(sim.state.inventory.log,before.log!-DEFS.depot.cost.log!);
  assert.equal(sim.state.inventory.plank,before.plank!-DEFS.depot.cost.plank!);
  assert.equal(sim.dismantle(sim.at(1,0)!.id),null);assert.deepEqual(sim.state.inventory,before);
});

test('shared-world tutorials use local deposits and ignore another player’s buildings',()=>{
  const sim=new Simulation();Object.assign(sim.state,{openWorld:true,owner:'new-player',base:{x:112,z:112},player:{x:112*CELL,z:114*CELL}});
  const other=building('lumber',104,114,0,sim.state.nextId++);other.owner='neighbor';sim.state.buildings.push(other);sim.reindex();
  assert.equal(tutorialStep(sim)?.id,'lumber');
  const target=tutorialStep(sim)?.site;assert.equal(target?.item,'log');assert.ok(target!.x>90);
  assert.ok(sim.siteAt(target!.x,target!.z));
});
