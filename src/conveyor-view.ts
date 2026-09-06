import * as THREE from 'three';
import {TessellateModifier} from 'three/addons/modifiers/TessellateModifier.js';
import {CELL,DIRECTIONS} from './data';
import {conveyorSurfaceHeight,type ConveyorSurface} from './conveyor-surface';

const tessellator=new TessellateModifier(CELL/12,8);

/** Bend private copies of the slats, rails and feet. Subdivision keeps long
 * rails on the surface across crests instead of cutting through the mountain.
 * The authored model and its materials remain shared and untouched.
 */
export function conformConveyor(model:THREE.Object3D,surface:ConveyorSurface,dir:number){
  if(surface.level)return;
  model.updateMatrixWorld(true);
  const forward=DIRECTIONS[dir],vertex=new THREE.Vector3();
  model.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const local=o.geometry.clone().applyMatrix4(o.matrixWorld);
    const geometry=tessellator.modify(local);local.dispose();
    const positions=geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++){
      vertex.fromBufferAttribute(positions,i);
      const x=(forward.x*vertex.x-forward.z*vertex.z)/CELL,z=(forward.z*vertex.x+forward.x*vertex.z)/CELL;
      positions.setY(i,vertex.y+conveyorSurfaceHeight(surface,x,z)-surface.center);
    }
    geometry.applyMatrix4(o.matrixWorld.clone().invert());geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    if(o.userData.conveyorGeometry)o.geometry.dispose();
    o.geometry=geometry;o.userData.conveyorGeometry=true;
  });
}

export function disposeConveyor(model:THREE.Object3D){
  model.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.conveyorGeometry)o.geometry.dispose();});
}
