import { CELL, type Item, type Site } from './data';

export const WORLD_SEED=739421;
export const CHUNK_SIZE=32;
export const VIEW_RADIUS=2;
export const CLAIM_RADIUS=12;
export type Biome='meadow'|'forest'|'badlands'|'highlands';
export const BIOMES:Record<Biome,{name:string;color:string;description:string}>={
  meadow:{name:'Green meadows',color:'#99ab71',description:'Open ground for your workshop'},
  forest:{name:'Ironwood forest',color:'#607e59',description:'Timber and sheltered clearings'},
  badlands:{name:'Copper badlands',color:'#b99a73',description:'Copper and coal among the rocks'},
  highlands:{name:'Aether highlands',color:'#8b94a3',description:'Look for rare crystal deposits'}
};
export function noise(x:number,z:number,salt=0){
  let n=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^Math.imul(salt+WORLD_SEED,1442695041);
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;
}
function smoothNoise(x:number,z:number){
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const sx=u*u*(3-2*u),sz=v*v*(3-2*v);
  const a=noise(ix,iz,8)*(1-sx)+noise(ix+1,iz,8)*sx,b=noise(ix,iz+1,8)*(1-sx)+noise(ix+1,iz+1,8)*sx;
  return a*(1-sz)+b*sz;
}
export function biomeAt(x:number,z:number):Biome {
  const n=smoothNoise(x/48,z/48);return n<.3?'forest':n<.54?'meadow':n<.72?'badlands':'highlands';
}
export const chunkAt=(x:number,z:number)=>({x:Math.floor(x/CHUNK_SIZE),z:Math.floor(z/CHUNK_SIZE)});
export const chunkKey=(x:number,z:number)=>`${x},${z}`;
export const traversable=(x:number,z:number)=>Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x)<1_000_000&&Math.abs(z)<1_000_000;
const siteCache=new Map<string,Site[]>();
export function chunkSites(cx:number,cz:number):Site[]{
  const key=chunkKey(cx,cz),cached=siteCache.get(key);if(cached)return cached;
  const specs:[Item,number,number,string,number][]=[
    ['log',8,18,'Timber grove',4000],['ore',23,18,'Iron seam',3000],
    ['coal',7,6,'Coal bed',900],['copper',24,7,'Copper vein',700]
  ];
  if(noise(cx,cz,41)<.22)specs.push(['crystal',16,28,'Aether spires',140]);
  const sites=specs.map(([item,x,z,name,amount],i)=>({id:`p:${cx}:${cz}:${i}`,x:cx*CHUNK_SIZE+x,z:cz*CHUNK_SIZE+z,item,name,amount:amount+Math.floor(noise(cx,cz,i+50)*amount*.4),tier:item==='crystal'?1:0}));
  // Keep the original seams and IDs in place for saved factories. Infill brings
  // every everyday material within a short walk of the central workshop.
  const nearby:[Item,number,number,string,number][]=[
    ['log',12,20,'Workshop copse',1800],['ore',20,20,'Iron outcrop',1500],
    ['coal',11,11,'Shallow coal bed',700],['copper',21,11,'Copper outcrop',700]
  ];
  nearby.forEach(([item,x,z,name,amount],i)=>sites.push({id:`p:${cx}:${cz}:${i+5}`,x:cx*CHUNK_SIZE+x,z:cz*CHUNK_SIZE+z,item,name,amount,tier:0}));
  if(siteCache.size>=256)siteCache.delete(siteCache.keys().next().value!);
  siteCache.set(key,sites);return sites;
}
export function sitesAround(x:number,z:number,radius=VIEW_RADIUS):Site[]{
  const c=chunkAt(x,z),sites:Site[]=[];
  for(let cx=c.x-radius;cx<=c.x+radius;cx++)for(let cz=c.z-radius;cz<=c.z+radius;cz++)sites.push(...chunkSites(cx,cz));
  return sites;
}
export function proceduralSite(id:string):Site|undefined{
  const m=/^p:(-?\d+):(-?\d+):([0-8])$/.exec(id);if(!m)return;
  if(!traversable(Number(m[1])*CHUNK_SIZE,Number(m[2])*CHUNK_SIZE))return;
  return chunkSites(Number(m[1]),Number(m[2])).find(s=>s.id===id);
}
export function siteAt(x:number,z:number):Site|undefined{const c=chunkAt(x,z);return chunkSites(c.x,c.z).find(p=>p.x===x&&p.z===z);}

const smoothstep=(a:number,b:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);};
/** World-space elevation. Clearings and deposit pads stay level for factories. */
function terrainVertex(x:number,z:number){
  const c=chunkAt(x,z),localX=x-c.x*CHUNK_SIZE,localZ=z-c.z*CHUNK_SIZE;
  const clearing=smoothstep(7,13,Math.hypot(localX-16,localZ-16));
  let pad=1;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const site of chunkSites(c.x+dx,c.z+dz)){
    const distance=Math.hypot(site.x-x,site.z-z);
    if(distance<5)pad=Math.min(pad,smoothstep(2.5,5,distance));
  }
  const ridge=1-Math.abs(smoothNoise(x/11,z/11)*2-1);
  const mountain=Math.pow(ridge,3)*(8+smoothNoise(x/27+13,z/27-7)*13);
  const foothills=smoothNoise(x/5-17,z/5+9)*1.8;
  return (mountain+foothills)*clearing*pad;
}
const heightCache=new Map<string,number>();
function heightVertex(x:number,z:number){
  const key=`${x},${z}`,cached=heightCache.get(key);if(cached!==undefined)return cached;
  const height=terrainVertex(x,z);
  if(heightCache.size>=60000)heightCache.clear();heightCache.set(key,height);return height;
}
// Match the rendered triangles, including on slopes and across chunk boundaries.
export function terrainHeight(x:number,z:number){
  const ix=Math.floor(x/2)*2,iz=Math.floor(z/2)*2,u=(x-ix)/2,v=(z-iz)/2;
  const a=heightVertex(ix,iz),b=heightVertex(ix,iz+2),c=heightVertex(ix+2,iz);
  return u+v<=1?a+(c-a)*u+(b-a)*v:heightVertex(ix+2,iz+2)*(u+v-1)+b*(1-u)+c*(1-v);
}
/** Rise per metre on the same triangle used by the ground mesh. */
export function terrainSlope(x:number,z:number){
  const ix=Math.floor(x/2)*2,iz=Math.floor(z/2)*2;
  const b=heightVertex(ix,iz+2),c=heightVertex(ix+2,iz);
  const corner=heightVertex(ix+(x-ix+z-iz<=2?0:2),iz+(x-ix+z-iz<=2?0:2));
  return Math.hypot(c-corner,b-corner)/(2*CELL);
}
const footprint=[[0,0],[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
// Coordinates and radius are in tiles; elevation is in rendered world metres.
// Every slope is climbable. Lift the boots over the whole footprint on steep faces.
export function terrainFootHeight(x:number,z:number,radius:number){
  return Math.max(...footprint.map(([dx,dz])=>terrainHeight(x+dx*radius,z+dz*radius)));
}
// Adjacent chunks keep new neighbors a short walk apart, with room for private claims.
// Saved profiles retain their explicit coordinates from older, wider layouts.
export function baseForSlot(slot:number){
  if(!Number.isSafeInteger(slot)||slot<0)throw new Error('Invalid base slot');
  if(slot===0)return {x:16,z:16};
  const layer=Math.ceil((Math.sqrt(slot+1)-1)/2),side=layer*2,max=(2*layer+1)**2-1,d=max-slot;
  let x:number,z:number;
  if(d<side){x=layer-d;z=-layer;}else if(d<side*2){x=-layer;z=-layer+d-side;}else if(d<side*3){x=-layer+d-side*2;z=layer;}else{x=layer;z=layer-(d-side*3);}
  return {x:x*CHUNK_SIZE+16,z:z*CHUNK_SIZE+16};
}
