import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CELL,DIRECTIONS,type Kind} from '../src/data';
import {Simulation,building} from '../src/simulation';
import {applyAction,isAction} from '../src/protocol';
import {SharedWorld} from '../src/open-world';
import {extendConveyorPath,validConveyorPath,planConveyors,conveyorCorner,MAX_CONVEYOR_TILES,type ConveyorPoint} from '../src/conveyors';

function empty(){const sim=new Simulation();for(const node of sim.scenery)sim.state.harvested[node.id]=0;sim.state.player={x:0,z:0};return sim;}
function put(sim:Simulation,kind:Kind,x:number,z:number,dir=0){const b=building(kind,x,z,dir,sim.state.nextId++);if(sim.state.owner)b.owner=sim.state.owner;sim.state.buildings.push(b);sim.reindex();return b;}
const path=(points:number[][]):ConveyorPoint[]=>points.map(([x,z])=>({x,z}));

test('fast drags fill cells in all quadrants and retracing shortens the route',()=>{
  for(const x of [-4,4])for(const z of [-3,3]){
    const route=extendConveyorPath([{x:0,z:0}],{x,z});
    assert.equal(route.length,8);assert.deepEqual(route.at(-1),{x,z});assert.equal(validConveyorPath(route),true);
    assert.deepEqual(extendConveyorPath(route,route[2]),route.slice(0,3));
  }
  const multi=extendConveyorPath(extendConveyorPath(path([[0,0],[1,0],[2,0]]),{x:2,z:3}),{x:-2,z:3});
  assert.equal(multi.length,10);assert.equal(validConveyorPath(multi),true);
  assert.equal(extendConveyorPath([{x:0,z:0}],{x:10000,z:0}).length,MAX_CONVEYOR_TILES);
});

test('route commands reject disconnected, repeated, oversized and malformed paths',()=>{
  for(const route of [null,[],[null],path([[0,0],[1,1]]),path([[0,0],[2,0]]),path([[0,0],[1,0],[0,0]]),[{x:.5,z:0}],[{x:Infinity,z:0}],Array.from({length:33},(_,x)=>({x,z:0}))]){
    assert.equal(isAction({type:'conveyors',path:route,dir:0}),false);
  }
  assert.equal(isAction({type:'conveyors',path:path([[0,0],[1,0]]),dir:4}),false);
  assert.equal(isAction({type:'conveyors',path:path([[0,0],[1,0]]),dir:0}),true);
});

test('successive R turns are applied to the latest server direction',()=>{
  const sim=empty(),b=put(sim,'conveyor',0,0,0);
  assert.equal(isAction({type:'rotate',id:b.id}),true);
  assert.equal(isAction({type:'rotate',id:b.id,dir:null}),false);
  for(const expected of [1,2,3,0]){assert.equal(applyAction(sim,{type:'rotate',id:b.id}),'');assert.equal(b.dir,expected);}
  applyAction(sim,{type:'rotate',id:b.id,dir:2});assert.equal(b.dir,2);
});

test('an entire route is committed once with correct turns and exact timber cost',()=>{
  const sim=empty(),route=path([[-2,0],[-1,0],[0,0],[0,1],[0,2],[1,2],[2,2]]),before=sim.state.inventory.log!,revision=sim.revision;
  assert.match(applyAction(sim,{type:'conveyors',path:route,dir:0}),/Built 7 conveyors/);
  assert.deepEqual(sim.state.buildings.map(b=>b.dir),[0,0,1,1,0,0,0]);
  assert.equal(sim.state.inventory.log,before-7);assert.equal(sim.state.built,7);assert.equal(sim.revision,revision+1);
  assert.deepEqual(Simulation.restore(sim.serialize()).state.buildings,sim.state.buildings);
});

test('all left and right turns select the corresponding corner mesh',()=>{
  for(let dir=0;dir<4;dir++)for(const turn of [1,-1]){
    const sim=empty(),side=(dir+(turn===1?1:3))%4,d=DIRECTIONS[side];
    const b=put(sim,'conveyor',0,0,dir);put(sim,'conveyor',d.x,d.z,(side+2)%4);
    assert.equal(conveyorCorner(sim,b),turn);
    assert.equal(conveyorCorner(sim,b,{x:d.x,z:d.z}),turn);
  }
});

test('corner detection ignores non-output buildings and handles splitter side outputs',()=>{
  const sim=empty(),b=put(sim,'conveyor',0,0,0);const neighbor=put(sim,'windmill',0,1,3);
  assert.equal(conveyorCorner(sim,b),0);neighbor.kind='splitter';neighbor.dir=0;
  assert.equal(conveyorCorner(sim,b),1);
  put(sim,'conveyor',-1,0,0);assert.equal(conveyorCorner(sim,b),0,'straight feed takes priority at a junction');
});

test('extending existing belts turns the connection without charging for old tiles or reversing the destination',()=>{
  const sim=empty(),first=put(sim,'conveyor',0,0,0),end=put(sim,'conveyor',0,2,0);first.item='log';first.travel=.4;
  const before=sim.state.inventory.log!;
  assert.match(applyAction(sim,{type:'conveyors',path:path([[0,0],[0,1],[0,2]]),dir:0}),/Built 1 conveyor/);
  assert.equal(first.dir,1);assert.equal(end.dir,0);assert.equal(first.item,'log');assert.equal(first.travel,.4);assert.equal(sim.state.inventory.log,before-1);
});

test('blocked routes, short supplies and range failures do not change any tiles or inventory',()=>{
  for(const reason of ['machine','funds','range']){
    const sim=empty();put(sim,'conveyor',0,0,3);
    if(reason==='machine')put(sim,'windmill',2,0);
    if(reason==='funds')sim.state.inventory.log=1;
    if(reason==='range')sim.state.player.x=-8*CELL;
    const before=sim.serialize();const result=applyAction(sim,{type:'conveyors',path:path([[0,0],[1,0],[2,0]]),dir:0});
    assert.doesNotMatch(result,/^Built/);assert.equal(sim.serialize(),before,reason);
  }
});

test('uncleared scenery and an end pointing back into the route block construction',()=>{
  const sim=new Simulation(),node=sim.scenery.find(n=>n.kind==='tree'&&!n.siteId)!,x=Math.round(node.x/CELL),z=Math.round(node.z/CELL);
  sim.state.player={x:x*CELL,z:z*CELL};const before=sim.serialize();
  assert.match(applyAction(sim,{type:'conveyors',path:[{x,z}],dir:0}),/Chop or mine/);assert.equal(sim.serialize(),before);
  const clean=empty(),saved=clean.serialize();
  assert.match(applyAction(clean,{type:'conveyors',path:path([[0,0],[1,0]]),dir:2}),/points back/);assert.equal(clean.serialize(),saved);
});

test('machine endpoints connect their ports and transport goods through multiple bends',()=>{
  const sim=empty(),source=put(sim,'storage',-2,0,0),sink=put(sim,'storage',2,2,0);source.input={log:3};
  const route=path([[-2,0],[-1,0],[0,0],[0,1],[0,2],[1,2],[2,2]]);
  assert.equal(planConveyors(sim,route,0).cost,5);
  assert.match(applyAction(sim,{type:'conveyors',path:route,dir:0}),/Built 5 conveyors/);
  for(let i=0;i<250;i++)sim.tick(.1);
  assert.equal(sink.input.log,3);assert.equal(source.input.log,0);
  const backwards=path([[2,2],[1,2],[0,2]]),before=sim.serialize();
  assert.match(applyAction(sim,{type:'conveyors',path:backwards,dir:2}),/output arrow/);assert.equal(sim.serialize(),before);
});

test('a route cannot run into a machine output or through its footprint',()=>{
  const sim=empty();put(sim,'sawmill',2,0,2);
  const before=sim.serialize();
  assert.match(applyAction(sim,{type:'conveyors',path:path([[0,0],[1,0],[2,0]]),dir:0}),/input side/);
  assert.match(applyAction(sim,{type:'conveyors',path:path([[0,0],[1,0],[2,0],[3,0]]),dir:0}),/blocks/);
  assert.equal(sim.serialize(),before);
});

test('shared routes preserve ownership, clan supplies and private base boundaries',()=>{
  const world=new SharedWorld(),a=world.createProfile('a','a','Alice'),b=world.createProfile('b','b','Bob');
  const route=path([[a.base.x,a.base.z],[a.base.x+1,a.base.z],[a.base.x+1,a.base.z+1]]);
  const beforeB={...b.inventory};assert.match(world.action(a,{type:'conveyors',path:route,dir:1}),/Built 3/);
  assert.ok(world.sim.state.buildings.every(tile=>tile.owner===a.id));assert.deepEqual(b.inventory,beforeB);
  b.x=a.x;b.z=a.z;const before=JSON.stringify(world.sim.state.buildings);
  assert.match(world.action(b,{type:'conveyors',path:route,dir:2}),/another engineer/);
  assert.equal(JSON.stringify(world.sim.state.buildings),before);assert.deepEqual(b.inventory,beforeB);
  const sim=empty();sim.state.openWorld=true;sim.state.owner='a';sim.state.clanMembers=['a','b'];
  const belt=put(sim,'conveyor',0,0);belt.owner='b';
  assert.equal(planConveyors(sim,path([[0,0]]),1).error,null);
  sim.state.clanMembers=[];assert.match(planConveyors(sim,path([[0,0]]),1).error!,/owner/);
});
