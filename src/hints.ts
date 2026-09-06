export interface HintContext {
  age:number;nearResource:boolean;hasMachines:boolean;needsPower:boolean;inspecting:boolean;
  building:boolean;conveyor:boolean;dismantling:boolean;nearPlayer:boolean;hasClan:boolean;advanced:boolean;
  hasCombat?:boolean;canCustomize?:boolean;
}
export const PLAYER_HINTS=[
  {id:'move',title:'Find your footing',keys:'W A S D · Shift',copy:'Walk with WASD or the arrow keys. Hold Shift to run.',when:(c:HintContext)=>c.age>=2},
  {id:'chat',title:'Talk as you type',keys:'/',copy:'Press / to speak above your engineer. Players who can see you see each letter live. Esc or clicking away finishes.',when:(c:HintContext)=>c.age>=10},
  {id:'gather',title:'Gather nearby supplies',keys:'E',copy:'Stand near a tree or rock and press E. Click a resource to gather that specific one.',when:(c:HintContext)=>c.nearResource},
  {id:'conveyors',title:'Draw a supply line',keys:'Drag · R',copy:'Drag from a machine’s output toward the next input. Retrace to shorten; release to build.',when:(c:HintContext)=>c.conveyor},
  {id:'rotate',title:'Point the output',keys:'R · Esc',copy:'R turns the output arrow. Click to place. Esc or right-click cancels the preview.',when:(c:HintContext)=>c.building&&!c.conveyor},
  {id:'dismantle',title:'Recover your materials',keys:'X · Esc',copy:'Click a building to recover its supplies, contents, and upgrades. Esc returns to inspect mode.',when:(c:HintContext)=>c.dismantling},
  {id:'inspect',title:'Put your machines to work',keys:'Click',copy:'Collect moves output into your pack. Load inputs feeds a machine from your supplies.',when:(c:HintContext)=>c.inspecting},
  {id:'power',title:'Keep the workshop powered',keys:'Power',copy:'Windmills supply 12 power and need 4 tiles between them. Build a coal power plant on a coal deposit for 72 power. Posts wire the network together.',when:(c:HintContext)=>c.needsPower},
  {id:'team',title:'Build with another engineer',keys:'Team up',copy:'Meet within 3 tiles and choose Team up. Accepting shares supplies, progress, and workshop access.',when:(c:HintContext)=>c.nearPlayer&&!c.hasClan},
  {id:'clan',title:'One shared workshop',keys:'Clan',copy:'Your clan shares supplies and tools. Use a member’s waypoint to find their base.',when:(c:HintContext)=>c.hasClan},
  {id:'build',title:'Open your recipe book',keys:'B · 1–9',copy:'Hover or focus the green book below to choose a building. Follow the tutorial for your first production line.',when:(c:HintContext)=>c.age>=20},
  {id:'camera',title:'Get a better view',keys:'Scroll · Q · F',copy:'Scroll to zoom. Q rotates the camera. F returns the view to your engineer.',when:(c:HintContext)=>c.age>=35},
  {id:'map',title:'Explore beyond your base',keys:'M',copy:'Walking reveals the map. Open it with M, filter deposits, and choose a waypoint to follow.',when:(c:HintContext)=>c.age>=45},
  {id:'craft',title:'Make what you need',keys:'C',copy:'Open handcrafting with C. Discovering materials reveals recipes. A steel pickaxe lets you mine crystals.',when:(c:HintContext)=>c.age>=60},
  {id:'combat',title:'Prepare for the frontier',keys:'K · Attack',copy:'C opens weapon crafting. Your best weapon equips automatically. Press K to swing, or click an enemy to attack.',when:(c:HintContext)=>!!c.hasCombat&&c.age>=70},
  {id:'storage',title:'Keep goods flowing',keys:'Logistics',copy:'Connect outputs to storage chests with conveyors. Full buffers stop a line; collect goods to make room.',when:(c:HintContext)=>c.hasMachines&&c.age>=75},
  {id:'journey',title:'Follow your next chapter',keys:'J',copy:'Journey shows objectives, rewards, and badges. Factory-made goods count toward production goals.',when:(c:HintContext)=>c.age>=90},
  {id:'upgrades',title:'Grow your workshop',keys:'Inspect',copy:'Inspect storage or a production machine to see upgrades. New chapters unlock more capacity and faster drives.',when:(c:HintContext)=>c.advanced},
  {id:'world',title:'Find your way home',keys:'World',copy:'Open World to find your base, name your guest engineer, or visit someone else’s workshop.',when:(c:HintContext)=>c.age>=110},
  {id:'appearance',title:'Make your engineer yours',keys:'Customize character',copy:'Choose the shirt button to change your outfit and colors. See your choices in the character preview.',when:(c:HintContext)=>!!c.canCustomize&&c.age>=120},
  {id:'save',title:'Keep your progress',keys:'Account',copy:'The world saves automatically. Log in above your engineer to keep your workshop across devices.',when:(c:HintContext)=>c.age>=135},
  {id:'settings',title:'Make yourself comfortable',keys:'Settings · H',copy:'Settings controls graphics, FPS, and these hints. Press H to revisit the field guide any time.',when:(c:HintContext)=>c.age>=160},
] as const;
export type HintId=typeof PLAYER_HINTS[number]['id'];
const MOBILE_HINTS:Partial<Record<HintId,{keys:string;copy:string}>>={
  move:{keys:'Thumb stick',copy:'Drag the thumb stick to walk. Drag to its outer edge to run.'},
  chat:{keys:'Chat',copy:'Tap Chat below, write your message, then tap Send to share it with the world.'},
  gather:{keys:'Gather',copy:'Walk near a tree or rock and tap Gather. Tap a resource to gather that specific one.'},
  rotate:{keys:'Rotate · Done',copy:'Tap Rotate to turn the output arrow, then tap a tile to place. Tap Done to return to exploring.'},
  conveyors:{keys:'Drag',copy:'Choose Conveyor in Build → Logistics. Drag from a machine’s output toward the next input, then release to build.'},
  dismantle:{keys:'Tap · Done',copy:'Tap a building to recover its supplies, contents, and upgrades. Tap Done to return to inspect mode.'},
  build:{keys:'Build',copy:'Tap Build below to open your recipe book. Choose a building, then tap a tile to place it.'},
  camera:{keys:'Menu',copy:'Open Menu to zoom, rotate the view, or recenter on your engineer.'},
  map:{keys:'Map',copy:'Walking reveals the map. Tap Map below, filter deposits, and choose a waypoint to follow.'},
  craft:{keys:'Craft',copy:'Tap Craft below to make supplies and weapons. Discovering materials reveals recipes.'},
  combat:{keys:'Attack',copy:'Tap Attack to swing at the nearest enemy, or tap an enemy to target it. Craft weapons to grow stronger.'},
  journey:{keys:'Menu → Journey',copy:'Journey shows objectives, rewards, and badges. Factory-made goods count toward production goals.'},
  world:{keys:'Menu → World',copy:'Open World from Menu to find your base, name your engineer, or visit another workshop.'},
  appearance:{keys:'Menu → Character',copy:'Open Character from Menu to change your outfit and colors.'},
  settings:{keys:'Menu → Settings',copy:'Open Settings from Menu to adjust graphics, sound, and hints. The field guide is in Menu too.'},
};
const STORAGE_KEY='ironwood-player-hints-v1';

/** One hint at a time, once per browser, with breathing room between hints. */
export class HintSchedule {
  seen=new Set<string>();enabled=true;active?:typeof PLAYER_HINTS[number];
  private elapsed=0;private cooldown=0;
  constructor(private save:()=>void=()=>{}){}
  tick(dt:number,context:HintContext,blocked:boolean,reading=false){
    if(blocked||!this.enabled)return undefined;
    if(this.active&&!this.active.when(context)){this.active=undefined;this.elapsed=0;}
    if(this.active){
      if(!reading)this.elapsed+=dt;
      if(this.elapsed>=10){this.dismiss();return undefined;}
      return this.active;
    }
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.cooldown>0)return undefined;
    this.active=PLAYER_HINTS.find(hint=>!this.seen.has(hint.id)&&hint.when(context));this.elapsed=0;
    return this.active;
  }
  dismiss(){if(this.active){this.seen.add(this.active.id);this.active=undefined;this.cooldown=22;this.save();}}
  complete(id:HintId){if(this.active?.id===id)this.dismiss();else if(!this.seen.has(id)){this.seen.add(id);this.save();}}
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.active=undefined;this.save();}
  reset(){this.seen.clear();this.active=undefined;this.enabled=true;this.cooldown=0;this.save();}
}

export class PlayerHints {
  readonly schedule:HintSchedule;
  private card=document.createElement('aside');
  private announcement=document.createElement('div');
  private title=document.createElement('strong');
  private keys=document.createElement('span');
  private copy=document.createElement('p');
  private rendered='';private age=0;
  constructor(parent:HTMLElement){
    this.schedule=new HintSchedule(()=>this.persist());
    try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&typeof saved==='object'){this.schedule.enabled=saved.enabled!==false;if(Array.isArray(saved.seen))this.schedule.seen=new Set(saved.seen.filter((id:unknown)=>typeof id==='string'));}}catch{/* Hints still work without browser storage. */}
    this.card.id='player-hint';this.card.className='player-hint';this.card.hidden=true;this.card.setAttribute('aria-label','Player hint');
    const heading=document.createElement('div');heading.className='player-hint-heading';heading.append(this.title,this.keys);
    const footer=document.createElement('div');footer.className='player-hint-footer';
    const guide=document.createElement('span');guide.textContent='H · Field guide';
    const mute=document.createElement('button');mute.type='button';mute.textContent='Hide hints';mute.onclick=()=>{this.schedule.setEnabled(false);this.card.hidden=true;};
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='player-hint-dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','Dismiss hint');dismiss.onclick=()=>{this.schedule.dismiss();this.card.hidden=true;};
    footer.append(guide,mute);this.card.append(heading,this.copy,footer,dismiss);
    this.announcement.className='sr-only';this.announcement.setAttribute('role','status');
    parent.append(this.card,this.announcement);
  }
  update(dt:number,context:Omit<HintContext,'age'>,blocked:boolean){
    const parent=this.card.parentElement!;
    blocked ||= getComputedStyle(parent).display==='none'||!!parent.querySelector('.world-label:not([hidden]),.build-hint:not([hidden])');
    if(!blocked)this.age+=dt;
    const reading=this.card.matches(':hover,:focus-within');
    const hint=this.schedule.tick(dt,{...context,age:this.age},blocked,reading);
    this.card.hidden=!hint;
    if(!hint){this.rendered='';return;}
    const touch=matchMedia('(max-width: 800px), (pointer: coarse)').matches,key=`${hint.id}:${touch}`;
    if(this.rendered===key)return;this.rendered=key;
    const content=touch?MOBILE_HINTS[hint.id]??hint:hint;
    this.title.textContent=hint.title;this.keys.textContent=content.keys;this.copy.textContent=content.copy;
    this.card.querySelector('.player-hint-footer > span')!.textContent=touch?'Menu · Field guide':'H · Field guide';
    this.announcement.textContent=`${hint.title}. ${content.copy}`;
  }
  private persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({enabled:this.schedule.enabled,seen:[...this.schedule.seen]}));}catch{/* Keep preferences for this session. */}}
}
