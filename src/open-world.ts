import {CELL,addStock,isBelt,type Stock} from './data';
import {Simulation,newState,type State} from './simulation';
import {applyAction,type Action,type Player,type Base} from './protocol';
import {baseForSlot,CLAIM_RADIUS,sitesAround,chunkAt,chunkKey} from './terrain';
import {sceneryAround,PLAYER_RADIUS} from './scenery';
import type {XProfile} from './identity';
import {Clans} from './clans';
import {advanceChapters,updateMastery,migrateCampaign} from './progression';
import {Combat} from './combat';
import {combatState} from './combat-data';
import {isAppearance,normalizeAppearance} from './appearance';

export type Progress=Pick<State,'produced'|'unlock'|'delivered'|'deliveryEvents'|'challenge'|'won'|'built'|'gathered'|'campaign'>;
function progressOf(s:Progress):Progress {return {produced:s.produced,unlock:s.unlock,delivered:s.delivered,deliveryEvents:s.deliveryEvents,challenge:s.challenge,won:s.won,built:s.built,gathered:s.gathered,campaign:s.campaign};}
export interface WorldProfile extends Player {
  token:string;inventory:Stock;miningReady:number;progress:Progress;explored:string[];discovered:string[];surveyed?:string[];
}
export function freshProgress():Progress{
  return progressOf(newState());
}
export class SharedWorld {
  sim:Simulation;profiles=new Map<string,WorldProfile>();nextSlot=0;
  clans=new Clans(this);
  combat=new Combat(this);
  constructor(state?:State){
    this.sim=new Simulation(state||{...newState(),openWorld:true,inventory:{},buildings:[],deposits:{},discovered:[],player:{x:16*CELL,z:18*CELL}});
    this.sim.alliedOwners=(a,b)=>{const p=a&&this.profiles.get(a);return !!(p&&this.clans.allied(p,b));};
    this.sim.onProduction=(b,result)=>{const p=b.owner&&this.profiles.get(b.owner);if(p)addStock(this.clans.resources(p).progress.produced,result);};
    this.sim.onDelivery=b=>{const p=b.owner&&this.profiles.get(b.owner);if(p){const progress=this.clans.resources(p).progress;progress.delivered++;progress.deliveryEvents.push(this.sim.state.time);}};
  }
  createProfile(id:string,token:string,name:string):WorldProfile{
    let base=baseForSlot(this.nextSlot++);
    // Older worlds have wider plot spacing. Their saved claims remain reserved,
    // including empty plots that have no buildings to reject this candidate.
    while([...this.profiles.values()].some(p=>Math.hypot(p.base.x-base.x,p.base.z-base.z)<CLAIM_RADIUS*2)
      ||this.sim.state.buildings.some(b=>Math.hypot(b.x-base.x,b.z-base.z)<CLAIM_RADIUS+3))base=baseForSlot(this.nextSlot++);
    const p:WorldProfile={id,token,name:name||`Engineer ${this.nextSlot}`,color:['#e9c77e','#82c9d3','#c4a1e8','#ec9e82','#aad18c','#d994b7','#98adf0','#d0cf8a'][(this.nextSlot-1)%8],x:base.x*CELL,z:base.z*CELL,base,inventory:{...newState().inventory},miningReady:0,progress:freshProgress(),explored:[],discovered:[]};
    // The arrival survey covers your reserved clearing; everything beyond it is fog.
    p.surveyed=[];
    combatState(p);
    for(let x=base.x-CLAIM_RADIUS;x<=base.x+CLAIM_RADIUS;x++)for(let z=base.z-CLAIM_RADIUS;z<=base.z+CLAIM_RADIUS;z++)if(Math.hypot(x-base.x,z-base.z)<=CLAIM_RADIUS)p.surveyed.push(`${x},${z}`);
    this.spawnAtBase(p);
    this.profiles.set(id,p);return p;
  }
  spawnAtBase(p:WorldProfile){
    p.x=p.base.x*CELL;p.z=p.base.z*CELL;
    this.sim.resolveSpawn(p,CLAIM_RADIUS*CELL-PLAYER_RADIUS);
    this.discover(p);
  }
  discover(p:WorldProfile){
    const c=chunkAt(p.x/CELL,p.z/CELL),key=chunkKey(c.x,c.z);if(!p.explored.includes(key))p.explored.push(key);
    p.surveyed??=[];
    this.sim.state.player={x:p.x,z:p.z};this.sim.state.explored=p.surveyed;this.sim.state.discovered=p.discovered;this.sim.discover();
  }
  accountProfile(identity:XProfile,guestToken=''):WorldProfile {
    // Stable X IDs survive handle changes. An existing account always keeps its own base.
    let p=[...this.profiles.values()].find(p=>p.xProfile?.id===identity.id);
    if(!p&&guestToken)p=[...this.profiles.values()].find(p=>!p.xProfile&&p.token===guestToken);
    if(!p)p=this.createProfile(crypto.randomUUID(),'',identity.name);
    p.xProfile=identity;p.name=identity.name;p.token='';
    return p;
  }
  guestProfile(token:string){return token?[...this.profiles.values()].find(p=>!p.xProfile&&p.token===token):undefined;}
  customize(p:WorldProfile,value:unknown):boolean {
    if(!isAppearance(value))return false;
    p.appearance=normalizeAppearance(value);return true;
  }
  bases(online:Set<string>):Base[]{return [...this.profiles.values()].map(p=>({id:p.id,name:p.name,color:p.color,...p.base,online:online.has(p.id)}));}
  action(p:WorldProfile,a:Action):string{
    if(combatState(p).health<=0)return 'You are respawning at your base.';
    const sim=this.sim,s=sim.state;
    if(a.type==='conveyors'&&a.path.some(tile=>[...this.profiles.values()].some(other=>!this.clans.allied(p,other.id)&&Math.hypot(tile.x-other.base.x,tile.z-other.base.z)<CLAIM_RADIUS)))return 'This is another engineer’s base. Build outside its boundary.';
    if(a.type==='place'){
      if([...this.profiles.values()].some(other=>!this.clans.allied(p,other.id)&&Math.hypot(a.x-other.base.x,a.z-other.base.z)<CLAIM_RADIUS))return 'This is another engineer’s base. Build outside its boundary.';
      if(s.buildings.length>=10000)return 'The world has reached its current construction capacity.';
    }
    if('id' in a||a.type==='turn'){
      const b=a.type==='turn'?sim.at(a.x,a.z):sim.byId.get(a.id);
      if(b&&!this.clans.allied(p,b.owner))return 'Only the owner and their clan can change these machines.';
    }
    const resources=this.clans.resources(p);
    s.player={x:p.x,z:p.z};s.owner=p.id;s.base=p.base;s.inventory=resources.inventory;s.unlock=resources.progress.unlock;s.miningReady=p.miningReady;s.discovered=p.discovered;s.explored=p.surveyed??=[];
    if(a.type==='gather'){
      const target=sim.gatherTarget(a.target);
      if(target){const x=target.node?target.x/CELL:target.x,z=target.node?target.z/CELL:target.z;
        if([...this.profiles.values()].some(other=>!this.clans.allied(p,other.id)&&Math.hypot(x-other.base.x,z-other.base.z)<CLAIM_RADIUS))return 'These resources belong to another engineer’s home plot. Explore beyond its boundary.';
      }
    }
    // Bind progress only during the action, never during another owner's production.
    migrateCampaign(resources.progress);const ambient=progressOf(s);Object.assign(s,resources.progress);
    s.clanMembers=p.clanId?this.clans.members(p).map(m=>m.id):undefined;
    let message:string;
    try {
      message=applyAction(sim,a);advanceChapters(s);Object.assign(resources.progress,progressOf(s));
      resources.inventory=s.inventory;p.miningReady=s.miningReady;p.discovered=s.discovered;
      this.combat.equipment(p);
    } finally {Object.assign(s,ambient);}
    this.discover(p);return message;
  }
  resetChallenge(p:WorldProfile){const progress=this.clans.resources(p).progress;progress.challenge={start:this.sim.state.time,windows:0,delivered:progress.delivered,assembled:this.assembled(p.id)};}
  assembled(id:string){const p=this.profiles.get(id);return this.sim.state.buildings.filter(b=>p&&this.clans.allied(p,b.owner)&&b.kind==='assembler').reduce((n,b)=>n+b.produced,0);}
  tick(dt:number,online=new Set<string>()){
    this.sim.tick(dt);
    this.combat.tick(dt,online);
    const seen=new Set<Progress>();
    for(const p of this.profiles.values()){
      const resources=this.clans.resources(p),progress=resources.progress;if(seen.has(progress))continue;seen.add(progress);
      migrateCampaign(progress);
      const state={...this.sim.state,...progress,owner:p.id,clanMembers:p.clanId?this.clans.members(p).map(m=>m.id):undefined,inventory:resources.inventory};
      state.deliveryEvents=state.deliveryEvents.filter(t=>state.time-t<60);
      advanceChapters(state);updateMastery(state);Object.assign(progress,progressOf(state));
    }
  }
  snapshot(p:WorldProfile):State{
    const state=this.sim.state;
    const resources=this.clans.resources(p);
    const buildings=state.buildings.filter(b=>this.clans.allied(p,b.owner)||(Math.abs(b.x-p.x/CELL)<80&&Math.abs(b.z-p.z/CELL)<80));
    migrateCampaign(resources.progress);
    const visible=sitesAround(p.x/CELL,p.z/CELL),deposits=Object.fromEntries(visible.filter(site=>state.deposits[site.id]!==undefined).map(site=>[site.id,state.deposits[site.id]]));
    const harvested=Object.fromEntries(sceneryAround(p.x/CELL,p.z/CELL).filter(n=>state.harvested[n.id]!==undefined).map(n=>[n.id,state.harvested[n.id]]));
    return {...state,...resources.progress,buildings,inventory:resources.inventory,player:{x:p.x,z:p.z},owner:p.id,clanMembers:p.clanId?this.clans.members(p).map(m=>m.id):undefined,base:p.base,deposits,harvested,discovered:p.discovered,explored:p.surveyed??[],miningReady:p.miningReady,combat:this.combat.equipment(p),mobs:this.combat.visible(p)};
  }
  publicPlayer(p:WorldProfile):Player{return {id:p.id,name:p.name,color:p.color,x:p.x,z:p.z,base:p.base,xProfile:p.xProfile,clanId:p.clanId,appearance:normalizeAppearance(p.appearance),combat:this.combat.equipment(p)};}
}
