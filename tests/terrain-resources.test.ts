import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CELL,type Kind} from '../src/data';
import {chunkSites,proceduralSite,terrainHeight,baseForSlot} from '../src/terrain';
import {chunkScenery} from '../src/scenery';
import {Simulation,newState,building} from '../src/simulation';
import {SharedWorld} from '../src/open-world';
import {GatheringAnimation,GATHER_IMPACT,GATHER_DURATION,type GatherStrike} from '../src/gathering';

test('infill keeps saved seams and gives every home a closer supply of everyday resources',()=>{
  for(let slot=0;slot<25;slot++){
    const home=baseForSlot(slot),cx=Math.floor(home.x/32),cz=Math.floor(home.z/32),sites=chunkSites(cx,cz);
    for(const [i,x,z] of [[0,8,18],[1,23,18],[2,7,6],[3,24,7]]){
      const old=proceduralSite(`p:${cx}:${cz}:${i}`)!;assert.equal(old.x,cx*32+x);assert.equal(old.z,cz*32+z);
    }
    for(const item of ['log','ore','coal','copper'])assert.ok(sites.some(s=>s.item===item&&Math.hypot(s.x-home.x,s.z-home.z)<8),`${slot}: ${item}`);
    for(const s of sites){assert.deepEqual(proceduralSite(s.id),s);assert.equal(terrainHeight(s.x,s.z),0);}
    assert.equal(terrainHeight(home.x,home.z),0);
  }
});

test('mountains have substantial elevation and a continuous surface at chunk edges',()=>{
  const samples=[];for(let x=-32;x<=32;x+=2)for(let z=-32;z<=32;z+=2)samples.push(terrainHeight(x,z));
  assert.ok(Math.max(...samples)>12);assert.ok(samples.every(Number.isFinite));
  for(const boundary of [-32,0,32])for(let z=-40;z<=40;z+=3){
    assert.ok(Math.abs(terrainHeight(boundary-.0001,z)-terrainHeight(boundary+.0001,z))<.002);
    assert.ok(Math.abs(terrainHeight(z,boundary-.0001)-terrainHeight(z,boundary+.0001))<.002);
  }
});

test('every ore seam supports hand mining, extraction over uncleared outcrops, and shared finite reserves',()=>{
  for(const site of chunkSites(0,0)){
    const sim=new Simulation({...newState(),openWorld:true,deposits:{},inventory:{log:1000,ore:1000,plank:1000,ingot:1000,copper:1000,gear:1000,pickaxe:1},unlock:7,player:{x:site.x*CELL,z:site.z*CELL+2}});
    const kind:Kind=site.item==='log'?'lumber':site.item==='ore'?'mine':'quarry';
    const node=chunkScenery(0,0).find(n=>n.siteId===site.id)!;
    sim.state.player={x:node.x+node.radius+.5,z:node.z};
    assert.match(sim.gather(node.id),/^(Mined|Chopped)/);
    const remaining=sim.remaining(site);assert.ok(remaining<site.amount);
    sim.state.player={x:site.x*CELL,z:site.z*CELL+2};
    assert.equal(sim.placementError(kind,site.x,site.z),null,site.id);
    const placed=sim.place(kind,site.x,site.z,0);assert.notEqual(typeof placed,'string');if(typeof placed==='string')continue;
    assert.equal(sim.sceneryVisible(node),false);assert.equal(sim.gatherTarget(site.id),undefined);
    assert.equal(sim.remaining(site),remaining,'placing a drill does not spend ore');
    sim.state.buildings.push(building('windmill',site.x+2,site.z,0,sim.state.nextId++));sim.reindex();
    sim.tick(.1);assert.equal(sim.remaining(site),remaining-1);
    assert.equal(sim.dismantle(placed.id),null);assert.equal(sim.remaining(site),remaining,'in-flight ore is returned');
    sim.state.time=sim.state.miningReady;assert.match(sim.gather(site.id),/^(Mined|Chopped)/);
    assert.equal(Simulation.restore(sim.serialize()).remaining(site),sim.remaining(site));
  }
});

test('cleared surface pieces do not prevent mining or automating the underlying copper seam',()=>{
  const site=proceduralSite('p:0:0:8')!,sim=new Simulation({...newState(),openWorld:true,deposits:{},inventory:{log:100,plank:100,ingot:100,gear:100},unlock:3,player:{x:site.x*CELL,z:site.z*CELL+2}});
  for(const n of chunkScenery(0,0).filter(n=>n.siteId===site.id))sim.state.harvested[n.id]=0;
  assert.match(sim.gather(site.id),/Mined 5 copper/);assert.equal(sim.remaining(site),site.amount-5);
  assert.equal(sim.placementError('quarry',site.x,site.z),null);
  sim.state.deposits[site.id]=0;assert.match(sim.placementError('quarry',site.x,site.z)!,/exhausted/);
});

test('only successful, authorized gathering emits an animation strike',()=>{
  const world=new SharedWorld(),a=world.createProfile('a','a','Ada'),b=world.createProfile('b','b','Bea');
  const site=proceduralSite('p:0:0:8')!,events:GatherStrike[]=[];world.sim.onGather=e=>events.push(e);
  a.x=site.x*CELL;a.z=site.z*CELL+2;
  assert.match(world.action(a,{type:'gather',target:site.id}),/Mined/);assert.equal(events.length,1);
  assert.deepEqual(events[0],{item:'copper',amount:5,x:site.x*CELL,z:site.z*CELL});
  world.action(a,{type:'gather',target:site.id});assert.equal(events.length,1,'cooldown has no phantom strike');
  b.x=a.x;b.z=a.z;world.action(b,{type:'gather',target:site.id});assert.equal(events.length,1,'other homes remain protected');
});

test('gathering tools wind up, shed chips at impact and return the engineer to rest',()=>{
  const root=new THREE.Group(),scene=new THREE.Scene();
  for(const name of ['arm_right','arm_left']){const part=new THREE.Group();part.name=name;root.add(part);}
  const animation=new GatheringAnimation(root,scene,()=>0);
  for(const item of ['log','stone','copper','crystal'] as const){
    animation.start({item,x:0,z:-1,amount:5});animation.update(.25);
    assert.equal(animation.diagnostics.tool,item==='log'?'axe':'pickaxe');assert.equal(animation.diagnostics.chips,0);
    assert.ok(root.getObjectByName('arm_right')!.rotation.x>1);
    animation.update(GATHER_IMPACT-.25+.01);assert.equal(animation.diagnostics.chips,14);
    animation.update(GATHER_DURATION);assert.equal(animation.active,false);assert.equal(animation.diagnostics.tool,null);assert.equal(animation.diagnostics.chips,0);
    assert.equal(root.rotation.x,0);assert.equal(root.getObjectByName('arm_right')!.rotation.x,0);
  }
  animation.dispose();assert.equal(scene.children.length,0);
});
