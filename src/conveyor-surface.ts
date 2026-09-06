import {CELL, DIRECTIONS} from './data';
import type {Simulation} from './simulation';
import {terrainHeight} from './terrain';
import type {ConveyorPoint} from './conveyors';

const STEPS=8;
export interface ConveyorSurface {
  heights:number[];
  center:number;
  key:string;
  level:boolean;
}

/** Level machine foundations, in world metres. Coordinates are in tiles. */
export function foundationHeight(x:number,z:number,openWorld:boolean){
  return openWorld?Math.max(...[[0,0],[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]].map(([dx,dz])=>terrainHeight(x+dx,z+dz))):0;
}

/** Belts follow a common height field, so neighboring edges always meet.
 * Near a machine (including junctions), the surface ramps onto its level pad.
 * Heights are derived from terrain and buildings; saves need no extra state.
 */
export function conveyorSurface(sim:Simulation,tile:ConveyorPoint):ConveyorSurface{
  const pads:{x:number;z:number;height:number}[]=[];
  if(sim.state.openWorld)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const b=sim.at(tile.x+dx,tile.z+dz);
    if(b&&b.kind!=='conveyor')pads.push({x:b.x,z:b.z,height:foundationHeight(b.x,b.z,true)});
  }
  const heights:number[]=[];
  for(let z=0;z<=STEPS;z++)for(let x=0;x<=STEPS;x++){
    const wx=tile.x-.5+x/STEPS,wz=tile.z-.5+z/STEPS;
    const ground=sim.state.openWorld?terrainHeight(wx,wz):0;
    let height=ground;
    for(const pad of pads){
      const distance=Math.max(Math.abs(wx-pad.x),Math.abs(wz-pad.z));
      const weight=Math.max(0,Math.min(1,(1-distance)*2));
      // Each machine's pad is at least as high as the ground along its edge.
      height=Math.max(height,ground+(pad.height-ground)*weight);
    }
    heights.push(height);
  }
  const center=heights[(STEPS/2)*(STEPS+1)+STEPS/2];
  return {heights,center,key:heights.join(','),level:heights.every(h=>Math.abs(h-center)<1e-6)};
}

/** Sample local tile coordinates using the ground mesh's triangle diagonal. */
export function conveyorSurfaceHeight(surface:ConveyorSurface,x:number,z:number){
  const gx=Math.max(0,Math.min(STEPS,(x+.5)*STEPS)),gz=Math.max(0,Math.min(STEPS,(z+.5)*STEPS));
  const ix=Math.min(STEPS-1,Math.floor(gx)),iz=Math.min(STEPS-1,Math.floor(gz)),u=gx-ix,v=gz-iz;
  const a=surface.heights[iz*(STEPS+1)+ix],b=surface.heights[(iz+1)*(STEPS+1)+ix],c=surface.heights[iz*(STEPS+1)+ix+1];
  return u+v<=1?a+(c-a)*u+(b-a)*v:surface.heights[(iz+1)*(STEPS+1)+ix+1]*(u+v-1)+b*(1-u)+c*(1-v);
}

/** Continuous entry-to-exit path, including side feeds and mountain corners. */
export function conveyorItemPosition(dir:number,corner:number,travel:number){
  const progress=Math.max(0,Math.min(1,travel)),out=DIRECTIONS[dir];
  if(corner){
    const from=DIRECTIONS[(dir+(corner===1?1:3))%4];
    const entry=(1-Math.sin(progress*Math.PI/2))*CELL/2,exit=(1-Math.cos(progress*Math.PI/2))*CELL/2;
    return {x:from.x*entry+out.x*exit,z:from.z*entry+out.z*exit};
  }
  return {x:out.x*(progress-.5)*CELL,z:out.z*(progress-.5)*CELL};
}
