import * as THREE from 'three';
import {CELL} from './data';
import {biomeAt,noise,CHUNK_SIZE,terrainHeight} from './terrain';
import {surfaceNoise} from './terrain-surface';
import type {Simulation} from './simulation';

interface CoverBatch {
  mesh:THREE.InstancedMesh;
  matrices:Float32Array;
  cells:Map<string,{start:number;count:number}>;
}

function tuftGeometry(){
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let blade=0;blade<3;blade++){
    const a=blade*2.4,dx=Math.cos(a),dz=Math.sin(a),h=blade===1?.8:1;
    const base=positions.length/3;
    for(const [width,y,lean] of [[-.2,0,0],[.2,0,0],[-.1,h*.55,.1],[.1,h*.55,.1],[0,h,.4]]){
      positions.push(dx*width+dz*lean,y,dz*width-dx*lean);
      const shade=.62+y*.38;colors.push(shade,shade,shade);
    }
    indices.push(base,base+1,base+2,base+1,base+3,base+2,base+2,base+3,base+4);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

// Chunk-sized batches cull offscreen cover and reuse geometry/materials across crossings.
export class TerrainCover {
  readonly group=new THREE.Group();
  private grassGeometry=tuftGeometry();
  private stoneGeometry=new THREE.IcosahedronGeometry(1,0);
  private grassMaterial=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:1});
  private stoneMaterial=new THREE.MeshStandardMaterial({roughness:1,flatShading:true});
  private chunks=new Map<string,CoverBatch[]>();
  private occupied=new Set<string>();
  private layout='';
  constructor(private sim:Simulation){this.group.name='Grass tufts and ground stones';}

  update(cx:number,cz:number){
    const wanted=new Set<string>();
    for(let x=cx-2;x<=cx+2;x++)for(let z=cz-2;z<=cz+2;z++){
      const key=`${x},${z}`;wanted.add(key);
      if(!this.chunks.has(key))this.chunks.set(key,this.makeChunk(x,z));
    }
    for(const [key,batches] of this.chunks)if(!wanted.has(key)){
      for(const {mesh} of batches){this.group.remove(mesh);mesh.dispose();}
      this.chunks.delete(key);
    }
    this.syncBuildings(true);
  }

  syncBuildings(force=false){
    const layout=this.sim.state.buildings.map(b=>`${b.x},${b.z}`).sort().join('|');
    if(!force&&layout===this.layout)return;
    this.layout=layout;
    const occupied=new Set(this.sim.state.buildings.map(b=>`${b.x},${b.z}`));
    const changed=new Set([...this.occupied,...occupied]);
    const matrix=new THREE.Matrix4(),hidden=new THREE.Matrix4().makeScale(0,0,0);
    for(const batches of this.chunks.values())for(const batch of batches){
      let dirty=false;
      for(const key of changed){
        if(!force&&this.occupied.has(key)===occupied.has(key))continue;
        const cell=batch.cells.get(key);if(!cell)continue;
        for(let i=cell.start;i<cell.start+cell.count;i++){
          matrix.fromArray(batch.matrices,i*16);
          batch.mesh.setMatrixAt(i,occupied.has(key)?hidden:matrix);
        }
        dirty=true;
      }
      if(dirty)batch.mesh.instanceMatrix.needsUpdate=true;
    }
    this.occupied=occupied;
  }

  private makeChunk(cx:number,cz:number):CoverBatch[]{
    const result:CoverBatch[]=[],dummy=new THREE.Object3D(),color=new THREE.Color();
    const greenTip=new THREE.Color('#acaf71'),dryTip=new THREE.Color('#b6a57c');
    for(const grass of [true,false]){
      const transforms:number[]=[],colors:number[]=[],cells=new Map<string,{start:number;count:number}>();
      for(let x=cx*CHUNK_SIZE;x<(cx+1)*CHUNK_SIZE;x++)for(let z=cz*CHUNK_SIZE;z<(cz+1)*CHUNK_SIZE;z++){
        const biome=biomeAt(x,z),green=biome==='forest'||biome==='meadow';
        const patch=surfaceNoise(x/3,z/3,119);
        const count=grass?(green?(patch>.36?3:1):(patch>.64?1:0)):(noise(x,z,120)<(green?.12:.56)?1:0);
        const start=transforms.length/16;
        for(let i=0;i<count;i++){
          const salt=130+i*9+(grass?0:60);
          const px=x+(noise(x,z,salt)-.5)*.87,pz=z+(noise(x,z,salt+1)-.5)*.87;
          const size=noise(x,z,salt+2);
          dummy.position.set((px-cx*CHUNK_SIZE)*CELL,terrainHeight(px,pz)+(grass?-.012:.035),(pz-cz*CHUNK_SIZE)*CELL);
          dummy.rotation.set(0,noise(x,z,salt+3)*Math.PI*2,0);
          if(grass){
            const height=(green?.18:.12)+size*(green?.3:.17);
            dummy.scale.set(height*.9,height,height*.9);
            color.set(biome==='forest'?'#63764a':green?'#798849':'#95855d');
            color.lerp(green?greenTip:dryTip,noise(x,z,salt+4)*.6);
          }else{
            const radius=.045+size*.12;dummy.scale.set(radius,.025+size*.065,radius*.75);
            color.set(biome==='highlands'?'#8c9294':green?'#8a8d70':'#97816a');
            color.multiplyScalar(.8+noise(x,z,salt+4)*.45);
          }
          dummy.updateMatrix();transforms.push(...dummy.matrix.elements);colors.push(color.r,color.g,color.b);
        }
        if(count)cells.set(`${x},${z}`,{start,count});
      }
      if(!transforms.length)continue;
      const mesh=new THREE.InstancedMesh(grass?this.grassGeometry:this.stoneGeometry,grass?this.grassMaterial:this.stoneMaterial,transforms.length/16);
      mesh.name=`${grass?'Grass':'Pebbles'} ${cx},${cz}`;
      mesh.position.set(cx*CHUNK_SIZE*CELL,0,cz*CHUNK_SIZE*CELL);
      mesh.instanceMatrix.array.set(transforms);mesh.instanceMatrix.needsUpdate=true;
      mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(colors),3);
      mesh.receiveShadow=true;mesh.computeBoundingSphere();
      this.group.add(mesh);result.push({mesh,matrices:new Float32Array(transforms),cells});
    }
    return result;
  }
}
