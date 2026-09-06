import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CELL,DIRECTIONS,type Kind} from '../src/data';
import {Simulation,newState,building} from '../src/simulation';
import {applyAction} from '../src/protocol';
import {terrainHeight,terrainSlope} from '../src/terrain';
import {conveyorSurface,conveyorSurfaceHeight,conveyorItemPosition,foundationHeight} from '../src/conveyor-surface';
import {conformConveyor,disposeConveyor} from '../src/conveyor-view';
import {World} from '../src/world';

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const mountain=()=>new Simulation({...newState(),openWorld:true,deposits:{},discovered:[],player:{x:0,z:4*CELL}});
function put(sim:Simulation,kind:Kind,x:number,z:number,dir=0){const b=building(kind,x,z,dir,sim.state.nextId++);sim.state.buildings.push(b);sim.reindex();return b;}

test('belts follow steep mountains and meet across every tile edge, including chunk boundaries',()=>{
  const sim=mountain();assert.ok(terrainSlope(0,4)>1);
  for(const tile of [{x:0,z:4},{x:0,z:5},{x:-32,z:-1},{x:31,z:0}]){
    const surface=conveyorSurface(sim,tile);
    for(let x=-.5;x<=.5;x+=.05)for(let z=-.5;z<=.5;z+=.05)near(conveyorSurfaceHeight(surface,x,z),terrainHeight(tile.x+x,tile.z+z));
    for(const d of DIRECTIONS){
      const next=conveyorSurface(sim,{x:tile.x+d.x,z:tile.z+d.z});
      for(let t=-.5;t<=.5;t+=.05)near(conveyorSurfaceHeight(surface,d.x*.5-d.z*t,d.z*.5+d.x*t),conveyorSurfaceHeight(next,-d.x*.5-d.z*t,-d.z*.5+d.x*t));
    }
  }
});

test('conveyors ramp onto level machine and junction ports from all directions',()=>{
  for(const kind of ['storage','splitter','merger','sawmill'] as const)for(const d of DIRECTIONS){
    const sim=mountain(),b=put(sim,kind,0,4),tile={x:b.x+d.x,z:b.z+d.z},surface=conveyorSurface(sim,tile);
    const floor=foundationHeight(b.x,b.z,true);
    for(let t=-.24;t<=.24;t+=.02)near(conveyorSurfaceHeight(surface,-d.x*.5-d.z*t,-d.z*.5+d.x*t),floor);
    for(let x=-.5;x<=.5;x+=.05)for(let z=-.5;z<=.5;z+=.05)assert.ok(conveyorSurfaceHeight(surface,x,z)>=terrainHeight(tile.x+x,tile.z+z)-1e-6);
  }
});

test('straight and curved item paths meet at equal positions and elevations for every direction',()=>{
  const sim=mountain(),tile={x:0,z:4},surface=conveyorSurface(sim,tile);
  for(let dir=0;dir<4;dir++)for(const corner of [-1,0,1]){
    const d=DIRECTIONS[dir],out=conveyorItemPosition(dir,corner,1),next=conveyorItemPosition(dir,0,0);
    near(out.x,d.x*CELL+next.x);near(out.z,d.z*CELL+next.z);
    const after=conveyorSurface(sim,{x:tile.x+d.x,z:tile.z+d.z});
    near(conveyorSurfaceHeight(surface,out.x/CELL,out.z/CELL),conveyorSurfaceHeight(after,next.x/CELL,next.z/CELL));
    for(let t=0;t<=1;t+=.025){const p=conveyorItemPosition(dir,corner,t);near(conveyorSurfaceHeight(surface,p.x/CELL,p.z/CELL),terrainHeight(tile.x+p.x/CELL,tile.z+p.z/CELL));}
  }
});

test('mountain routes build for the normal price, carry goods uphill and downhill, and restore mid-trip',()=>{
  for(const reverse of [false,true]){
    let sim=mountain();for(const n of sim.scenery)sim.state.harvested[n.id]=0;
    const dir=reverse?3:1,source=put(sim,'storage',0,reverse?7:2,dir),sink=put(sim,'storage',0,reverse?2:7,dir);
    source.input={log:6};
    const path=Array.from({length:6},(_,i)=>({x:0,z:reverse?7-i:2+i})),before=sim.state.inventory.log!;
    assert.match(applyAction(sim,{type:'conveyors',path,dir}),/Built 4 conveyors/);
    assert.equal(sim.state.inventory.log,before-4);
    for(let i=0;i<50;i++)sim.tick(.1);
    assert.ok(sim.state.buildings.some(b=>b.item));
    const original=sim;sim=Simulation.restore(sim.serialize());
    for(let i=0;i<200;i++){sim.tick(.1);original.tick(.1);}
    assert.equal(sim.serialize(),original.serialize());assert.equal(sim.byId.get(sink.id)!.input.log,6);
    assert.equal(sim.state.buildings.filter(b=>b.item).length,0);
  }
});

test('splitter side outputs record the actual incoming direction on a sloping belt',()=>{
  const sim=mountain(),source=put(sim,'splitter',0,4,0),target=put(sim,'conveyor',0,5,0);
  sim.receive(target,'ore',source);assert.equal(target.from,1);
  const entry=conveyorItemPosition(target.dir,-1,0);near(entry.x,0);near(entry.z,-CELL/2);
});

async function asset(name:string){const bytes=await readFile(new URL(`../public/assets/models/${name}.glb`,import.meta.url));return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'/')).scene;}

test('authored belt meshes conform to mountains in every orientation without altering shared assets',async()=>{
  const sim=mountain(),surface=conveyorSurface(sim,{x:0,z:4});
  for(const name of ['conveyor','conveyor_corner']){
    const original=await asset(name),sources:THREE.BufferGeometry[]=[];original.traverse(o=>{if(o instanceof THREE.Mesh)sources.push(o.geometry);});
    const originals=sources.map(g=>Array.from(g.getAttribute('position').array));
    for(let dir=0;dir<4;dir++)for(const mirror of name==='conveyor'?[1]:[1,-1]){
      const model=original.clone(true);model.rotation.y=Math.PI/2;model.scale.x=mirror;
      conformConveyor(model,surface,dir);const root=new THREE.Group();root.add(model);root.rotation.y=-dir*Math.PI/2;root.position.y=surface.center;root.updateMatrixWorld(true);
      let disposed=0,meshes=0,vertices=0;
      model.traverse(o=>{
        if(!(o instanceof THREE.Mesh))return;meshes++;o.geometry.addEventListener('dispose',()=>disposed++);
        assert.ok(!sources.includes(o.geometry));const pos=o.geometry.getAttribute('position'),p=new THREE.Vector3();
        for(let i=0;i<pos.count;i+=3){vertices++;p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
          const above=p.y-conveyorSurfaceHeight(surface,p.x/CELL,p.z/CELL);assert.ok(above>-.03&&above<.5,`${name}, direction ${dir}: ${above}`);
        }
      });
      assert.ok(vertices>100);disposeConveyor(model);assert.equal(disposed,meshes);
    }
    sources.forEach((g,i)=>assert.deepEqual(Array.from(g.getAttribute('position').array),originals[i]));
  }
});

test('level legacy belts share geometry and mountain meshes rebuild when a neighboring platform changes',async()=>{
  const sim=new Simulation(),model=await asset('conveyor'),first=(model.getObjectByProperty('isMesh',true) as THREE.Mesh).geometry;
  conformConveyor(model,conveyorSurface(sim,{x:0,z:0}),0);assert.equal((model.getObjectByProperty('isMesh',true) as THREE.Mesh).geometry,first);
  const slope=mountain(),belt=put(slope,'conveyor',0,4);
  const world:World=Object.assign(Object.create(World.prototype),{sim:slope,scene:new THREE.Scene(),assets:new Map([['conveyor',model],['conveyor_corner',await asset('conveyor_corner')],['storage',await asset('storage')]]),
    objects:new Map(),moving:new Map(),revision:-1,conveyorSurfaces:new Map(),surfaceRevision:-1,wires:new THREE.Group(),foundationGeometry:new THREE.BoxGeometry(1,1,1),foundationMaterial:new THREE.MeshBasicMaterial(),syncScenery:()=>{},batchStaticBuildings:()=>{}});
  world.sync();const before=world.objects.get(belt.id)!;let disposed=0;before.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>disposed++);});
  const machine=put(slope,'storage',0,5);world.sync();assert.notEqual(world.objects.get(belt.id),before);assert.ok(disposed>0);
  near(conveyorSurfaceHeight(world.beltSurface(belt),0,.5),foundationHeight(machine.x,machine.z,true));
  slope.dismantle(machine.id);world.sync();near(conveyorSurfaceHeight(world.beltSurface(belt),0,.5),terrainHeight(0,4.5));
  const old=world.objects.get(belt.id);belt.dir=1;slope.revision++;world.sync();assert.notEqual(world.objects.get(belt.id),old);
});
