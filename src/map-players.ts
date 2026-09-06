import {CELL} from './data';
import type {Player} from './protocol';

export const NEARBY_MAP_DISTANCE=40*CELL;

// Presence can be seen nearby without surveying somebody else's terrain.
// Engineers farther away retain the existing explored-terrain visibility rule.
export function mapPlayers(players:readonly Player[],ownId:string,position:{x:number;z:number},isExplored:(x:number,z:number)=>boolean){
  return players.filter(player=>player.id!==ownId&&Number.isFinite(player.x)&&Number.isFinite(player.z))
    .map(player=>({player,distance:Math.hypot(player.x-position.x,player.z-position.z)}))
    .map(entry=>({...entry,nearby:entry.distance<=NEARBY_MAP_DISTANCE}))
    .filter(({player,nearby})=>nearby||isExplored(player.x/CELL,player.z/CELL))
    .sort((a,b)=>a.distance-b.distance||a.player.id.localeCompare(b.player.id));
}
