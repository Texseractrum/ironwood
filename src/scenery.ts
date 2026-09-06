import {CELL,SITES,WORLD_RADIUS,type Item} from './data';
import {biomeAt,noise,chunkAt,chunkSites,CHUNK_SIZE,VIEW_RADIUS} from './terrain';

// The renderer and simulation consume these same positions and footprints.
// IDs and the random sequence must remain stable: saves store depleted nodes by ID.
export interface Scenery {
  id:string;kind:'tree'|'rock'|'mineral'|'ruin';x:number;z:number;rotation:number;scale:number;
  radius:number;item:Item;amount:number;name:string;siteId?:string;tier:number;
}
export const PLAYER_RADIUS=.32;
export function islandScenery(){
  const nodes:Scenery[]=[];
  let seed=43;const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<340;i++){
    const a=rng()*Math.PI*2,rad=.53+rng()*.4;
    const x=Math.cos(a)*WORLD_RADIUS.x*CELL*rad,z=Math.sin(a)*WORLD_RADIUS.z*CELL*rad;
    if(SITES.some(p=>Math.hypot(p.x*CELL-x,p.z*CELL-z)<2.7))continue;
    const rotation=rng()*Math.PI*2,scale=.68+rng()*.65,kind=i%4===0?'rock':'tree';
    nodes.push({id:`scenery:${i}`,kind,x,z,rotation,scale,radius:(kind==='tree'?.16:.9)*scale,item:kind==='tree'?'log':'stone',amount:10,name:kind==='tree'?'Ironwood tree':'Weathered rock',tier:0});
  }
  for(const site of SITES)for(let i=0;i<4;i++){
    const a=i*Math.PI/2+.4,kind=site.item==='log'?'tree':'rock',scale=kind==='tree'?.7:.37;
    nodes.push({id:`scenery:${site.id}:${i}`,kind,x:site.x*CELL+Math.cos(a)*1.8,z:site.z*CELL+Math.sin(a)*1.8,rotation:a,scale,radius:(kind==='tree'?.16:.9)*scale,item:site.item,amount:10,name:site.name,siteId:site.id,tier:site.tier});
    if(['coal','copper','crystal'].includes(site.item))nodes.push({id:`scenery:${site.id}:mineral:${i}`,kind:'mineral',x:site.x*CELL+Math.cos(a)*.7,z:site.z*CELL+Math.sin(a)*.7,rotation:0,scale:1,radius:.55,item:site.item,amount:site.tier?6:10,name:site.name,siteId:site.id,tier:site.tier});
  }
  nodes.push({id:'scenery:watchtower',kind:'ruin',x:13,z:-15,rotation:0,scale:1,radius:1.6,item:'stone',amount:40,name:'Ruined watchtower',tier:0});
  return nodes;
}
export const SCENERY=islandScenery();
export const SCENERY_BY_ID=new Map(SCENERY.map(n=>[n.id,n]));
const chunks=new Map<string,Scenery[]>();
export function chunkScenery(cx:number,cz:number):Scenery[]{
  const key=`${cx},${cz}`,cached=chunks.get(key);if(cached)return cached;
  const nodes:Scenery[]=[],minX=cx*CHUNK_SIZE,minZ=cz*CHUNK_SIZE;
  const add=(node:Omit<Scenery,'id'>)=>nodes.push({...node,id:`scenery:p:${cx}:${cz}:${nodes.length}`});
  // Anchor the scatter to the world grid so crossing a chunk never moves trees.
  for(let x=Math.ceil(minX/3)*3;x<minX+CHUNK_SIZE;x+=3)for(let z=Math.ceil(minZ/3)*3;z<minZ+CHUNK_SIZE;z+=3){
    const p=noise(x,z,12),biome=biomeAt(x,z);
    if(cx%3===0&&cz%3===0&&Math.hypot(x-(minX+16),z-(minZ+16))<14)continue;
    if(p>(biome==='forest'?.65:biome==='meadow'?.08:.22))continue;
    const px=x+noise(x,z,13)*2,pz=z+noise(x,z,14)*2;
    if(chunkSites(cx,cz).filter(s=>Number(s.id.split(':').at(-1))<5).some(s=>Math.hypot(s.x-px,s.z-pz)<2))continue;
    const kind=biome==='forest'||biome==='meadow'?'tree':'rock',scale=.6+noise(x,z,15)*.6;
    add({kind,x:px*CELL,z:pz*CELL,rotation:p*30,scale,radius:(kind==='tree'?.16:.9)*scale,item:kind==='tree'?'log':'stone',amount:10,name:kind==='tree'?'Ironwood tree':'Weathered rock',tier:0});
  }
  const sites=chunkSites(cx,cz);
  for(const site of sites.filter(s=>Number(s.id.split(':').at(-1))<5)){
    if(site.item==='log')for(let i=0;i<4;i++){
      const a=i*Math.PI/2;
      add({kind:'tree',x:site.x*CELL+Math.cos(a)*1.9,z:site.z*CELL+Math.sin(a)*1.9,rotation:a,scale:.65,radius:.16*.65,item:'log',amount:10,name:site.name,siteId:site.id,tier:0});
    }else for(let i=0;i<3;i++)add({kind:'mineral',x:site.x*CELL+Math.cos(i*2.1)*.65,z:site.z*CELL+Math.sin(i*2.1)*.65,rotation:i,scale:1,radius:.4,item:site.item,amount:site.tier?6:10,name:site.name,siteId:site.id,tier:site.tier});
  }
  // Append only: existing harvested IDs must continue to refer to the same tree.
  for(const site of sites.filter(s=>Number(s.id.split(':').at(-1))>=5)){
    for(let i=0;i<4;i++){
      const tree=site.item==='log',a=i*Math.PI/2+.35;
      add({kind:tree?'tree':'mineral',x:site.x*CELL+Math.cos(a)*(tree?1.9:.65),z:site.z*CELL+Math.sin(a)*(tree?1.9:.65),rotation:a,scale:tree?.7:1,radius:tree?.12:.4,item:site.item,amount:10,name:site.name,siteId:site.id,tier:0});
    }
  }
  for(let x=3;x<CHUNK_SIZE;x+=4)for(let z=3;z<CHUNK_SIZE;z+=4){
    const px=minX+x+noise(minX+x,minZ+z,121),pz=minZ+z+noise(minX+x,minZ+z,122);
    const homeDistance=Math.hypot(x-16,z-16),p=noise(minX+x,minZ+z,123);
    if(homeDistance<6||p>.68||sites.some(s=>Math.hypot(s.x-px,s.z-pz)<2.4))continue;
    if(nodes.some(n=>Math.hypot(n.x/CELL-px,n.z/CELL-pz)<1.8))continue;
    const kind=p<.43?'tree':'rock',scale=kind==='tree'?.65+p:.65+p*.7;
    add({kind,x:px*CELL,z:pz*CELL,rotation:p*30,scale,radius:(kind==='tree'?.16:.9)*scale,item:kind==='tree'?'log':'stone',amount:10,name:kind==='tree'?'Ironwood tree':'Weathered rock',tier:0});
  }
  if(chunks.size>=256)chunks.delete(chunks.keys().next().value!);chunks.set(key,nodes);return nodes;
}
export function sceneryAround(x:number,z:number,radius=VIEW_RADIUS){
  const c=chunkAt(x,z),nodes:Scenery[]=[];
  for(let cx=c.x-radius;cx<=c.x+radius;cx++)for(let cz=c.z-radius;cz<=c.z+radius;cz++)nodes.push(...chunkScenery(cx,cz));
  return nodes;
}
export function sceneryById(id:string){
  const island=SCENERY_BY_ID.get(id);if(island)return island;
  const match=/^scenery:p:(-?\d+):(-?\d+):(\d+)$/.exec(id);if(!match)return;
  const [cx,cz,index]=match.slice(1).map(Number);
  if(![cx,cz,index].every(Number.isSafeInteger)||Math.abs(cx)>31250||Math.abs(cz)>31250||index>200)return;
  return chunkScenery(cx,cz).find(n=>n.id===id);
}

export const explorationKey=(x:number,z:number)=>`${Math.round(x)},${Math.round(z)}`;
export const SIGHT_RADIUS=5;
