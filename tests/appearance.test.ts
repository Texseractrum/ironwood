import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DEFAULT_APPEARANCE,JACKET_COLORS,isAppearance,normalizeAppearance} from '../src/appearance';
import {SharedWorld} from '../src/open-world';
import {Character} from '../src/character';

test('appearance validates complete cosmetics and safely migrates old profiles',()=>{
  for(const value of [undefined,null,[],false,'moss',{}, {...DEFAULT_APPEARANCE,skin:'<script>'},{...DEFAULT_APPEARANCE,jacket:'toString'},{...DEFAULT_APPEARANCE,goggles:1}])assert.equal(isAppearance(value),false);
  assert.equal(isAppearance(DEFAULT_APPEARANCE),true);
  assert.deepEqual(normalizeAppearance(),DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({skin:'ebony',hat:'invalid',goggles:'true',id:'someone-else'}),{...DEFAULT_APPEARANCE,skin:'ebony'});
});

test('cosmetics belong to the engineer, survive account linking, and never alter supplies',()=>{
  const world=new SharedWorld(),a=world.createProfile('a','token-a','Alice'),b=world.createProfile('b','token-b','Bob');
  const before=structuredClone({inventory:a.inventory,progress:a.progress,base:a.base});
  const appearance={...DEFAULT_APPEARANCE,jacket:'ocean' as const,hat:'cap' as const,goggles:true};
  assert.equal(world.customize(a,{...appearance,id:b.id,inventory:{log:999}}),true);
  assert.deepEqual(a.appearance,appearance);assert.deepEqual(world.publicPlayer(b).appearance,DEFAULT_APPEARANCE);
  assert.deepEqual({inventory:a.inventory,progress:a.progress,base:a.base},before);
  assert.equal(world.customize(a,{...appearance,skin:'invalid'}),false);assert.deepEqual(a.appearance,appearance);
  const linked=world.accountProfile({id:'12345',name:'Alice',username:'alice',verified:false,verifiedType:'none'},a.token);
  assert.equal(linked.id,a.id);assert.deepEqual(linked.appearance,appearance);
  const restored=JSON.parse(JSON.stringify(a));assert.deepEqual(world.publicPlayer(restored).appearance,appearance);
  assert.equal('token' in world.publicPlayer(a),false);
});

test('actual engineer GLB palettes and hats are isolated while animation pivots survive',async()=>{
  const buffer=await readFile(new URL('../public/assets/models/engineer.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer,'');
  const a=new Character(gltf.scene),b=new Character(gltf.scene);
  const meshes=(root:THREE.Object3D)=>{const result:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)result.push(o);});return result;};
  const shirt=(root:THREE.Object3D)=>meshes(root).find(o=>(o.material as THREE.Material).name==='IW_shirt')!.material as THREE.MeshStandardMaterial;
  const original=shirt(gltf.scene).color.getHexString(),other=shirt(b.root).color.getHexString();
  assert.equal(a.apply({...DEFAULT_APPEARANCE,jacket:'ocean',hat:'none',goggles:true}),true);
  assert.equal(shirt(a.root).color.getHexString(),JACKET_COLORS.ocean.color.slice(1));
  assert.equal(shirt(b.root).color.getHexString(),other);assert.equal(shirt(gltf.scene).color.getHexString(),original);
  assert.ok(meshes(a.root).filter(o=>(o.material as THREE.Material).name==='IW_roof').every(o=>!o.visible));
  for(const name of ['arm_left','arm_right','leg_left','leg_right'])assert.ok(a.root.getObjectByName(name));
  let sharedDisposed=false;for(const mesh of meshes(gltf.scene))mesh.geometry.addEventListener('dispose',()=>sharedDisposed=true);
  a.dispose();assert.equal(sharedDisposed,false,'closing a preview must not dispose shared asset geometry');
  b.apply({...DEFAULT_APPEARANCE,jacket:'rust'});assert.equal(shirt(b.root).color.getHexString(),JACKET_COLORS.rust.color.slice(1));b.dispose();
});
