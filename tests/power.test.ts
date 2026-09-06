import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CELL,DEFS,SITES,canAfford,type Kind} from '../src/data';
import {Simulation,building,isStopped} from '../src/simulation';
import {SharedWorld} from '../src/open-world';
import {sitesAround} from '../src/terrain';
import {powerAnchor,powerCable} from '../src/power-view';

const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*10);i++)sim.tick(.1);};
function put(sim:Simulation,kind:Kind,x:number,z:number){
  const b=building(kind,x,z,0,sim.state.nextId++);sim.state.buildings.push(b);sim.reindex();return b;
}
function coalPlant(){
  const sim=new Simulation(),site=SITES.find(s=>s.item==='coal')!;
  sim.state.inventory.copper=6;sim.state.player={x:site.x*CELL,z:(site.z+2)*CELL};
  const plant=sim.place('steam',site.x,site.z,0);assert.notEqual(typeof plant,'string');
  return {sim,site,plant:plant as ReturnType<typeof building>};
}

test('one affordable windmill covers the starter lines; expansion overloads it and needs more land',()=>{
  const sim=new Simulation();assert.ok(canAfford(sim.state.inventory,DEFS.windmill.cost));
  const wind=sim.place('windmill',0,0,0);assert.notEqual(typeof wind,'string');
  const starters=[put(sim,'lumber',1,0),put(sim,'sawmill',-1,0),put(sim,'mine',0,1),put(sim,'furnace',0,-1)];
  assert.equal(sim.supply,12);assert.equal(sim.demand,12);assert.ok(starters.every(b=>b.power===1));
  put(sim,'press',1,1);assert.ok(starters.every(b=>b.power===.75));
  const before=structuredClone(sim.state.inventory);
  assert.match(String(sim.place('windmill',2,2,0)),/at least 4 tiles/);assert.deepEqual(sim.state.inventory,before);
  assert.doesNotMatch(sim.placementError('windmill',4,0,false)||'',/open air/);
  assert.equal(DEFS.steam.generation!/DEFS.windmill.generation!,6);
});

test('coal plants require a live coal seam and occupy it without destroying reserves',()=>{
  const sim=new Simulation();sim.state.inventory.copper=6;
  assert.match(sim.placementError('steam',0,0,false)!,/directly on a coal deposit/);
  for(const site of SITES.filter(s=>s.item!=='coal'))assert.match(sim.placementError('steam',site.x,site.z,false)!,/coal deposit/);
  const {sim:placed,site,plant}=coalPlant();
  assert.equal(placed.remaining(site),site.amount);assert.equal(placed.gatherTarget(site.id),undefined);
  assert.ok(placed.scenery.filter(n=>n.siteId===site.id).every(n=>!placed.sceneryVisible(n)));
  assert.match(placed.placementError('quarry',site.x,site.z,false)!,/occupied/);
  assert.equal(placed.dismantle(plant.id),null);assert.equal(placed.remaining(site),site.amount);
  assert.ok(placed.gatherTarget(site.id));
  placed.state.deposits[site.id]=0;assert.match(placed.placementError('steam',site.x,site.z,false)!,/exhausted/);
});

test('integrated coal mining starts without outside power, burns finite reserves and stops on exhaustion',()=>{
  const {sim,site,plant}=coalPlant();sim.state.deposits[site.id]=2;
  const post=put(sim,'post',site.x+5,site.z),load=put(sim,'foundry',site.x+9,site.z);
  load.input={ingot:8,coal:4};
  advance(sim,.1);assert.equal(sim.supply,72);assert.equal(load.power,1);assert.equal(sim.remaining(site),1);
  assert.equal(plant.fuelRemaining,20);assert.deepEqual(plant.input,{});
  advance(sim,19.9);assert.equal(sim.remaining(site),1);
  const restored=Simulation.restore(sim.serialize());advance(sim,20.2);advance(restored,20.2);
  assert.deepEqual(restored.state,sim.state);assert.equal(sim.remaining(site),0);assert.equal(sim.supply,0);
  assert.equal(plant.status,'Deposit exhausted');assert.equal(load.power,0);assert.ok(isStopped(plant));
  assert.ok(sim.powerEdges.some(([a,b])=>a.id===post.id&&b.id===load.id),'outages leave the physical wire attached');
  plant.input.coal=1;advance(sim,.1);assert.equal(sim.supply,72);assert.equal(sim.remaining(site),0);
  assert.equal(plant.input.coal,0);assert.equal(load.power,1);
  sim.dismantle(plant.id);assert.equal(sim.remaining(site),0,'burned coal cannot be reclaimed by rebuilding');
});

test('a severed post chain disconnects distant loads and reconnects when rebuilt',()=>{
  const {sim,site}=coalPlant();put(sim,'post',site.x+5,site.z);const post=put(sim,'post',site.x+10,site.z);
  const load=put(sim,'furnace',site.x+14,site.z);advance(sim,.1);assert.equal(load.power,1);
  sim.state.buildings=sim.state.buildings.filter(b=>b.id!==post.id);sim.reindex();assert.equal(load.power,0);
  assert.ok(!sim.powerEdges.some(([,b])=>b.id===load.id));
  put(sim,'post',post.x,post.z);assert.equal(load.power,1);
});

test('shared-world actions enforce coal placement, spend once and use the procedural seam',()=>{
  const world=new SharedWorld(),player=world.createProfile('coal-builder','token','Engineer');
  const site=sitesAround(player.base.x,player.base.z).find(s=>s.item==='coal')!;
  player.inventory.copper=6;player.x=site.x*CELL;player.z=(site.z+2)*CELL;
  const before=structuredClone(player.inventory);
  assert.match(world.action(player,{type:'place',kind:'steam',x:site.x+2,z:site.z,dir:0}),/coal deposit/);
  assert.deepEqual(player.inventory,before);
  assert.match(world.action(player,{type:'place',kind:'steam',x:site.x,z:site.z,dir:0}),/Built coal power plant/);
  const plant=world.sim.at(site.x,site.z)!;assert.equal(plant.owner,player.id);
  assert.equal(player.inventory.copper,0);world.tick(.1);
  assert.equal(world.sim.remaining(site),site.amount-1);assert.equal(world.sim.generation(plant),72);
  assert.equal(world.snapshot(player).buildings.find(b=>b.id===plant.id)!.fuelRemaining,20);
});

test('old generator status strings still restore after the power rebalance',()=>{
  const sim=new Simulation(),wind=put(sim,'windmill',0,0),steam=put(sim,'steam',5,0);
  wind.status='Generating 24 power';steam.status='Generating 48 power';steam.fuelRemaining=9;
  const restored=Simulation.restore(sim.serialize());assert.equal(restored.supply,84);
  advance(restored,.1);assert.equal(restored.at(0,0)!.status,'Generating 12 power');
  assert.equal(restored.at(5,0)!.status,'Generating 72 power');
});

test('cables attach to rotated post couplers, sag above flat land and clear a ridge',()=>{
  const post=building('post',0,0,1,1),anchor=powerAnchor(post,()=>2);
  assert.ok(Math.abs(anchor.x)<1e-8);assert.equal(anchor.y,3.95);assert.equal(anchor.z,.34);
  const start=new THREE.Vector3(0,2,0),end=new THREE.Vector3(10,2,0);
  const flat=powerCable(start,end,()=>0);assert.ok(flat.getPoint(.5).y<2);assert.ok(flat.getPoint(.5).y>0);
  const ridge=(x:number)=>4*Math.sin(Math.PI*x/10),cable=powerCable(start,end,ridge);
  assert.deepEqual(cable.getPoint(0),start);assert.deepEqual(cable.getPoint(1),end);
  for(let i=0;i<=100;i++){const p=cable.getPoint(i/100);assert.ok(p.y>ridge(p.x)+.2,'cable does not disappear into the mountain');}
});
