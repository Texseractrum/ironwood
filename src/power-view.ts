import * as THREE from 'three';
import {CELL} from './data';
import type {Building} from './simulation';

/** Attach to the post's brass coupler or the machine's housing. */
export function powerAnchor(b:Building,floor:(x:number,z:number)=>number){
  const localX=b.kind==='post'?.34:0;
  const height=b.kind==='post'?1.95:b.kind==='windmill'?1.5:b.kind==='steam'||b.kind==='resonator'?2.05:1.2;
  return new THREE.Vector3(b.x*CELL+localX*Math.cos(b.dir*Math.PI/2),floor(b.x,b.z)+height,b.z*CELL+localX*Math.sin(b.dir*Math.PI/2));
}

/** A hanging cable that remains above raised terrain between its endpoints. */
export function powerCable(start:THREE.Vector3,end:THREE.Vector3,ground:(x:number,z:number)=>number){
  const middle=start.clone().lerp(end,.5);middle.y-=Math.min(.85,start.distanceTo(end)*.09);
  for(let i=1;i<32;i++){
    const t=i/32,x=THREE.MathUtils.lerp(start.x,end.x,t),z=THREE.MathUtils.lerp(start.z,end.z,t);
    const minimum=(ground(x,z)+.3-(1-t)**2*start.y-t*t*end.y)/(2*t*(1-t));
    middle.y=Math.max(middle.y,minimum);
  }
  return new THREE.QuadraticBezierCurve3(start,middle,end);
}
