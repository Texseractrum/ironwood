import { DEFS, addStock, canAfford, type Stock } from './data';
import type { Building, State } from './simulation';

export const CHESTS = [
  {name:'Timber chest',capacity:100,unlock:0,cost:{}},
  {name:'Ironbound chest',capacity:400,unlock:2,cost:{plank:16,ingot:12,gear:4}},
  {name:'Steel vault',capacity:1200,unlock:4,cost:{steel:20,glass:12,gear:8}},
  {name:'Aether vault',capacity:4000,unlock:6,cost:{alloy:24,circuit:12,core:2}},
] satisfies {name:string;capacity:number;unlock:number;cost:Stock}[];
export const MACHINE_UPGRADES = [
  {name:'Standard',speed:1,unlock:0,cost:{}},
  {name:'Precision drive',speed:1.5,unlock:3,cost:{steel:8,gear:6,copper:4}},
  {name:'Aether drive',speed:2,unlock:6,cost:{alloy:10,circuit:6,core:1}},
] satisfies {name:string;speed:number;unlock:number;cost:Stock}[];
export const CHAPTERS = [
  {title:'A spark of possibility',copy:'Build your first production lines. Factory-made iron opens the door to machinery.',reward:'Gear press · Apprentice badge',badge:'Apprentice',supplies:{plank:12}},
  {title:'The wheels of progress',copy:'Power a gear press and connect the furnace’s output to its input. Collect supplies from your chests as you grow.',reward:'Assembly bench · Dispatch depot',badge:'Machinist',supplies:{ingot:8}},
  {title:'Your first commission',copy:'Feed an assembly bench with planks and gears, then connect its output to a dispatch depot. Your first shipment is only the beginning.',reward:'Steel foundry · Machine upgrades',badge:'Guild supplier',supplies:{coal:12,copper:8}},
  {title:'Built to last',copy:'Explore for coal and copper. Feed iron and coal into a steel foundry, then inspect a chest to upgrade it to 400 items.',reward:'Crystal kiln · Circuit etcher · Steel vault',badge:'Ironwright',supplies:{coal:16}},
  {title:'Light in the mountains',copy:'Craft a steel pickaxe and seek aether crystals on the map. Automate glass in a crystal kiln and circuits in an etcher.',reward:'Alloy forge · Auric alloy',badge:'Crystal pioneer',supplies:{crystal:8}},
  {title:'An age of alloys',copy:'Combine steel, copper, and coal in an alloy forge. Upgrade a chest to a 1,200-item steel vault to hold your growing industry.',reward:'Core assembler · Aether drives · Aether vault',badge:'Metallurgist',supplies:{copper:20}},
  {title:'The heart of Ironwood',copy:'Build a core assembler and supply alloy, circuits, glass, and crystals. Upgrade two production machines and create your 4,000-item aether vault.',reward:'The final beacon commission',badge:'Artificer',supplies:{}},
  {title:'A light for everyone',copy:'The guild’s final commission: a beacon for every engineer on the frontier. Prove your factory can sustain its rhythm, then contribute the beacon materials.',reward:'Master of Ironwood · Permanent completion badge',badge:'Master of Ironwood',supplies:{}},
] satisfies {title:string;copy:string;reward:string;badge:string;supplies:Stock}[];
export const BEACON_COST:Stock = {core:12,alloy:30,glass:30};
export interface Campaign {badges:string[];mastery:boolean;completedAt:number|null;completionSeen:boolean}
export const freshCampaign = ():Campaign => ({badges:[],mastery:false,completedAt:null,completionSeen:false});
export const tier = (b:Building) => b.level ?? 0;
export const chestCapacity = (b:Building) => CHESTS[tier(b)].capacity;
export const machineSpeed = (b:Building) => DEFS[b.kind].duration ? MACHINE_UPGRADES[tier(b)].speed : 1;
export const machineDuration = (b:Building) => (DEFS[b.kind].duration || 0) / machineSpeed(b);
export const ownedBuildings = (s:State) => s.buildings.filter(b=>!s.owner||b.owner===s.owner||!!(b.owner&&s.clanMembers?.includes(b.owner)));
export function upgradeOptions(b:Building) {return b.kind==='storage'?CHESTS:DEFS[b.kind].duration?MACHINE_UPGRADES:[];}
export function upgradeRefund(b:Building):Stock {
  const stock:Stock={};for(const upgrade of upgradeOptions(b).slice(1,tier(b)+1))addStock(stock,upgrade.cost);return stock;
}
export interface Objective {text:string;n:number;max:number}
export function chapterObjectives(s:State,chapter=s.unlock):Objective[] {
  const own=ownedBuildings(s),made=(item:keyof Stock,max:number):Objective=>({text:`Produce ${item==='core'?'aether cores':item==='alloy'?'auric alloy':item==='glass'?'crystal glass':item==='circuit'?'aether circuits':item==='ingot'?'iron ingots':item==='gear'?'gears':item}`,n:s.produced[item]||0,max});
  const vault=(level:number):Objective=>({text:`Own a ${CHESTS[level].capacity.toLocaleString('en-US')}-item ${level===1?'chest':'vault'}`,n:own.some(b=>b.kind==='storage'&&tier(b)>=level)?1:0,max:1});
  switch(chapter){
    case 0:return [made('ingot',10)];
    case 1:return [made('gear',8)];
    case 2:return [{text:'Dispatch mechanisms',n:s.delivered,max:20}];
    case 3:return [made('steel',20),vault(1)];
    case 4:return [{text:'Craft a steel pickaxe',n:s.inventory.pickaxe||0,max:1},made('glass',20),made('circuit',12)];
    case 5:return [made('alloy',24),vault(2)];
    case 6:return [made('core',6),{text:'Upgrade production machines',n:own.filter(b=>!!DEFS[b.kind].duration&&tier(b)>0).length,max:2},vault(3)];
    default:return [{text:'Dispatch mechanisms',n:s.delivered,max:100},{text:'Sustain 8/min at 80% utilization',n:s.campaign.mastery?3:s.challenge.windows,max:3},...Object.entries(BEACON_COST).map(([item,max])=>({text:`Contribute ${item==='core'?'aether cores':item==='alloy'?'auric alloy':'crystal glass'}`,n:s.won?max:s.inventory[item as keyof Stock]||0,max}))];
  }
}
export function advanceChapters(s:State) {
  while(s.unlock<CHAPTERS.length-1&&chapterObjectives(s).every(goal=>goal.n>=goal.max)){
    const chapter=CHAPTERS[s.unlock];
    if(!s.campaign.badges.includes(chapter.badge)){s.campaign.badges.push(chapter.badge);addStock(s.inventory,chapter.supplies);}
    s.unlock++;
  }
}
export function updateMastery(s:State) {
  const benches=ownedBuildings(s).filter(b=>b.kind==='assembler'),assembled=benches.reduce((n,b)=>n+b.produced,0);
  if(s.delivered<20){s.challenge={start:s.time,windows:0,delivered:s.delivered,assembled};return;}
  if(s.time-s.challenge.start+1e-6<60)return;
  const potential=benches.reduce((n,b)=>n+60/machineDuration(b),0);
  const success=s.delivered-s.challenge.delivered>=8&&potential>0&&(assembled-s.challenge.assembled)/potential>=.8;
  s.challenge={start:s.time,windows:success?Math.min(3,s.challenge.windows+1):0,delivered:s.delivered,assembled};
  if(s.challenge.windows>=3)s.campaign.mastery=true;
}
export function canComplete(s:State) {return !s.won&&s.unlock===CHAPTERS.length-1&&s.delivered>=100&&s.campaign.mastery&&canAfford(s.inventory,BEACON_COST);}
/** Old three-chapter victories remain earned honours; the expanded journey resumes. */
export function migrateCampaign(s:Pick<State,'campaign'|'won'|'unlock'>) {
  if(s.campaign)return;
  s.campaign=freshCampaign();
  for(let i=0;i<s.unlock;i++)s.campaign.badges.push(CHAPTERS[i].badge);
  if(s.won){s.campaign.mastery=true;s.campaign.badges.push('Guild supplier');s.unlock=Math.max(3,s.unlock);s.won=false;}
}
