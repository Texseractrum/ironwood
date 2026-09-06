import * as THREE from 'three';
import {CELL,ITEMS,type Item} from './data';
import {BIOMES,biomeAt,chunkAt,CHUNK_SIZE,CLAIM_RADIUS,sitesAround,terrainHeight} from './terrain';
import type {Base} from './protocol';
import {sceneryAround,type Scenery} from './scenery';
import type {Simulation} from './simulation';
import {createTerrainMaterial,surfaceNoise} from './terrain-surface';
import {TerrainCover} from './terrain-cover';

// Regenerate only on chunk crossings. All decorative meshes share a small set of batches.
export class TerrainView {
  ground=new THREE.Group();claims=new THREE.Group();key='';claimKey='';
  private earth:THREE.MeshStandardMaterial;
  private cover:TerrainCover;
  private depositGeometry=new THREE.OctahedronGeometry(.8);
  private ringGeometry=new THREE.RingGeometry(1.05,1.19,6).rotateX(-Math.PI/2);
  private mats=new Map<Item,THREE.MeshStandardMaterial>();
  private rings=new Map<Item,THREE.MeshBasicMaterial>();
  resourceMeshes:THREE.InstancedMesh[]=[];
  surface?:THREE.Mesh;
  private siteRings:{mesh:THREE.InstancedMesh;sites:ReturnType<typeof sitesAround>;matrices:THREE.Matrix4[]}[]=[];
  private batches:{mesh:THREE.InstancedMesh;nodes:Scenery[];matrices:THREE.Matrix4[];visible:boolean[]}[]=[];
  private resourceState?:object;private resourceRevision=-1;
  constructor(private scene:THREE.Scene,private assets:Map<string,THREE.Group>,private sim:Simulation,anisotropy=1){
    this.earth=createTerrainMaterial(anisotropy);this.cover=new TerrainCover(sim);
    scene.add(this.ground,this.claims,this.cover.group);
  }
  update(x:number,z:number,bases:Base[],own:string){
    const chunk=chunkAt(x/CELL,z/CELL),key=`${chunk.x},${chunk.z}`;
    if(key!==this.key){this.key=key;this.rebuild(chunk.x,chunk.z);this.cover.update(chunk.x,chunk.z);}
    if(this.resourceState!==this.sim.state.harvested||this.resourceRevision!==this.sim.revision){this.resourceState=this.sim.state.harvested;this.resourceRevision=this.sim.revision;this.syncResources();this.cover.syncBuildings();}
    const near=bases.filter(b=>Math.abs(b.x-x/CELL)<85&&Math.abs(b.z-z/CELL)<85);
    const claimKey=near.map(b=>`${b.id}:${b.name}:${b.id===own}`).join('|');
    if(claimKey!==this.claimKey){
      this.claimKey=claimKey;
      for(const obj of [...this.claims.children]){obj.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){if(o instanceof THREE.Mesh)o.geometry.dispose();const mat=o.material as THREE.MeshBasicMaterial;mat.map?.dispose();mat.dispose();}});this.claims.remove(obj);}
      for(const b of near){
        const root=new THREE.Group();root.position.set(b.x*CELL,terrainHeight(b.x,b.z),b.z*CELL);
        const ringGeometry=new THREE.RingGeometry((CLAIM_RADIUS-.08)*CELL,CLAIM_RADIUS*CELL,96).rotateX(-Math.PI/2),positions=ringGeometry.getAttribute('position');
        for(let i=0;i<positions.count;i++)positions.setY(i,terrainHeight(b.x+positions.getX(i)/CELL,b.z+positions.getZ(i)/CELL)-root.position.y+.04);
        ringGeometry.computeVertexNormals();
        const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:b.id===own?'#edd296':b.color,transparent:true,opacity:.45,side:THREE.DoubleSide}));root.add(ring);
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.06,3.4,6),new THREE.MeshStandardMaterial({color:'#685443'}));pole.position.set(-.85,1.7,-.85);root.add(pole);
        const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.8),new THREE.MeshBasicMaterial({color:b.color,side:THREE.DoubleSide}));flag.position.set(-.2,2.9,-.85);root.add(flag);
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const c=canvas.getContext('2d')!;c.fillStyle='#263b31e8';c.roundRect(0,0,512,80,12);c.fill();c.fillStyle='#fff4d6';c.textAlign='center';c.font='600 28px sans-serif';c.fillText(b.id===own?'YOUR HOME':b.name+'’s workshop',256,49);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false})),isOwn=b.id===own;label.position.y=isOwn?4.1:4.3;label.scale.set(isOwn?5.2:6.5,isOwn?.8:1,1);root.add(label);this.claims.add(root);
      }
    }
  }
  private rebuild(cx:number,cz:number){
    this.batches=[];this.resourceMeshes=[];this.siteRings=[];this.resourceState=undefined;
    for(const obj of [...this.ground.children]){if(obj instanceof THREE.InstancedMesh)obj.dispose();else if(obj instanceof THREE.Mesh)obj.geometry.dispose();this.ground.remove(obj);}
    const vertices:number[]=[],colors:number[]=[],uvs:number[]=[],vegetation:number[]=[];
    const minX=(cx-2)*CHUNK_SIZE,minZ=(cz-2)*CHUNK_SIZE,maxX=(cx+3)*CHUNK_SIZE,maxZ=(cz+3)*CHUNK_SIZE;
    const color=new THREE.Color(),dry=new THREE.Color('#a69768'),stone=new THREE.Color('#8b8c7c'),summit=new THREE.Color('#c7c5b7');
    for(let x=minX;x<maxX;x+=2)for(let z=minZ;z<maxZ;z+=2){
      for(const [dx,dz] of [[0,0],[0,2],[2,0],[2,0],[0,2],[2,2]]){
        const px=x+dx,pz=z+dz,biome=biomeAt(px,pz),green=biome==='meadow'||biome==='forest';
        const height=terrainHeight(px,pz);
        vertices.push(px*CELL,height-.015,pz*CELL);uvs.push(px*CELL/7,pz*CELL/7);vegetation.push(green?Math.max(0,1-height/8):0);
        color.set(BIOMES[biome].color);
        if(green)color.lerp(dry,Math.max(0,surfaceNoise(px/5,pz/5,111)-.48)*.75);
        color.lerp(stone,Math.min(1,Math.max(0,(height-1.5)/7)));color.lerp(summit,Math.min(.75,Math.max(0,(height-10)/7)));
        color.multiplyScalar(.72+surfaceNoise(px/6,pz/6,112)*.34+surfaceNoise(px/1.7,pz/1.7,113)*.12);
        colors.push(color.r,color.g,color.b);
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('vegetation',new THREE.Float32BufferAttribute(vegetation,1));geometry.computeVertexNormals();
    const ground=new THREE.Mesh(geometry,this.earth);ground.receiveShadow=true;ground.castShadow=true;this.surface=ground;this.ground.add(ground);
    const trees:THREE.Matrix4[]=[],rocks:THREE.Matrix4[]=[],dummy=new THREE.Object3D();
    const nodes=sceneryAround(cx*CHUNK_SIZE+16,cz*CHUNK_SIZE+16),treeNodes=nodes.filter(n=>n.kind==='tree'),rockNodes=nodes.filter(n=>n.kind==='rock');
    for(const [group,matrices] of [[treeNodes,trees],[rockNodes,rocks]] as const)for(const n of group){
      dummy.position.set(n.x,terrainHeight(n.x/CELL,n.z/CELL),n.z);dummy.rotation.set(0,n.rotation,0);dummy.scale.setScalar(n.scale);dummy.updateMatrix();matrices.push(dummy.matrix.clone());
    }
    const sites=sitesAround(cx*32+16,cz*32+16);
    this.instanceAsset('tree',trees,treeNodes);this.instanceAsset('rock',rocks,rockNodes);
    for(const item of ['log','ore','coal','copper','crystal'] as Item[]){
      const group=sites.filter(s=>s.item===item);
      if(!this.mats.has(item))this.mats.set(item,new THREE.MeshStandardMaterial({color:ITEMS[item].color,roughness:.65,emissive:item==='crystal'?'#5b3288':'#000000',emissiveIntensity:.4}));
      if(!this.rings.has(item))this.rings.set(item,new THREE.MeshBasicMaterial({color:ITEMS[item].color,side:THREE.DoubleSide}));
      const rings=new THREE.InstancedMesh(this.ringGeometry,this.rings.get(item)!,group.length);
      const ringMatrices:THREE.Matrix4[]=[];rings.userData.resourceIds=group.map(s=>s.id);this.resourceMeshes.push(rings);
      const mineralNodes=nodes.filter(n=>n.kind==='mineral'&&n.item===item);
      const ore=new THREE.InstancedMesh(this.depositGeometry,this.mats.get(item)!,mineralNodes.length),matrices:THREE.Matrix4[]=[];
      group.forEach((s,i)=>{
        dummy.position.set(s.x*CELL,terrainHeight(s.x,s.z)+.035,s.z*CELL);dummy.scale.setScalar(1);dummy.rotation.set(0,0,0);dummy.updateMatrix();rings.setMatrixAt(i,dummy.matrix);ringMatrices.push(dummy.matrix.clone());
      });
      mineralNodes.forEach((node,i)=>{dummy.position.set(node.x,terrainHeight(node.x/CELL,node.z/CELL)+.45,node.z);dummy.scale.set(.7,item==='crystal'?1.8:.95,.7);dummy.rotation.set(.15,node.rotation,0);dummy.updateMatrix();matrices.push(dummy.matrix.clone());ore.setMatrixAt(i,dummy.matrix);});
      this.siteRings.push({mesh:rings,sites:group,matrices:ringMatrices});
      this.ground.add(rings);if(item!=='log'){ore.castShadow=true;this.ground.add(ore);this.track(ore,mineralNodes,matrices);}else ore.dispose();
    }
  }
  private instanceAsset(name:string,matrices:THREE.Matrix4[],nodes:Scenery[]){
    if(!matrices.length)return;const root=this.assets.get(name)!;root.updateMatrixWorld(true);
    root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const mesh=new THREE.InstancedMesh(o.geometry,o.material,matrices.length);const transforms=matrices.map(m=>m.clone().multiply(o.matrixWorld));transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;this.ground.add(mesh);this.track(mesh,nodes,transforms);});
  }
  private track(mesh:THREE.InstancedMesh,nodes:Scenery[],matrices:THREE.Matrix4[]){mesh.userData.resourceIds=nodes.map(n=>n.id);this.resourceMeshes.push(mesh);this.batches.push({mesh,nodes,matrices,visible:nodes.map(()=>true)});}
  private syncResources(){
    const hidden=new THREE.Matrix4().makeScale(0,0,0);
    for(const {mesh,sites,matrices} of this.siteRings){sites.forEach((site,i)=>mesh.setMatrixAt(i,this.sim.remaining(site)>0&&!this.sim.at(site.x,site.z)?matrices[i]:hidden));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
    for(const batch of this.batches){let changed=false;
      batch.nodes.forEach((node,i)=>{const visible=this.sim.sceneryVisible(node);if(visible===batch.visible[i])return;batch.visible[i]=visible;batch.mesh.setMatrixAt(i,visible?batch.matrices[i]:hidden);changed=true;});
      if(changed){batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.computeBoundingSphere();}
    }
  }
}
