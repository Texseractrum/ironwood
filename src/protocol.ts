import { CRAFTS, DEFS, CELL, type Craft, type Kind } from './data';
import { Simulation, building, ownsBuilding, type State } from './simulation';
import {planConveyors,validConveyorPath,type ConveyorPoint} from './conveyors';
import type {XProfile} from './identity';
import type {GatherStrike} from './gathering';
import type {CombatState,CombatEvent} from './combat-data';
import type {Appearance} from './appearance';

export type Action =
  | {type:'conveyors';path:ConveyorPoint[];dir:number}
  | {type:'place';kind:Kind;x:number;z:number;dir:number}
  | {type:'rotate';id:number;dir?:number}
  | {type:'turn';x:number;z:number;dir:number}
  | {type:'dismantle'|'collect'|'feed'|'upgrade';id:number}
  | {type:'commission'|'acknowledge-completion'}
  | {type:'craft';recipe:Craft}
  | {type:'gather';target?:string};
export interface Speech {text:string;expiresAt:number;typing?:boolean}
export interface Player {id:string;name:string;x:number;z:number;color:string;base:{x:number;z:number};xProfile?:XProfile;speech?:Speech;clanId?:string;appearance?:Appearance;combat?:CombatState}
export const TEAM_DISTANCE=CELL*3;
export const CLAN_LIMIT=8;
export type ClanAction={type:'team-invite';targetId:string}|{type:'team-accept'|'team-decline'|'team-cancel';inviteId:string};
export interface TeamInvite {id:string;fromId:string;toId:string;expires:number;fromClanId?:string;toClanId?:string}
export interface ClanSummary {id:string;name:string;members:{id:string;name:string;online:boolean;base:{x:number;z:number}}[]}
export function isClanAction(value:unknown):value is ClanAction {
  if(!value||typeof value!=='object')return false;
  const a=value as Record<string,unknown>,id=a.type==='team-invite'?a.targetId:a.inviteId;
  return typeof a.type==='string'&&['team-invite','team-accept','team-decline','team-cancel'].includes(a.type)&&typeof id==='string'&&id.length>0&&id.length<=100;
}
export interface ChatMessage {id:string;playerId:string;name:string;color:string;text:string;sentAt:number;xProfile?:XProfile}
export interface Base {id:string;name:string;x:number;z:number;color:string;online:boolean}
export type ServerMessage =
  | {type:'combat';event:CombatEvent}
  | {type:'respawn';x:number;z:number}
  | {type:'appearance-saved';appearance:Appearance}
  | {type:'gathered';playerId:string;strike:GatherStrike}
  | {type:'welcome';id:string;token:string;xProfile?:XProfile;chat?:ChatMessage[]}
  | {type:'snapshot';state:State;players:Player[];revision:number}
  | {type:'world';state:State;players:Player[];bases:Base[];explored:string[];revision:number;population:number;clan?:ClanSummary;invites?:TeamInvite[]}
  | {type:'chat';message:ChatMessage}
  | {type:'speech';playerId:string;speech:Speech|null}
  | {type:'result';message:string}
  | {type:'correction';x:number;z:number};
export const ROOM_PATTERN=/^[a-z0-9-]{6,32}$/;
export const CHAT_MAX_LENGTH=180;
export const SPEECH_DURATION=8000;
export function chatText(value:unknown):string {
  if(typeof value!=='string')return '';
  return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,CHAT_MAX_LENGTH);
}
export function isAction(value:unknown):value is Action {
  if(!value||typeof value!=='object')return false;
  const a=value as Record<string,unknown>;
  const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n);
  const dir=(n:unknown)=>integer(n)&&Number(n)>=0&&Number(n)<4;
  switch(a.type){
    case 'gather':return a.target===undefined||(typeof a.target==='string'&&a.target.length>0&&a.target.length<=100);
    case 'craft':return typeof a.recipe==='string'&&Object.hasOwn(CRAFTS,a.recipe);
    case 'place':return typeof a.kind==='string'&&Object.hasOwn(DEFS,a.kind)&&integer(a.x)&&integer(a.z)&&dir(a.dir);
    case 'conveyors':return validConveyorPath(a.path)&&dir(a.dir);
    case 'rotate':return integer(a.id)&&(a.dir===undefined||dir(a.dir));
    case 'turn':return integer(a.x)&&integer(a.z)&&dir(a.dir);
    case 'collect':case 'feed':case 'dismantle':case 'upgrade':return integer(a.id)&&Number(a.id)>0;
    case 'commission':case 'acknowledge-completion':return true;
    default:return false;
  }
}
export function applyAction(sim:Simulation,a:Action):string {
  if(a.type==='conveyors'){
    const plan=planConveyors(sim,a.path,a.dir);if(plan.error)return plan.error;
    let added=0,turned=0;
    for(const tile of plan.tiles){
      if(tile.existing){if(tile.existing.dir!==tile.dir){tile.existing.dir=tile.dir;turned++;}continue;}
      const b=building('conveyor',tile.x,tile.z,tile.dir,sim.state.nextId++);
      if(sim.state.owner)b.owner=sim.state.owner;
      sim.state.buildings.push(b);added++;
    }
    sim.state.inventory.log=(sim.state.inventory.log||0)-plan.cost;sim.state.built+=added;
    if(added||turned){sim.resetChallenge();sim.reindex();}
    return added?`Built ${added} conveyor${added===1?'':'s'} · ${plan.cost} timber.`:turned?'Conveyor route updated.':'Conveyors already connected.';
  }
  if(a.type==='place'){const result=sim.place(a.kind,a.x,a.z,a.dir);return typeof result==='string'?result:`Built ${DEFS[a.kind].name.toLowerCase()}.`;}
  if(a.type==='gather')return sim.gather(a.target);
  if(a.type==='craft')return sim.craft(a.recipe);
  if(a.type==='commission')return sim.completeCommission();
  if(a.type==='acknowledge-completion'){if(sim.state.won)sim.state.campaign.completionSeen=true;return '';}
  if(a.type==='dismantle')return sim.dismantle(a.id)||'Dismantled. Materials returned.';
  if(a.type==='turn'){const b=sim.at(a.x,a.z);return b?applyAction(sim,{type:'rotate',id:b.id,dir:a.dir}):'Building no longer exists.';}
  if(!('id' in a))return 'Unknown game action.';
  const b=sim.state.buildings.find(b=>b.id===a.id);if(!b)return 'Building no longer exists.';
  if(a.type==='collect')return sim.collect(b);
  if(a.type==='feed')return sim.feed(b);
  if(a.type==='upgrade')return sim.upgrade(b);
  if(a.type!=='rotate')return 'Unknown game action.';
  if(!ownsBuilding(sim.state,b))return 'Only the owner and their clan can change these machines.';
  if(Math.hypot(b.x*CELL-sim.state.player.x,b.z*CELL-sim.state.player.z)>CELL*8)return 'Walk closer to rotate this conveyor.';
  if(b.kind!=='conveyor')return 'Only conveyors can be turned while drawing.';
  b.dir=a.dir??(b.dir+1)%4;sim.resetChallenge();sim.reindex();return '';
}

// Validate the whole swept path, not just the destination (which could cross a machine).
export function validMove(sim:Simulation,from:{x:number;z:number},to:{x:number;z:number},seconds:number){
  if(!Number.isFinite(to.x)||!Number.isFinite(to.z))return false;
  const distance=Math.hypot(to.x-from.x,to.z-from.z);
  if(distance>8*Math.min(.5,Math.max(0,seconds))+.12)return false;
  const steps=Math.max(1,Math.ceil(distance/.2));
  for(let i=1;i<=steps;i++)if(!sim.canWalk(from.x+(to.x-from.x)*i/steps,from.z+(to.z-from.z)*i/steps))return false;
  return true;
}
