import {CELL,addStock} from './data';
import {CHUNK_SIZE,CLAIM_RADIUS,chunkAt,noise} from './terrain';
import type {SharedWorld,WorldProfile} from './open-world';
import {MAX_HEALTH,RESPAWN_SECONDS,RESPAWN_PROTECTION,WEAPONS,MOB_TYPES,bestWeapon,combatState,type CombatAction,type CombatEvent,type CombatTarget,type Mob} from './combat-data';

/** Only the shared world runs combat. Clients send targets, never damage or loot. */
export class Combat {
  mobs=new Map<string,Mob>();
  onHit?:(event:CombatEvent)=>void;
  onRespawn?:(player:WorldProfile)=>void;
  private spawnClock=0;
  constructor(private world:SharedWorld){}
  private get now(){return this.world.sim.state.time;}
  equipment(p:WorldProfile){
    const state=combatState(p);state.weapon=bestWeapon(this.world.clans.resources(p).inventory);return state;
  }
  atHome(position:{x:number;z:number}){
    return [...this.world.profiles.values()].some(p=>Math.hypot(position.x/CELL-p.base.x,position.z/CELL-p.base.z)<=CLAIM_RADIUS);
  }
  clearPath(from:{x:number;z:number},to:{x:number;z:number}){
    const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.3));
    for(let i=1;i<steps;i++)if(!this.world.sim.canWalk(from.x+(to.x-from.x)*i/steps,from.z+(to.z-from.z)*i/steps))return false;
    return true;
  }
  action(p:WorldProfile,action:CombatAction,online:Set<string>):string {
    const state=this.equipment(p);
    if(!online.has(p.id))return 'Reconnect to the world to fight.';
    if(state.health<=0)return 'You are respawning at your base.';
    const inventory=this.world.clans.resources(p).inventory;
    if(action.type==='equip'){
      if(action.weapon!=='fists'&&!(inventory[action.weapon]||0))return 'Craft this weapon first.';
      return `${WEAPONS[state.weapon].name} equipped automatically. Press K to attack.`;
    }
    if(this.now<state.attackReady)return '';
    const weapon=WEAPONS[state.weapon];
    if(!action.target){
      const angle=action.angle??0;
      state.attackReady=this.now+weapon.cooldown;state.protectedUntil=0;state.lastHitAt=this.now;
      this.onHit?.({attacker:{kind:'player',id:p.id},fromX:p.x,fromZ:p.z,x:p.x+Math.sin(angle)*weapon.range,z:p.z+Math.cos(angle)*weapon.range,damage:0,killed:false,weapon:state.weapon});
      return '';
    }
    const target=action.target.kind==='player'?this.world.profiles.get(action.target.id):this.mobs.get(action.target.id);
    if(!target)return 'That target is no longer here.';
    if(action.target.kind==='player'){
      const other=target as WorldProfile,health=combatState(other);
      if(!online.has(other.id)||health.health<=0)return 'That engineer is not available to fight.';
      if(this.world.clans.allied(p,other.id))return 'You cannot hurt yourself or your clan.';
      if(health.protectedUntil>this.now)return 'That engineer has respawn protection.';
    }else if((target as Mob).health<=0)return 'That creature has already been defeated.';
    if(Math.hypot(target.x-p.x,target.z-p.z)>weapon.range)return 'Move closer to attack.';
    if(!this.clearPath(p,target))return 'An obstacle blocks your attack.';
    state.attackReady=this.now+weapon.cooldown;state.protectedUntil=0;state.lastHitAt=this.now;
    const from={kind:'player',id:p.id} as const;
    if(action.target.kind==='player'){
      const other=target as WorldProfile,damage=Math.min(combatState(other).health,weapon.damage);
      const killed=this.damagePlayer(other,weapon.damage);
      if(killed)state.kills++;
      this.hit(from,action.target,p,other,damage,killed,state.weapon);
    }else{
      const mob=target as Mob,damage=Math.min(mob.health,weapon.damage);
      mob.health=Math.max(0,mob.health-weapon.damage);mob.targetId=p.id;
      const killed=mob.health===0;
      if(killed){mob.respawnAt=this.now+30;mob.targetId=undefined;state.mobKills++;addStock(inventory,MOB_TYPES[mob.kind].loot);}
      this.hit(from,action.target,p,mob,damage,killed,state.weapon);
      if(killed)return `${MOB_TYPES[mob.kind].name} defeated. Materials added to your supplies.`;
    }
    return '';
  }
  private damagePlayer(p:WorldProfile,amount:number){
    const state=combatState(p);state.health=Math.max(0,state.health-amount);state.lastHitAt=this.now;
    if(state.health>0)return false;
    state.deaths++;state.respawnAt=this.now+RESPAWN_SECONDS;state.protectedUntil=0;
    for(const [id,invite] of this.world.clans.invites)if(invite.fromId===p.id||invite.toId===p.id)this.world.clans.invites.delete(id);
    return true;
  }
  private hit(attacker:CombatTarget,target:CombatTarget,from:{x:number;z:number},to:{x:number;z:number},damage:number,killed:boolean,weapon?:CombatEvent['weapon']){
    this.onHit?.({attacker,target,fromX:from.x,fromZ:from.z,x:to.x,z:to.z,damage,killed,weapon});
  }
  private spawn(players:WorldProfile[]){
    const chunks=new Map<string,{x:number;z:number}>();
    for(const p of players){const c=chunkAt(p.x/CELL,p.z/CELL);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)chunks.set(`${c.x+dx},${c.z+dz}`,{x:c.x+dx,z:c.z+dz});}
    for(const c of chunks.values())for(let i=0;i<2;i++){
      const id=`mob:${c.x}:${c.z}:${i}`;if(this.mobs.has(id)||this.mobs.size>=96)continue;
      const x=(c.x*CHUNK_SIZE+(i?27:5))*CELL,z=(c.z*CHUNK_SIZE+5+noise(c.x,c.z,90+i)*22)*CELL;
      const point={x,z};this.world.sim.resolveSpawn(point,4);
      if(this.atHome(point)||!this.world.sim.canWalk(point.x,point.z))continue;
      const kind=noise(c.x,c.z,95+i)>.5?'wolf':'slime';
      this.mobs.set(id,{id,kind,...point,homeX:point.x,homeZ:point.z,health:MOB_TYPES[kind].health,attackReady:0,respawnAt:0,lastActive:this.now});
    }
  }
  tick(dt:number,online:Set<string>){
    const players=[...online].flatMap(id=>{const p=this.world.profiles.get(id);return p?[p]:[];});
    // A death timer belongs to the profile, so disconnecting does not erase it.
    for(const p of this.world.profiles.values()){
      const state=this.equipment(p);
      if(state.health<=0&&state.respawnAt<=this.now){
        this.world.spawnAtBase(p);state.health=MAX_HEALTH;state.respawnAt=0;
        state.protectedUntil=this.now+RESPAWN_PROTECTION;state.attackReady=this.now;this.onRespawn?.(p);
      }else if(online.has(p.id)&&state.health>0&&state.health<MAX_HEALTH&&this.now-state.lastHitAt>=6&&Math.hypot(p.x/CELL-p.base.x,p.z/CELL-p.base.z)<=CLAIM_RADIUS){
        state.health=Math.min(MAX_HEALTH,state.health+5*dt);
      }
    }
    for(const [id,mob] of this.mobs)if(this.now-mob.lastActive>90)this.mobs.delete(id);
    this.spawnClock-=dt;if(this.spawnClock<=0){this.spawnClock=2;this.spawn(players);}
    const vulnerable=players.filter(p=>combatState(p).health>0&&combatState(p).protectedUntil<=this.now&&!this.atHome(p));
    for(const mob of this.mobs.values()){
      if(!players.some(p=>Math.hypot(p.x-mob.homeX,p.z-mob.homeZ)<CELL*50)){mob.targetId=undefined;continue;}
      mob.lastActive=this.now;
      if(this.atHome(mob)){this.mobs.delete(mob.id);continue;}
      const def=MOB_TYPES[mob.kind];
      if(mob.health<=0){
        if(this.now>=mob.respawnAt&&!players.some(p=>Math.hypot(p.x-mob.homeX,p.z-mob.homeZ)<CELL*5)&&this.world.sim.canWalk(mob.homeX,mob.homeZ)){
          mob.health=def.health;mob.x=mob.homeX;mob.z=mob.homeZ;mob.respawnAt=0;mob.attackReady=this.now+1;
        }
        continue;
      }
      const leashed=Math.hypot(mob.x-mob.homeX,mob.z-mob.homeZ)>CELL*12;
      const target=leashed?undefined:vulnerable.filter(p=>combatState(p).health>0&&Math.hypot(p.x-mob.x,p.z-mob.z)<CELL*7).sort((a,b)=>Math.hypot(a.x-mob.x,a.z-mob.z)-Math.hypot(b.x-mob.x,b.z-mob.z))[0];
      mob.targetId=target?.id;
      const phase=this.now*.2+noise(Math.floor(mob.homeX),Math.floor(mob.homeZ),33)*Math.PI*2;
      const destination=target??{x:mob.homeX+Math.cos(phase)*1.5,z:mob.homeZ+Math.sin(phase)*1.5};
      const dx=destination.x-mob.x,dz=destination.z-mob.z,distance=Math.hypot(dx,dz);
      if(target&&distance<1.8&&this.now>=mob.attackReady&&this.clearPath(mob,target)){
        mob.attackReady=this.now+def.cooldown;
        const damage=Math.min(combatState(target).health,def.damage),killed=this.damagePlayer(target,def.damage);
        this.hit({kind:'mob',id:mob.id},{kind:'player',id:target.id},mob,target,damage,killed);
      }
      if(distance>(target?1.4:.2)){
        const step=Math.min(distance,(target?def.speed:1.3)*dt),next={x:mob.x+dx/distance*step,z:mob.z+dz/distance*step};
        if(!this.atHome(next)){
          if(this.world.sim.canWalk(next.x,mob.z))mob.x=next.x;
          if(this.world.sim.canWalk(mob.x,next.z))mob.z=next.z;
        }
      }
    }
  }
  visible(p:WorldProfile){return [...this.mobs.values()].filter(m=>m.health>0&&Math.hypot(m.x-p.x,m.z-p.z)<CELL*22);}
}
