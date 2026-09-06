import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TerrainView} from '../src/terrain-view';
import {Simulation,newState} from '../src/simulation';
import {chunkScenery} from '../src/scenery';
import {CELL} from '../src/data';

test('harvesting hides every rendered mesh for a resource, including after chunk reload',()=>{
  const sim=new Simulation({...newState(),openWorld:true,deposits:{},discovered:[],player:{x:16*CELL,z:18*CELL}});
  const assets=new Map<string,THREE.Group>();
  for(const name of ['tree','rock']){const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));assets.set(name,group);}
  const view=new TerrainView(new THREE.Scene(),assets,sim);view.update(sim.state.player.x,sim.state.player.z,[],'');
  const nodes=chunkScenery(0,0).filter(n=>n.siteId);
  const matrix=new THREE.Matrix4();
  for(const node of nodes){
    const meshes=view.resourceMeshes.filter(m=>m.userData.resourceIds.includes(node.id));assert.ok(meshes.length>0,node.id);
    for(const mesh of meshes){mesh.getMatrixAt(mesh.userData.resourceIds.indexOf(node.id),matrix);assert.notEqual(matrix.determinant(),0);}
    sim.state.harvested[node.id]=0;
  }
  sim.revision++;view.update(sim.state.player.x,sim.state.player.z,[],'');
  const checkHidden=()=>{for(const node of nodes)for(const mesh of view.resourceMeshes.filter(m=>m.userData.resourceIds.includes(node.id))){mesh.getMatrixAt(mesh.userData.resourceIds.indexOf(node.id),matrix);assert.equal(matrix.determinant(),0,node.id);}};
  checkHidden();view.update(500,500,[],'');view.update(sim.state.player.x,sim.state.player.z,[],'');checkHidden();
  // Network snapshots replace inventory objects even if the building layout is unchanged.
  sim.state={...sim.state,harvested:{}};view.update(sim.state.player.x,sim.state.player.z,[],'');
  const first=nodes[0],mesh=view.resourceMeshes.find(m=>m.userData.resourceIds.includes(first.id))!;
  mesh.getMatrixAt(mesh.userData.resourceIds.indexOf(first.id),matrix);assert.notEqual(matrix.determinant(),0);
});
