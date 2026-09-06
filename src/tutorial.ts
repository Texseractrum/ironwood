import { CELL, DEFS, DIRECTIONS, isBelt, type Kind, type Site } from './data';
import {ownsBuilding,type Building,type Simulation} from './simulation';

export interface TutorialStep {
  id:string; title:string; copy:string; objective:string; n:number; max:number;
  action?:Kind; site?:Site;
}

// Follow the actual output ports. Full buffers do not invalidate a finished route.
export function hasRoute(sim:Simulation,source:Building,target:Building):boolean {
  const queue=[source],seen=new Set<number>();
  for(let i=0;i<queue.length;i++){
    const current=queue[i];if(seen.has(current.id))continue;seen.add(current.id);
    const dirs=current.kind==='splitter'?[current.dir,(current.dir+1)%4,(current.dir+3)%4]:[current.dir];
    for(const dir of dirs){
      const d=DIRECTIONS[dir],next=sim.at(current.x+d.x,current.z+d.z);if(!next)continue;
      const out=DIRECTIONS[next.dir];
      if(next.kind!=='depot'&&(current.x-next.x)*out.x+(current.z-next.z)*out.z>0)continue;
      if(next.id===target.id)return true;
      if(isBelt(next.kind)||next.kind==='storage')queue.push(next);
    }
  }
  return false;
}

export function tutorialStep(sim:Simulation):TutorialStep|null {
  const s=sim.state;if(s.unlock>0)return null;
  const all=(kind:Kind)=>s.buildings.filter(b=>b.kind===kind&&ownsBuilding(s,b));
  const anchor=s.base||(s.openWorld?{x:s.player.x/CELL,z:s.player.z/CELL}:{x:-6,z:0});
  const site=(item:'log'|'ore')=>sim.sites.filter(p=>p.item===item&&sim.remaining(p)>0)
    .sort((a,b)=>Math.hypot(a.x-anchor.x,a.z-anchor.z)-Math.hypot(b.x-anchor.x,b.z-anchor.z))[0];
  const timber=site('log'),iron=site('ore');
  const location=(p:Site|undefined,fallback:string)=>p?`${p.name} at ${p.x} : ${p.z}`:fallback;
  const step=(id:string,title:string,copy:string,objective:string,action?:Kind,n=0,max=1):TutorialStep=>({id,title,copy,objective,action,n,max});
  const power=(machines:Building[],name:string):TutorialStep|null=>{
    if(machines.some(b=>b.power>0))return null;
    const generator=s.buildings.some(b=>DEFS[b.kind].generation);
    return step(`power-${name}`,`Power your ${name}`,generator
      ?'Open Power and place transmission posts between your windmill and the machine. Wires connect automatically within 5 tiles; machines must be within 4.6 tiles of a connected post or generator.'
      :'Choose Windmill in Power. Place it within 4 tiles of your lumber camp. Your starting supplies cover the cost; the camp starts cutting timber when powered.',
    `Supply power to the ${name}`,generator?'post':'windmill');
  };
  const lumber=all('lumber'),sawmills=all('sawmill'),mines=all('mine'),furnaces=all('furnace');
  {
    if(!lumber.length)return {...step('lumber','Start with timber',`Hover over the dark-green recipe book at the bottom to open it. Choose Lumber camp, then click the highlighted ${location(timber,'forest site')}. Use WASD to walk closer if needed. R turns the output arrow.`,'Place a lumber camp','lumber'),site:timber};
    const campPower=power(lumber,'lumber camp');if(campPower)return campPower;
    if(!sawmills.length)return step('sawmill','Turn timber into planks','Choose Sawmill in Production. Leave a few tiles in front of your lumber camp’s output for conveyors. Point the sawmill’s output away from the camp with R.','Place a sawmill','sawmill');
    const sawPower=power(sawmills,'sawmill');if(sawPower)return sawPower;
    if(!lumber.some(a=>sawmills.some(b=>hasRoute(sim,a,b))))return step('timber-route','Give timber a path','Choose Conveyor in Logistics. Drag from the camp’s output to a sawmill input; corners form automatically. Release to build, or retrace to shorten the preview. Clear trees or rocks with E first.','Connect camp to sawmill','conveyor');
    const chests=all('storage');
    if(!chests.length)return step('storage','Make room for planks','Choose Storage chest in Logistics. Place it beyond the sawmill’s output, with its arrow pointing away from the sawmill.','Place a storage chest','storage');
    if(!sawmills.some(a=>chests.some(b=>hasRoute(sim,a,b))))return step('plank-route','Store your first planks','Draw conveyors from the sawmill’s output to a storage chest. Follow the arrows all the way to the chest.','Connect sawmill to storage','conveyor');
    if((s.produced.plank||0)<6)return step('planks','Your first wood production','Let the line produce 6 planks. Press Escape, click the chest, then Collect to use its planks for building. If a machine stops, inspect its power and inputs.','Produce planks',undefined,s.produced.plank||0,6);
  }
  if(!mines.length)return {...step('mine','Next, unearth iron',`Your wood line is running. Collect planks from its chest when needed. Walk toward the highlighted ${location(iron,'iron deposit')}, then choose Iron mine and place it there.`,'Place an iron mine','mine'),site:iron};
  const minePower=power(mines,'iron mine');if(minePower)return minePower;
  if(!furnaces.length)return step('furnace','Build a stone furnace','Choose Stone furnace in Production. Place it near the mine, leaving room for conveyors. Point its output away from the incoming ore.','Place a stone furnace','furnace');
  const furnacePower=power(furnaces,'stone furnace');if(furnacePower)return furnacePower;
  if(!mines.some(a=>furnaces.some(b=>hasRoute(sim,a,b))))return step('ore-route','Bring ore to the furnace','Draw conveyors from the mine’s output to an input side of the furnace. Keep every arrow pointing along the route.','Connect mine to furnace','conveyor');
  return step('ingots','From ore to opportunity','Produce 10 iron ingots to unlock the gear press. Click the furnace and Collect its output, or route it to another chest. E gathers more timber and ore near deposits; C crafts supplies.','Produce iron ingots',undefined,s.produced.ingot||0,10);
}
