import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Character} from '../src/character';
import {World} from '../src/world';
import {Simulation,newState} from '../src/simulation';
import type {Player} from '../src/protocol';

const template=readFile(new URL('../public/assets/models/engineer.glb',import.meta.url)).then(buffer=>
  new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer,''));
const limbs=['arm_left','arm_right','leg_left','leg_right'];
const pose=(root:THREE.Object3D)=>limbs.map(name=>root.getObjectByName(name)!.rotation.x);
const peer=(id:string,x:number):Player=>({id,name:id,x,z:0,color:'#fff',base:{x:0,z:0}});

async function animationWorld(){
  const assets=new Map([['engineer',(await template).scene]]),character=new Character(assets.get('engineer')!),player=new THREE.Group();
  player.add(character.root);
  // Exercise the real render paths and GLB pivots without requiring a GPU.
  const world:World=Object.assign(Object.create(World.prototype) as World,{
    sim:new Simulation({...newState(),player:{x:0,z:0}}),scene:new THREE.Scene(),assets,character,player,
    keys:new Set<string>(),touchMove:{x:0,z:0,run:false},elapsed:0,azimuth:0,
    crew:[],crewObjects:new Map(),crewCharacters:new Map(),crewGathering:new Map(),
  });
  const frame=(dt=1/60)=>{world.elapsed+=dt;world.walk(0,true);world.renderCrew(dt);};
  const dispose=()=>{world.crew=[];world.renderCrew(0);character.dispose();};
  return {world,frame,dispose};
}

test('approaching engineers animate every frame between network snapshots, independently of idle peers',async()=>{
  const {world,frame,dispose}=await animationWorld();
  try{
    const moving=peer('moving',8),idle=peer('idle',-8);world.crew=[moving,idle];frame();
    const root=world.crewObjects.get(moving.id)!,idleRoot=world.crewObjects.get(idle.id)!;
    world.keys.add('KeyD');
    // The server broadcasts positions every 200 ms; animate throughout that interval.
    for(let snapshot=0;snapshot<4;snapshot++){
      moving.x-=.96;
      for(let i=0;i<12;i++){
        const before=pose(root);frame();
        assert.notDeepEqual(pose(root),before,'remote limbs must keep moving between snapshots');
        assert.deepEqual(pose(root),pose(world.player),'remote and local engineers use the same gait');
        assert.ok(Math.abs(root.position.y-world.player.position.y)<1e-12,'walking includes the same boot bounce');
        assert.ok(pose(idleRoot).every(angle=>Math.abs(angle)<=.025),'another player walking must not animate idle peers');
      }
    }
    assert.ok(root.position.x<8,'the animated engineer approaches the observer');
    assert.equal(root.rotation.y,-Math.PI/2);
    world.keys.clear();
    for(let i=0;i<120;i++)frame();
    assert.deepEqual(pose(root),pose(world.player),'the remote engineer returns to idle when movement stops');
    assert.equal(root.position.y,world.footHeight(root.position.x,root.position.z));
  }finally{dispose();}
});

test('remote gathering overrides the base arm pose and releases it back to walking',async()=>{
  const {world,frame,dispose}=await animationWorld();
  try{
    const other=peer('gatherer',5);world.crew=[other];frame();
    const root=world.crewObjects.get(other.id)!,gathering=world.crewGathering.get(other.id)!;
    world.gather(other.id,{x:6,z:0,item:'log',amount:1});frame(.2);
    assert.equal(gathering.active,true);
    assert.ok(root.getObjectByName('arm_right')!.rotation.x>1,'gathering retains control of the arms');
    assert.ok(Math.abs(root.getObjectByName('leg_left')!.rotation.x)<=.025);
    for(let i=0;i<60;i++)frame();
    assert.equal(gathering.active,false);
    assert.deepEqual(pose(root),pose(world.player),'idle animation resumes after the strike');
    other.x-=1;world.keys.add('KeyD');frame();
    assert.deepEqual(pose(root),pose(world.player),'walking resumes after gathering');
    assert.equal(root.getObjectByName('arm_right')!.rotation.z,0);
  }finally{dispose();}
});

test('engineers start animating when entering range, including after being removed and recreated',async()=>{
  const {world,frame,dispose}=await animationWorld();
  try{
    const other=peer('returning',201);world.crew=[other];frame();assert.equal(world.crewObjects.size,0);
    other.x=199;frame();const first=world.crewObjects.get(other.id)!;
    other.x=198;world.keys.add('KeyD');frame();assert.deepEqual(pose(first),pose(world.player));
    other.x=201;frame();
    assert.equal(world.crewObjects.size,0);assert.equal(world.crewCharacters.size,0);assert.equal(world.crewGathering.size,0);
    other.x=199;frame();const returned=world.crewObjects.get(other.id)!;
    assert.notEqual(returned,first);
    other.x=198;frame();assert.deepEqual(pose(returned),pose(world.player));
  }finally{dispose();}
});
