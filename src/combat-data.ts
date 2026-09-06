import type {Stock} from './data';

export const MAX_HEALTH=100;
export const RESPAWN_SECONDS=3;
export const RESPAWN_PROTECTION=5;
export const WEAPONS={
  fists:{name:'Fists',damage:8,range:2.1,cooldown:.65},
  club:{name:'Timber club',damage:18,range:2.8,cooldown:.8},
  sword:{name:'Iron sword',damage:28,range:3.2,cooldown:.6},
  spear:{name:'Steel spear',damage:36,range:5,cooldown:1},
} as const;
export type Weapon=keyof typeof WEAPONS;
/** Equipment tiers, strongest first; clan supplies count as owned equipment. */
export function bestWeapon(inventory:Stock):Weapon{
  return (['spear','sword','club'] as const).find(weapon=>(inventory[weapon]??0)>0)??'fists';
}
export function isWeapon(value:unknown):value is Weapon{return typeof value==='string'&&Object.hasOwn(WEAPONS,value);}
export interface CombatState {
  health:number;weapon:Weapon;attackReady:number;respawnAt:number;protectedUntil:number;
  lastHitAt:number;kills:number;deaths:number;mobKills:number;
}
export function freshCombat():CombatState{return {health:MAX_HEALTH,weapon:'fists',attackReady:0,respawnAt:0,protectedUntil:0,lastHitAt:-100,kills:0,deaths:0,mobKills:0};}
export function combatState(player:{combat?:CombatState}):CombatState{return player.combat??=freshCombat();}
export const MOB_TYPES={
  wolf:{name:'Ironwood wolf',health:60,damage:12,speed:4.1,cooldown:1.2,loot:{log:4,ore:2} as Stock},
  slime:{name:'Aether slime',health:85,damage:16,speed:2.7,cooldown:1.5,loot:{coal:3,copper:2} as Stock},
} as const;
export type MobKind=keyof typeof MOB_TYPES;
export interface Mob {id:string;kind:MobKind;x:number;z:number;homeX:number;homeZ:number;health:number;attackReady:number;respawnAt:number;lastActive:number;targetId?:string}
export interface CombatTarget {kind:'player'|'mob';id:string}
// A swing into empty space has no target and deals zero damage.
export interface CombatEvent {attacker:CombatTarget;target?:CombatTarget;x:number;z:number;fromX:number;fromZ:number;damage:number;weapon?:Weapon;killed:boolean}
export type CombatAction={type:'attack';target?:CombatTarget;angle?:number}|{type:'equip';weapon:Weapon};
export function isCombatAction(value:unknown):value is CombatAction {
  if(!value||typeof value!=='object')return false;
  const a=value as Record<string,unknown>;
  if(a.type==='equip')return isWeapon(a.weapon);
  if(a.type!=='attack'||(a.angle!==undefined&&(typeof a.angle!=='number'||!Number.isFinite(a.angle))))return false;
  if(a.target===undefined)return true;
  if(!a.target||typeof a.target!=='object')return false;
  const target=a.target as Record<string,unknown>;
  return (target.kind==='player'||target.kind==='mob')&&typeof target.id==='string'&&target.id.length>0&&target.id.length<=100;
}
