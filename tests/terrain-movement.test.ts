import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CELL} from '../src/data';
import {terrainHeight,terrainSlope,terrainFootHeight,CLAIM_RADIUS} from '../src/terrain';
import {Simulation,newState,building} from '../src/simulation';
import {validMove} from '../src/protocol';
import {SharedWorld} from '../src/open-world';
import {World} from '../src/world';
import {TerrainView} from '../src/terrain-view';
import {sceneryAround} from '../src/scenery';

const simulation=()=>new Simulation({...newState(),openWorld:true,deposits:{},player:{x:16*CELL,z:16*CELL}});

test('players and the server can traverse steep mountain faces in both directions',()=>{
  const sim=simulation();
  for(const node of sceneryAround(0,4,1))sim.state.harvested[node.id]=0;
  assert.ok(terrainSlope(0,4)>1);
  assert.equal(sim.canWalk(0,4*CELL),true);
  assert.ok(terrainHeight(0,2)>1);
  assert.equal(sim.canWalk(0,2*CELL),true);
  const from={x:0,z:2*CELL},to={x:0,z:3.5*CELL};
  assert.equal(validMove(sim,from,to,.5),true);
  sim.state.player={...from};sim.movePlayer(0,to.z-from.z);
  assert.ok(Math.abs(sim.state.player.z-to.z)<1e-9);
  assert.equal(sim.canWalk(sim.state.player.x,sim.state.player.z),true);
  assert.equal(validMove(sim,to,from,.5),true);
  sim.movePlayer(0,from.z-to.z);assert.ok(Math.abs(sim.state.player.z-from.z)<1e-9);
  const gentle={x:.1,z:from.z};assert.equal(validMove(sim,from,gentle,.1),true);
  sim.state.player={...from};sim.movePlayer(.1,0);assert.ok(Math.abs(sim.state.player.x-.1)<1e-9);
});

test('high summits remain reachable and movement still rejects obstacles and excessive speed',()=>{
  const sim=simulation();
  let summit={x:0,z:0,height:0};
  for(let x=-32;x<=32;x+=2)for(let z=-32;z<=32;z+=2){
    const height=terrainHeight(x,z);if(height>summit.height)summit={x,z,height};
  }
  assert.ok(summit.height>15);
  for(const node of sceneryAround(summit.x,summit.z,1))sim.state.harvested[node.id]=0;
  const peak={x:summit.x*CELL,z:summit.z*CELL},from={x:peak.x-1,z:peak.z};
  assert.equal(validMove(sim,from,peak,.25),true);
  sim.state.player={...from};sim.movePlayer(1,0);assert.ok(Math.abs(sim.state.player.x-peak.x)<1e-9);
  const world=walkingWorld(sim);world.walk(0,true);assert.ok(world.player.position.y>=summit.height);
  assert.equal(validMove(sim,from,peak,.01),false);
  sim.state.buildings.push(building('storage',summit.x,summit.z,0,1));sim.reindex();
  assert.equal(sim.canWalk(peak.x,peak.z),false);assert.equal(validMove(sim,from,peak,.25),false);
});

test('ground heights agree with ray hits on textured triangles and across negative chunk edges',()=>{
  const sim=simulation(),assets=new Map<string,THREE.Group>();
  for(const name of ['tree','rock'])assets.set(name,new THREE.Group());
  const view=new TerrainView(new THREE.Scene(),assets,sim);view.update(0,0,[],'');
  view.surface!.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),triangle=new THREE.Triangle();
  for(const [x,z] of [[.2,2.3],[1.7,3.4],[-.1,-.1],[-32.01,5.7],[-31.99,5.7],[31.99,-4.1],[32.01,-4.1]]){
    ray.set(new THREE.Vector3(x*CELL,50,z*CELL),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(view.surface!)[0];assert.ok(hit);
    assert.ok(Math.abs(hit.point.y-(terrainHeight(x,z)-.015))<.00001);
    const pos=view.surface!.geometry.getAttribute('position'),face=hit.face!;
    triangle.a.fromBufferAttribute(pos,face.a);triangle.b.fromBufferAttribute(pos,face.b);triangle.c.fromBufferAttribute(pos,face.c);
    const normal=triangle.getNormal(new THREE.Vector3());
    assert.ok(Math.abs(Math.hypot(normal.x,normal.z)/normal.y-terrainSlope(x,z))<.00001);
  }
});

// Exercise the render methods without creating a GPU renderer.
function walkingWorld(sim:Simulation){
  return Object.assign(Object.create(World.prototype) as World,{sim,player:new THREE.Group(),keys:new Set<string>(),touchMove:{x:0,z:0,run:false},elapsed:0,azimuth:0,
    target:new THREE.Vector3(),cameraOffset:new THREE.Vector3(),camera:new THREE.OrthographicCamera()});
}
test('boots stay above the terrain while walking and the camera snaps to the arrival position',()=>{
  const sim=simulation(),world=walkingWorld(sim);sim.state.player={x:0,z:2*CELL};
  world.keys.add('KeyD');world.walk(.1,true);
  const p=world.player.position;
  for(const dx of [-.4,0,.4])for(const dz of [-.4,0,.4])assert.ok(p.y>=terrainHeight((p.x+dx)/CELL,(p.z+dz)/CELL));
  sim.state.player={x:-300*CELL,z:208*CELL};world.focusPlayer();
  assert.equal(world.target.x,sim.state.player.x);assert.equal(world.target.z,sim.state.player.z-1.7);
  assert.equal(world.player.position.y,world.footHeight(sim.state.player.x,sim.state.player.z));
});

test('remote engineers stand on the surface at their interpolated location',()=>{
  const sim=simulation(),world=walkingWorld(sim),root=new THREE.Group();
  sim.state.player={x:0,z:5*CELL};root.position.set(0,terrainFootHeight(0,2,.45/CELL),2*CELL);
  Object.assign(world,{crew:[{id:'other',x:0,z:8*CELL}],crewObjects:new Map([['other',root]]),crewCharacters:new Map(),crewGathering:new Map(),scene:new THREE.Scene()});
  world.renderCrew(.06);
  assert.ok(root.position.z>2*CELL&&root.position.z<8*CELL);
  assert.equal(root.position.y,world.footHeight(root.position.x,root.position.z));
});

test('new and returning engineers arrive at their own base without resetting progress',()=>{
  const world=new SharedWorld();
  for(let i=0;i<10;i++){
    const p=world.createProfile(String(i),String(i),'Engineer');
    assert.equal(p.x,p.base.x*CELL);assert.equal(p.z,p.base.z*CELL);
    p.x+=100;p.z-=150;p.inventory.log=12;p.progress.gathered=7;
    world.spawnAtBase(p);
    assert.equal(p.x,p.base.x*CELL);assert.equal(p.z,p.base.z*CELL);
    assert.equal(p.inventory.log,12);assert.equal(p.progress.gathered,7);
  }
});

test('arrival finds clear ground within a built-up home and respects obstacle collision',()=>{
  const world=new SharedWorld(),p=world.createProfile('builder','token','Builder');
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)world.sim.state.buildings.push(building('storage',p.base.x+x,p.base.z+z,0,world.sim.state.nextId++));
  world.sim.reindex();world.spawnAtBase(p);
  assert.ok(Math.hypot(p.x-p.base.x*CELL,p.z-p.base.z*CELL)>8,'search extends past the former eight-metre limit');
  assert.ok(Math.hypot(p.x-p.base.x*CELL,p.z-p.base.z*CELL)<CLAIM_RADIUS*CELL);
  assert.equal(world.sim.canWalk(p.x,p.z),true);
});
