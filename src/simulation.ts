import { DEFS, DIRECTIONS, SITES, ITEMS, CELL, CRAFTS, WINDMILL_SPACING, POWER_LINK_RANGE, POWER_LOAD_RANGE, addStock, canAfford, entries, isBelt, onIsland, total, type Kind, type Item, type Stock, type Craft } from './data';
import { sitesAround, siteAt, proceduralSite, traversable } from './terrain';
import type {CombatState,Mob} from './combat-data';
import type {GatherStrike} from './gathering';
import {SCENERY,sceneryById,sceneryAround,PLAYER_RADIUS,SIGHT_RADIUS,explorationKey,type Scenery} from './scenery';
import {CHAPTERS,BEACON_COST,freshCampaign,migrateCampaign,advanceChapters,updateMastery,canComplete,chestCapacity,machineDuration,tier,upgradeOptions,upgradeRefund,type Campaign} from './progression';

export interface Building {
  id:number; kind:Kind; x:number; z:number; dir:number;
  input:Stock; output:Stock; progress:number; active:boolean;
  status:string; power:number; cooldown:number; cursor:number; route:number; produced:number;
  item?:Item; from?:number; travel:number; events:number[]; fuelRemaining:number; owner?:string; level?:number;
}
export interface State {
  combat?:CombatState;mobs?:Mob[];
  version:1; time:number; nextId:number; buildings:Building[]; inventory:Stock;
  produced:Stock; player:{x:number;z:number}; unlock:number; delivered:number;
  deliveryEvents:number[]; challenge:{start:number;windows:number;delivered:number;assembled:number};
  won:boolean; built:number; gathered:number; campaign:Campaign;
  deposits:Record<string,number>; discovered:string[]; miningReady:number;
  harvested:Record<string,number>; explored:string[];
  openWorld?:boolean; owner?:string; base?:{x:number;z:number};clanMembers?:string[];
}
export function ownsBuilding(state:State,b:Building){return !state.owner||b.owner===state.owner||!!(b.owner&&state.clanMembers?.includes(b.owner));}
export const BUFFER=12;
export const SAVE_KEY='ironwood-save-v1';
export function building(kind:Kind,x:number,z:number,dir:number,id:number):Building {
  return {kind,x,z,dir,id,input:{},output:{},progress:0,active:false,status:'Ready',power:0,cooldown:0,cursor:0,route:0,travel:0,produced:0,events:[],fuelRemaining:0};
}

const STOPPED_STATUSES=new Set(['Needs input','Needs fuel','Deposit exhausted','Output blocked']);
export function isStopped(b:Building){
  const apparatus=isBelt(b.kind)||!!DEFS[b.kind].duration||!!DEFS[b.kind].fuel;
  return apparatus&&(STOPPED_STATUSES.has(b.status)||(b.status==='Insufficient power'&&b.power<=0));
}

export function newState():State {
  const s:State={version:1,time:0,nextId:1,buildings:[],inventory:{log:90,ore:30,plank:20,ingot:10},produced:{},player:{x:0,z:2.5*CELL},unlock:0,delivered:0,deliveryEvents:[],challenge:{start:0,windows:0,delivered:0,assembled:0},won:false,built:0,gathered:0,campaign:freshCampaign(),deposits:Object.fromEntries(SITES.map(p=>[p.id,p.amount])),discovered:[],miningReady:0,harvested:{},explored:[]};
  // Supplies arrive with the engineer; every building is placed by the player.
  return s;
}

export class Simulation {
  state:State;
  map = new Map<string,Building>();
  byId=new Map<number,Building>();
  supply=0; demand=0; revision=0;
  powerEdges: [Building,Building][]=[];
  private exploredSource?:string[];private exploredCells=new Set<string>();private lastSurvey='';
  onProduction?:(b:Building,result:Stock)=>void;
  onDelivery?:(b:Building)=>void;
  onGather?:(strike:GatherStrike)=>void;
  alliedOwners?:(a:string|undefined,b:string|undefined)=>boolean;
  sameFactory(a:Building,b:Building){
    if(!this.state.openWorld||a.owner===b.owner)return true;
    if(this.alliedOwners)return this.alliedOwners(a.owner,b.owner);
    return !!(a.owner&&b.owner&&this.state.clanMembers?.includes(a.owner)&&this.state.clanMembers.includes(b.owner));
  }
  constructor(state=newState()) {migrateCampaign(state);this.state=state;this.reindex();this.discover();}
  at(x:number,z:number){return this.map.get(`${x},${z}`);}
  reindex(){this.map.clear();this.byId.clear();for(const b of this.state.buildings){this.map.set(`${b.x},${b.z}`,b);this.byId.set(b.id,b);}this.revision++;this.computePower();}
  get sites(){return this.state.openWorld?sitesAround(this.state.player.x/CELL,this.state.player.z/CELL):SITES;}
  siteAt(x:number,z:number){return this.state.openWorld?siteAt(x,z):SITES.find(p=>p.x===x&&p.z===z);}
  remaining(site:typeof SITES[number]){return this.state.deposits[site.id]??site.amount;}
  generation(b:Building){const d=DEFS[b.kind];return d.generation&&(!d.fuel||b.fuelRemaining>0)?d.generation:0;}
  output(b:Building):Stock {return b.kind==='quarry'?{[this.siteAt(b.x,b.z)?.item||'coal']:1}:DEFS[b.kind].output||{};}
  get scenery(){return this.state.openWorld?sceneryAround(this.state.player.x/CELL,this.state.player.z/CELL):SCENERY;}
  resourceSite(id:string){return this.state.openWorld?proceduralSite(id):SITES.find(s=>s.id===id);}
  private exploration(){
    if(this.exploredSource!==this.state.explored){this.exploredSource=this.state.explored;this.exploredCells=new Set(this.state.explored);this.lastSurvey='';}
    return this.exploredCells;
  }
  isExplored(x:number,z:number){return this.exploration().has(explorationKey(x,z));}
  discover(){
    const cells=this.exploration(),px=this.state.player.x/CELL,pz=this.state.player.z/CELL,key=explorationKey(px,pz);
    if(this.lastSurvey===key)return;this.lastSurvey=key;
    const cx=Math.round(px),cz=Math.round(pz);
    for(let x=cx-SIGHT_RADIUS;x<=cx+SIGHT_RADIUS;x++)for(let z=cz-SIGHT_RADIUS;z<=cz+SIGHT_RADIUS;z++){
      if(Math.hypot(x-cx,z-cz)>SIGHT_RADIUS||!(this.state.openWorld?traversable(x,z):onIsland(x,z)))continue;
      const cell=explorationKey(x,z);if(!cells.has(cell)){cells.add(cell);this.state.explored.push(cell);}
    }
    for(const p of this.sites)if(!this.state.discovered.includes(p.id)&&this.isExplored(p.x,p.z)){this.state.discovered.push(p.id);this.revision++;}
  }
  sceneryRemaining(node:Scenery){
    const left=this.state.harvested[node.id]??node.amount;
    return node.siteId?Math.min(left,this.state.deposits[node.siteId]??this.resourceSite(node.siteId)?.amount??0):left;
  }
  sceneryVisible(node:Scenery){
    // Keep legacy factories usable if they were built through former decoration.
    if(node.siteId){const site=this.resourceSite(node.siteId);const b=site&&this.at(site.x,site.z);if(b&&['lumber','mine','quarry','steam'].includes(b.kind))return false;}
    return this.sceneryRemaining(node)>0&&!this.state.buildings.some(b=>this.overlapsScenery(node,b.x,b.z));
  }
  overlapsScenery(node:Scenery,x:number,z:number){
    return Math.hypot(Math.max(0,Math.abs(node.x-x*CELL)-CELL/2),Math.max(0,Math.abs(node.z-z*CELL)-CELL/2))<node.radius;
  }
  canWalk(x:number,z:number){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!(this.state.openWorld?traversable(x/CELL,z/CELL):onIsland(x/CELL,z/CELL)))return false;
    if(this.state.buildings.some(b=>!isBelt(b.kind)&&Math.abs(x-b.x*CELL)<(b.kind==='post'?.325:.85)+PLAYER_RADIUS&&Math.abs(z-b.z*CELL)<(b.kind==='post'?.325:.85)+PLAYER_RADIUS))return false;
    const nodes=this.state.openWorld?sceneryAround(x/CELL,z/CELL,1):SCENERY;
    return !nodes.some(n=>Math.hypot(x-n.x,z-n.z)<n.radius+PLAYER_RADIUS&&this.sceneryVisible(n));
  }
  movePlayer(dx:number,dz:number){
    const p=this.state.player,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.15));
    for(let i=0;i<steps;i++){
      if(this.canWalk(p.x+dx/steps,p.z))p.x+=dx/steps;
      if(this.canWalk(p.x,p.z+dz/steps))p.z+=dz/steps;
    }
  }
  resolveSpawn(position:{x:number;z:number},maxRadius=8){
    if(this.canWalk(position.x,position.z))return;
    // Older saves could stand inside scenery before it had collision shapes.
    for(let radius=.25;radius<=maxRadius;radius+=.25)for(let i=0;i<32;i++){
      const a=i*Math.PI/16,x=position.x+Math.cos(a)*radius,z=position.z+Math.sin(a)*radius;
      if(this.canWalk(x,z)){position.x=x;position.z=z;return;}
    }
  }
  computePower(){
    const nodes=this.state.buildings.filter(b=>DEFS[b.kind].generation||b.kind==='post');
    const components:Building[][]=[];const seen=new Set<number>();this.powerEdges=[];
    for(const node of nodes){
      if(seen.has(node.id))continue;
      const comp=[node];seen.add(node.id);
      for(let i=0;i<comp.length;i++)for(const n of nodes){
        if(!seen.has(n.id)&&Math.hypot(comp[i].x-n.x,comp[i].z-n.z)<=POWER_LINK_RANGE){seen.add(n.id);comp.push(n);this.powerEdges.push([comp[i],n]);}
      }
      components.push(comp);
    }
    this.supply=nodes.reduce((n,b)=>n+this.generation(b),0);this.demand=0;
    const loads=new Map<number,Building[]>();
    const connected=components.map((comp,i)=>({comp,i,live:comp.some(n=>this.generation(n)>0)}));
    for(const b of this.state.buildings){
      b.power=0;const demand=DEFS[b.kind].power;if(!demand)continue;this.demand+=demand;
      let nearest:Building|undefined;let distance=POWER_LOAD_RANGE;let ci=-1;
      // Prefer a live network, but retain physical connections when fuel runs out.
      for(const live of [true,false]){
        for(const {comp,i} of connected.filter(c=>c.live===live))for(const n of comp){const d=Math.hypot(n.x-b.x,n.z-b.z);if(d<=distance){nearest=n;distance=d;ci=i;}}
        if(nearest)break;
      }
      if(nearest){this.powerEdges.push([nearest,b]);loads.set(ci,[...(loads.get(ci)||[]),b]);}
    }
    for(const [ci,machines] of loads){const capacity=components[ci].reduce((n,b)=>n+this.generation(b),0);const usage=machines.reduce((s,b)=>s+DEFS[b.kind].power,0);for(const b of machines)b.power=Math.min(1,capacity/usage);}
  }
  placementError(kind:Kind,x:number,z:number,checkPlayer=true):string|null {
    if(!Object.hasOwn(DEFS,kind))return 'Choose a construction tool.';
    if(this.state.buildings.filter(b=>!this.state.owner||b.owner===this.state.owner).length>=(this.state.openWorld?300:500))return 'Your workshop has reached its building limit.';
    if(!Number.isInteger(x)||!Number.isInteger(z)||!(this.state.openWorld?traversable(x,z):onIsland(x,z)))return 'Build on solid ground.';
    if(this.at(x,z))return 'This space is already occupied.';
    if(DEFS[kind].unlock>this.state.unlock)return DEFS[kind].unlock===1?'Produce 10 iron ingots to unlock.':DEFS[kind].unlock===2?'Produce 8 gears to unlock.':`Complete chapter ${DEFS[kind].unlock} to unlock ${DEFS[kind].name.toLowerCase()}.`;
    if(checkPlayer&&Math.hypot(x*CELL-this.state.player.x,z*CELL-this.state.player.z)>CELL*8)return 'Walk a little closer to build here.';
    if(checkPlayer&&!isBelt(kind)&&Math.hypot(x*CELL-this.state.player.x,z*CELL-this.state.player.z)<1.2)return 'Leave a little room for yourself.';
    if(kind==='windmill'&&this.state.buildings.some(b=>b.kind==='windmill'&&Math.hypot(b.x-x,b.z-z)<WINDMILL_SPACING))return `Windmills need open air. Leave at least ${WINDMILL_SPACING} tiles between windmills.`;
    if(kind==='steam'){
      const site=this.siteAt(x,z);
      if(site?.item!=='coal')return 'Place a coal power plant directly on a coal deposit.';
      if(!this.remaining(site))return 'This coal deposit is exhausted. Find another seam.';
    }
    if(kind==='mine'||kind==='lumber'){
      const item=kind==='mine'?'ore':'log';if(this.siteAt(x,z)?.item!==item)return `Place on a ${item==='ore'?'marked iron deposit':'marked forest site'}.`;
      if(!this.remaining(this.siteAt(x,z)!))return 'This deposit is exhausted.';
    }
    if(kind==='quarry'){
      const site=this.siteAt(x,z);
      if(!site||!['coal','copper','crystal'].includes(site.item))return 'Place on a coal, copper, or crystal deposit.';
      if(site.tier&&!(this.state.inventory.pickaxe||0))return 'Craft a steel pickaxe before drilling crystals.';
      if(!this.remaining(site))return 'This deposit is exhausted.';
    }
    const extraction=['mine','lumber','quarry','steam'].includes(kind),site=this.siteAt(x,z);
    if(!(extraction&&site)&&this.scenery.some(n=>this.overlapsScenery(n,x,z)&&this.sceneryVisible(n)))return 'Chop or mine the material here before building.';
    if(!canAfford(this.state.inventory,DEFS[kind].cost))return 'Gather or collect more building materials.';
    return null;
  }
  place(kind:Kind,x:number,z:number,dir:number):Building|string {
    const err=this.placementError(kind,x,z);if(err)return err;
    addStock(this.state.inventory,DEFS[kind].cost,-1);
    const b=building(kind,x,z,((dir%4)+4)%4,this.state.nextId++);
    if(this.state.owner)b.owner=this.state.owner;
    this.state.buildings.push(b);this.state.built++;this.resetChallenge();this.reindex();return b;
  }
  dismantle(id:number):string|null {
    const b=this.state.buildings.find(b=>b.id===id);if(!b)return 'Building not found.';
    if(Math.hypot(b.x*CELL-this.state.player.x,b.z*CELL-this.state.player.z)>CELL*8)return 'Walk closer to dismantle this.';
    addStock(this.state.inventory,DEFS[b.kind].cost);addStock(this.state.inventory,upgradeRefund(b));addStock(this.state.inventory,b.input);addStock(this.state.inventory,b.output);
    if(b.item)addStock(this.state.inventory,{[b.item]:1});
    // Return an in-progress batch's reserved ingredients as well.
    if(b.active&&DEFS[b.kind].input)addStock(this.state.inventory,DEFS[b.kind].input!);
    if(b.active&&['lumber','mine','quarry'].includes(b.kind)){
      const site=this.siteAt(b.x,b.z);if(site)this.state.deposits[site.id]=Math.min(site.amount,this.remaining(site)+1);
    }
    this.state.buildings=this.state.buildings.filter(v=>v.id!==id);this.resetChallenge();this.reindex();return null;
  }
  resetChallenge(){this.state.challenge={start:this.state.time,windows:0,delivered:this.state.delivered,assembled:this.assembled()};}
  assembled(){return this.state.buildings.filter(b=>b.kind==='assembler'&&ownsBuilding(this.state,b)).reduce((n,b)=>n+b.produced,0);}
  collect(b:Building):string {
    if(Math.hypot(b.x*CELL-this.state.player.x,b.z*CELL-this.state.player.z)>CELL*8)return 'Walk closer to collect these goods.';
    let n=total(b.output);addStock(this.state.inventory,b.output);b.output={};
    if(b.kind==='storage'){n+=total(b.input);addStock(this.state.inventory,b.input);b.input={};}
    return n?`Collected ${n} items.`:'Nothing to collect yet.';
  }
  feed(b:Building):string {
    if(Math.hypot(b.x*CELL-this.state.player.x,b.z*CELL-this.state.player.z)>CELL*8)return 'Walk closer to load this machine.';
    const recipe=DEFS[b.kind].input;if(!recipe)return 'This building does not need ingredients.';
    let n=0;
    for(const [k,amount] of entries(recipe)){const take=Math.max(0,Math.min(this.state.inventory[k]||0,amount*3,amount*4-(b.input[k]||0)));b.input[k]=(b.input[k]||0)+take;this.state.inventory[k]=(this.state.inventory[k]||0)-take;n+=take;}
    return n?`Loaded ${n} ingredients.`:'Gather the required ingredients first.';
  }
  upgrade(b:Building):string {
    if(!ownsBuilding(this.state,b))return 'Only the owner and their clan can upgrade this building.';
    if(Math.hypot(b.x*CELL-this.state.player.x,b.z*CELL-this.state.player.z)>CELL*8)return 'Walk closer to upgrade this building.';
    const next=upgradeOptions(b)[tier(b)+1];
    if(!next)return 'This building has no further upgrades.';
    if(this.state.unlock<next.unlock)return `Complete chapter ${next.unlock} to unlock this upgrade.`;
    if(!canAfford(this.state.inventory,next.cost))return 'Not enough materials for this upgrade.';
    // Preserve the fraction of a batch already completed when its duration changes.
    const fraction=b.progress/(machineDuration(b)||1);
    addStock(this.state.inventory,next.cost,-1);b.level=tier(b)+1;
    b.progress=fraction*machineDuration(b);this.resetChallenge();this.reindex();
    return `Upgraded to ${next.name.toLowerCase()}.`;
  }
  completeCommission():string {
    if(this.state.won)return 'You have already earned Master of Ironwood. Keep building or revisit your badge in the journey book.';
    if(!canComplete(this.state))return 'Finish all eight chapters, dispatch 100 mechanisms, sustain the factory challenge, and collect the beacon materials.';
    addStock(this.state.inventory,BEACON_COST,-1);this.state.won=true;
    this.state.campaign.completedAt=this.state.time;
    this.state.campaign.badges.push(CHAPTERS[7].badge);this.revision++;
    return 'The beacon is lit. You are a Master of Ironwood.';
  }
  craft(kind:Craft):string {
    if(!Object.hasOwn(CRAFTS,kind))return 'Unknown recipe.';
    if(kind==='pickaxe'&&(this.state.inventory.pickaxe||0)>0)return 'Your crew already has the steel pickaxe upgrade.';
    const r=CRAFTS[kind];if(!canAfford(this.state.inventory,r.cost))return 'Not enough ingredients.';
    addStock(this.state.inventory,r.cost,-1);addStock(this.state.inventory,r.output);return `Crafted ${r.label.toLowerCase()}.`;
  }
  gatherTarget(target?:string){
    const p=this.state.player;
    const sites=this.sites.filter(n=>!this.at(n.x,n.z)).map(n=>({...n,d:Math.hypot(n.x*CELL-p.x,n.z*CELL-p.z),reach:5,node:undefined as Scenery|undefined,left:this.remaining(n)}));
    const nodes=this.scenery.filter(n=>this.sceneryVisible(n)).map(n=>({...n,d:Math.max(0,Math.hypot(n.x-p.x,n.z-p.z)-n.radius),reach:2.5,node:n,left:this.sceneryRemaining(n)}));
    const candidates=[...sites,...nodes];
    if(target)return candidates.find(n=>n.id===target);
    const near=candidates.filter(n=>n.d<=n.reach).sort((a,b)=>a.d-b.d);
    return near.find(n=>n.left>0)||near[0];
  }
  gather(target?:string):string {
    const near=this.gatherTarget(target);
    if(!near||near.d>near.reach)return 'Walk near a tree, rock, or deposit, then press E. Open M to explore the map.';
    if(near.tier&&!(this.state.inventory.pickaxe||0))return 'Aether crystals need a steel pickaxe. Craft one with C.';
    if(this.state.time<this.state.miningReady)return 'Mining… ready for another strike shortly.';
    const amount=Math.min(near.left,near.tier?2:5);
    if(!amount)return 'This deposit is exhausted. Search for another on the map.';
    if(near.node){
      this.state.harvested[near.id]=(this.state.harvested[near.id]??near.amount)-amount;
      if(near.node.siteId)this.state.deposits[near.node.siteId]=this.remaining(this.resourceSite(near.node.siteId)!)-amount;
    }else this.state.deposits[near.id]=near.left-amount;
    this.state.miningReady=this.state.time+1;this.revision++;
    addStock(this.state.inventory,{[near.item]:amount});this.state.gathered+=amount;this.discover();
    this.onGather?.({x:near.node?near.x:near.x*CELL,z:near.node?near.z:near.z*CELL,item:near.item,amount});
    return `${near.item==='log'?'Chopped':'Mined'} ${amount} ${ITEMS[near.item].name.toLowerCase()} · ${near.left-amount} remaining.`;
  }
  canReceive(b:Building,item:Item,source:Building){
    if(!this.sameFactory(b,source))return false;
    const d=DIRECTIONS[b.dir];const incoming=(source.x-b.x)*d.x+(source.z-b.z)*d.z;
    // Input is any side except the output side; belts also accept corners.
    if(incoming>0&&b.kind!=='depot')return false;
    if(isBelt(b.kind))return !b.item;
    if(b.kind==='depot')return item==='mechanism';
    if(b.kind==='storage')return total(b.input)<chestCapacity(b);
    const required=DEFS[b.kind].input?.[item]||0;
    return required>0&&(b.input[item]||0)<required*4;
  }
  receive(b:Building,item:Item,source:Building){
    if(isBelt(b.kind)){b.item=item;b.travel=0;b.from=source.x<b.x?0:source.z<b.z?1:source.x>b.x?2:3;b.cooldown=2;}
    else if(b.kind==='depot'){this.state.delivered++;this.state.deliveryEvents.push(this.state.time);this.onDelivery?.(b);}
    else b.input[item]=(b.input[item]||0)+1;
  }
  tick(dt:number){
    if(!(dt>0)||dt>1)throw new Error('Simulation ticks must be between 0 and 1 second.');
    const s=this.state;s.time+=dt;
    this.discover();
    let powerChanged=false;
    for(const b of s.buildings){
      const def=DEFS[b.kind];if(!def.fuel)continue;
      const was=this.generation(b);b.fuelRemaining=Math.max(0,b.fuelRemaining-dt);
      if(b.fuelRemaining<=1e-8){
        b.fuelRemaining=0;
        const site=b.kind==='steam'?this.siteAt(b.x,b.z):undefined;
        if(site?.item==='coal'&&this.remaining(site)>0){
          s.deposits[site.id]=this.remaining(site)-1;b.fuelRemaining=def.burnTime!;
        }else if((b.input[def.fuel]||0)>0){b.input[def.fuel]!--;b.fuelRemaining=def.burnTime!;}
      }
      if(was!==this.generation(b))powerChanged=true;
    }
    if(powerChanged){this.computePower();this.revision++;}
    for(const b of s.buildings){
      b.cooldown=Math.max(0,b.cooldown-dt);b.events=b.events.filter(t=>s.time-t<60);
      if(isBelt(b.kind)) {b.travel=Math.min(1,b.travel+dt/2);b.status=b.item?'Transporting':'Ready';continue;}
      const def=DEFS[b.kind];if(!def.duration){b.status=def.generation?(this.generation(b)?`Generating ${def.generation} power`:b.kind==='steam'&&this.siteAt(b.x,b.z)?.item==='coal'?'Deposit exhausted':'Needs fuel'):b.kind==='storage'?`${total(b.input)} / ${chestCapacity(b)} stored`:'Ready';continue;}
      if(!b.power){b.status='Insufficient power';continue;}
      const result=this.output(b);
      const site=['lumber','mine','quarry'].includes(b.kind)?this.siteAt(b.x,b.z):undefined;
      if(!b.active){
        if(total(b.output)+total(result)>BUFFER){b.status='Output blocked';continue;}
        if(def.input&&!canAfford(b.input,def.input)){b.status='Needs input';continue;}
        if(site&&!this.remaining(site)){b.status='Deposit exhausted';continue;}
        if(site)s.deposits[site.id]=this.remaining(site)-1;
        if(def.input)addStock(b.input,def.input,-1);
        b.active=true;
      }
      b.progress+=dt*b.power;b.status=b.power<1?'Insufficient power':'Working';
      if(b.progress+1e-8>=machineDuration(b)){
        addStock(b.output,result);addStock(s.produced,result);b.produced+=total(result);b.events.push(s.time);
        this.onProduction?.(b,result);
        b.progress=0;b.active=false;
      }
    }
    // Snapshot eligible senders so an item cannot move multiple tiles in one tick.
    const eligible=s.buildings.filter(b=>b.cooldown<=0&&(b.item||total(b.kind==='storage'?b.input:b.output)>0));
    // Destination cursors arbitrate competing inputs fairly, independent of array order.
    const offers=new Map<number,{source:Building;item:Item}[]>();
    for(const b of eligible){
      const stock=b.kind==='storage'?b.input:b.output;
      const item=b.item||(entries(stock).find(([,n])=>n>0)?.[0]);if(!item)continue;
      const dirs=b.kind==='splitter'?[b.dir,(b.dir+1)%4,(b.dir+3)%4]:[b.dir];
      for(let i=0;i<dirs.length;i++){
        const d=DIRECTIONS[dirs[(b.route+i)%dirs.length]];const target=this.at(b.x+d.x,b.z+d.z);
        if(target&&this.canReceive(target,item,b)){offers.set(target.id,[...(offers.get(target.id)||[]),{source:b,item}]);break;}
      }
      if(b.item)b.status='Output blocked';
    }
    for(const [id,list] of offers){
      const dest=this.byId.get(id)!;list.sort((a,b)=>a.source.id-b.source.id);
      const winner=list.find(v=>v.source.id>dest.cursor)||list[0];
      if(!this.canReceive(dest,winner.item,winner.source))continue;
      this.receive(dest,winner.item,winner.source);dest.cursor=winner.source.id;
      const src=winner.source;
      if(src.item){src.item=undefined;src.travel=0;src.status='Transporting';}
      else {const stock=src.kind==='storage'?src.input:src.output;stock[winner.item]=Math.max(0,(stock[winner.item]||0)-1);}
      if(src.kind==='splitter')src.route=(src.route+1)%3;src.cooldown=2;
    }
    s.deliveryEvents=s.deliveryEvents.filter(t=>s.time-t<60);
    // Shared-world progress is evaluated per engineer by SharedWorld.tick.
    if(!s.openWorld){advanceChapters(s);updateMastery(s);}
  }
  serialize(){return JSON.stringify(this.state);}
  static restore(json:string):Simulation {
    const s=JSON.parse(json) as State;
    const nonnegative=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12;
    const count=(n:unknown):n is number=>nonnegative(n)&&Number.isInteger(n);
    const validStock=(stock:unknown)=>stock&&typeof stock==='object'&&!Array.isArray(stock)&&Object.entries(stock).every(([key,v])=>Object.hasOwn(ITEMS,key)&&count(v));
    const times=(values:unknown)=>Array.isArray(values)&&values.every(nonnegative);
    if(!s||s.version!==1||!Array.isArray(s.buildings)||s.buildings.length>10000||!validStock(s.inventory)||!s.player||!nonnegative(s.time)||!validStock(s.produced)||!s.challenge||!times(s.deliveryEvents))throw new Error('This save is not compatible.');
    // Existing v1 workshops expand into the frontier without losing their factories.
    s.deposits??=Object.fromEntries(SITES.map(p=>[p.id,p.amount]));s.discovered??=SITES.slice(0,6).map(p=>p.id);s.miningReady??=0;
    const legacyScenery=s.harvested===undefined;
    s.harvested??={};s.explored??=[];
    if(typeof s.harvested!=='object'||Array.isArray(s.harvested)||Object.entries(s.harvested).some(([id,n])=>!sceneryById(id)||!count(n)||n>sceneryById(id)!.amount))throw new Error('Invalid harvested scenery.');
    if(!Array.isArray(s.explored)||s.explored.length>1000000||s.explored.some(key=>{
      if(typeof key!=='string'||!/^(-?\d+),(-?\d+)$/.test(key))return true;
      const [x,z]=key.split(',').map(Number);return key!==explorationKey(x,z)||!(s.openWorld?traversable(x,z):onIsland(x,z));
    }))throw new Error('Invalid explored terrain.');
    s.explored=[...new Set(s.explored)];
    if(!nonnegative(s.miningReady)||!Array.isArray(s.discovered)||!s.deposits)throw new Error('Invalid exploration data.');
    const findSite=(id:string)=>s.openWorld?proceduralSite(id):SITES.find(p=>p.id===id);
    if(s.discovered.some(id=>typeof id!=='string'||!findSite(id))||Object.entries(s.deposits).some(([id,n])=>!count(n)||!findSite(id)||n>findSite(id)!.amount))throw new Error('Invalid exploration data.');
    if(!count(s.nextId)||!count(s.built)||!count(s.gathered)||!count(s.delivered)||!Number.isInteger(s.unlock)||s.unlock<0||s.unlock>=CHAPTERS.length||typeof s.won!=='boolean'||!nonnegative(s.challenge.start)||!count(s.challenge.windows)||!count(s.challenge.delivered)||!count(s.challenge.assembled))throw new Error('Invalid progression in save.');
    migrateCampaign(s);
    const campaign=s.campaign;
    if(!Array.isArray(campaign.badges)||campaign.badges.some(badge=>!CHAPTERS.some(ch=>ch.badge===badge))||new Set(campaign.badges).size!==campaign.badges.length||typeof campaign.mastery!=='boolean'||typeof campaign.completionSeen!=='boolean'||!(campaign.completedAt===null||nonnegative(campaign.completedAt))||(s.won&&(s.unlock!==7||campaign.completedAt===null||!campaign.badges.includes(CHAPTERS[7].badge))))throw new Error('Invalid campaign in save.');
    const ids=new Set<number>(),positions=new Set<string>();
    for(const b of s.buildings){
      if(b.fuelRemaining===undefined)b.fuelRemaining=0;if(!nonnegative(b.fuelRemaining)||b.fuelRemaining>(DEFS[b.kind]?.burnTime||0))throw new Error('Invalid fuel state.');
      const pos=`${b.x},${b.z}`;
      if(!b||!Object.hasOwn(DEFS,b.kind)||!Number.isInteger(b.x)||!Number.isInteger(b.z)||!Number.isInteger(b.dir)||b.dir<0||b.dir>3||!count(b.id)||b.id>=s.nextId||ids.has(b.id)||positions.has(pos)||!validStock(b.input)||!validStock(b.output)||!times(b.events))throw new Error('This save contains an invalid building.');
      if(b.level!==undefined&&(!count(b.level)||b.level>Math.max(0,upgradeOptions(b).length-1)))throw new Error('Invalid building upgrade.');
      if(b.kind==='storage'&&total(b.input)>chestCapacity(b))throw new Error('Chest exceeds its capacity.');
      if(!nonnegative(b.progress)||!nonnegative(b.cooldown)||!nonnegative(b.travel)||b.travel>1||!count(b.produced)||!count(b.route)||!count(b.cursor)||typeof b.active!=='boolean'||!nonnegative(b.power)||b.power>1||(b.item!==undefined&&!Object.hasOwn(ITEMS,b.item))||(b.from!==undefined&&![0,1,2,3].includes(b.from)))throw new Error('Invalid machine state in save.');
      if(typeof b.status!=='string'||!(/^(Ready|Working|Needs input|Needs fuel|Deposit exhausted|Output blocked|Insufficient power|Generating (12|24|48|72|96) power|Transporting|\d+ \/ (100|400|1200|4000) stored)$/.test(b.status)))throw new Error('Invalid machine status in save.');
      ids.add(b.id);positions.add(pos);
      for(const stock of [b.input,b.output])for(const [key,v] of Object.entries(stock))if(!Object.hasOwn(ITEMS,key)||!Number.isFinite(v)||v<0)throw new Error('Invalid inventory in save.');
    }
    for(const stock of [s.inventory,s.produced])for(const [key,v] of Object.entries(stock))if(!Object.hasOwn(ITEMS,key)||!Number.isFinite(v)||v<0)throw new Error('Invalid inventory in save.');
    if(!Number.isFinite(s.player.x)||!Number.isFinite(s.player.z)||!(s.openWorld?traversable(s.player.x/CELL,s.player.z/CELL):onIsland(s.player.x/CELL,s.player.z/CELL)))throw new Error('Invalid player position.');
    const sim=new Simulation(s);if(legacyScenery){sim.resolveSpawn(s.player);sim.discover();}return sim;
  }
}
