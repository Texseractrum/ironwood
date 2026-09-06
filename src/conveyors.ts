import {CELL, DEFS, DIRECTIONS, isBelt} from './data';
import {ownsBuilding, type Building, type Simulation} from './simulation';

export interface ConveyorPoint {x:number;z:number}
export interface ConveyorTile extends ConveyorPoint {dir:number;existing?:Building}
export const MAX_CONVEYOR_TILES=32;
export const sameTile=(a:ConveyorPoint,b:ConveyorPoint)=>a.x===b.x&&a.z===b.z;
export const directionBetween=(a:ConveyorPoint,b:ConveyorPoint)=>b.x>a.x?0:b.z>a.z?1:b.x<a.x?2:3;
export function emitsToward(b:Building,dir:number){
  return (isBelt(b.kind)||b.kind==='storage'||!!DEFS[b.kind].output||b.kind==='quarry')&&
    (b.dir===dir||(b.kind==='splitter'&&dir!==(b.dir+2)%4));
}

// Keep a continuous stroke even when a fast pointer skips cells. Retracing erases
// the preview back to that tile, so mistakes do not cost any materials.
export function extendConveyorPath(path:ConveyorPoint[],target:ConveyorPoint):ConveyorPoint[]{
  if(!path.length)return [{...target}];
  const result=path.map(p=>({...p})),visited=result.findIndex(p=>sameTile(p,target));
  if(visited>=0)return result.slice(0,visited+1);
  let last=result[result.length-1];
  const dx=target.x-last.x,dz=target.z-last.z;
  const previous=result.length>1?directionBetween(result[result.length-2],last):0;
  const xFirst=Math.abs(dx)>Math.abs(dz)||(Math.abs(dx)===Math.abs(dz)&&previous%2===0);
  for(const axis of xFirst?['x','z'] as const:['z','x'] as const){
    while(last[axis]!==target[axis]&&result.length<MAX_CONVEYOR_TILES){
      const next={...last,[axis]:last[axis]+Math.sign(target[axis]-last[axis])};
      const index=result.findIndex(p=>sameTile(p,next));
      if(index>=0)result.splice(index+1);else result.push(next);
      last=result[result.length-1];
    }
  }
  return result;
}

export function validConveyorPath(value:unknown):value is ConveyorPoint[]{
  if(!Array.isArray(value)||!value.length||value.length>MAX_CONVEYOR_TILES)return false;
  const seen=new Set<string>();
  return value.every((p,i)=>{
    if(!p||!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.z))return false;
    const key=`${p.x},${p.z}`;if(seen.has(key))return false;seen.add(key);
    return !i||Math.abs(p.x-value[i-1].x)+Math.abs(p.z-value[i-1].z)===1;
  });
}

export function planConveyors(sim:Simulation,path:ConveyorPoint[],endDir:number){
  const tiles:ConveyorTile[]=[];
  let cost=0,error:string|null=null,errorIndex=-1;
  const fail=(message:string,index:number)=>{if(!error){error=message;errorIndex=index;}};
  if(!validConveyorPath(path)||!Number.isInteger(endDir)||endDir<0||endDir>3){
    return {tiles,cost,error:'Draw a continuous conveyor route of up to 32 tiles.',errorIndex:0};
  }
  for(let i=0;i<path.length;i++){
    const p=path[i],existing=sim.at(p.x,p.z),next=path[i+1];
    const dir=next?directionBetween(p,next):endDir;
    if(Math.hypot(p.x*CELL-sim.state.player.x,p.z*CELL-sim.state.player.z)>CELL*8)fail('Walk a little closer to build this route.',i);
    if(existing&&!ownsBuilding(sim.state,existing))fail('Only the owner and their clan can connect these machines.',i);
    if(existing&&existing.kind!=='conveyor'){
      if(i===0&&next&&emitsToward(existing,dir))continue;
      const inputSide=i?directionBetween(p,path[i-1]):-1;
      const accepts=isBelt(existing.kind)||existing.kind==='storage'||existing.kind==='depot'||!!DEFS[existing.kind].input;
      if(i===path.length-1&&i>0&&accepts&&(existing.kind==='depot'||inputSide!==existing.dir))continue;
      fail(i===0?'Start at the machine’s output arrow.':i===path.length-1?'Connect to an input side of this machine.':'A machine blocks this route.',i);
      continue;
    }
    tiles.push({...p,dir,existing});
    if(i>0&&!next&&directionBetween(p,path[i-1])===dir)fail('Output points back along this route. Press R to turn the end.',i);
    if(!existing){
      cost+=DEFS.conveyor.cost.log||0;
      const message=sim.placementError('conveyor',p.x,p.z);if(message)fail(message,i);
    }
  }
  const added=tiles.filter(t=>!t.existing).length;
  if(cost>(sim.state.inventory.log||0))fail(`Need ${cost} timber for this route.`,path.length-1);
  const owned=sim.state.buildings.filter(b=>!sim.state.owner||b.owner===sim.state.owner).length;
  if(owned+added>(sim.state.openWorld?300:500))fail('This route exceeds your workshop’s building limit.',path.length-1);
  if(sim.state.openWorld&&sim.state.buildings.length+added>10000)fail('The world has reached its current construction capacity.',path.length-1);
  return {tiles,cost,error,errorIndex};
}

export function conveyorCorner(sim:Simulation,b:ConveyorTile,previous?:ConveyorPoint):number{
  if(previous){const side=directionBetween(b,previous);return side===(b.dir+1)%4?1:side===(b.dir+3)%4?-1:0;}
  for(const side of [(b.dir+2)%4,(b.dir+1)%4,(b.dir+3)%4]){
    const d=DIRECTIONS[side],neighbor=sim.at(b.x+d.x,b.z+d.z);
    const source=b.existing||sim.at(b.x,b.z);
    if(neighbor&&(source?sim.sameFactory(source,neighbor):ownsBuilding(sim.state,neighbor))&&emitsToward(neighbor,(side+2)%4))return side===(b.dir+2)%4?0:side===(b.dir+1)%4?1:-1;
  }
  return 0;
}
