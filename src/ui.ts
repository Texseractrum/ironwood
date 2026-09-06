import { createIcons, Wind, Logs, Mountain, PanelsTopLeft, BrickWall, Cog, Component, Pause, Play, VolumeX, Volume2, Settings2, Flag, ArrowUpRight, Factory, Waypoints, MousePointer2, Hammer, Wrench, LocateFixed, Navigation2, RotateCw, CircleHelp, Check, X, Info, Pickaxe, PackageOpen, Plus, Save, Download, Upload, Sprout, Award, ArrowRight, Zap, LockKeyhole, MoveRight, Flame, Gem, Hexagon, Anvil, CircuitBoard, Map, Users, MessageCircle, Send, ChevronDown } from 'lucide';
import { BUILDABLE, DEFS, ITEMS, CELL, SITES, WORLD_RADIUS, CRAFTS, canAfford, entries, total, type Category, type Item, type Kind, type Craft } from './data';
import { Simulation, ownsBuilding, SAVE_KEY, newState, type Building } from './simulation';
import { World } from './world';
import { type GraphicsQuality } from './graphics';
import { GameSession } from './session';
import {profileChip,xLogo} from './nameplates';
import {CHAT_MAX_LENGTH} from './protocol';
import {Swords,Trophy} from 'lucide';
import {LeaderboardUI,leaderboardContent} from './leaderboard-ui';
import {PlayerHints,PLAYER_HINTS,type HintId} from './hints';
import './hints.css';
import { tutorialStep } from './tutorial';
import { Atlas } from './atlas';
import {BIOMES,biomeAt,traversable} from './terrain';
import { discoveries, type Discoveries, type Discovery } from './discoveries';
import './inventory.css';
import {CHAPTERS,CHESTS,MACHINE_UPGRADES,BEACON_COST,chapterObjectives,canComplete,tier,chestCapacity,machineDuration,machineSpeed,upgradeOptions,ownedBuildings} from './progression';
import './progression.css';
import {GameAudio,soundForResult} from './audio';
import {hasSeenIntro,introContent,isNewWorkshop,rememberIntro} from './intro';
import './intro.css';
import {CharacterEditor,characterEditorContent} from './character-editor';
import {Shirt} from 'lucide';
import {GATHER_IMPACT} from './gathering';
import {itemIcon} from './item-icons';
import './item-icons.css';
import './controls.css';

const icons={Wind,Logs,Mountain,PanelsTopLeft,BrickWall,Cog,Component,Pause,Play,VolumeX,Volume2,Settings2,Flag,ArrowUpRight,Factory,Waypoints,MousePointer2,Hammer,Wrench,LocateFixed,Navigation2,RotateCw,CircleHelp,Check,X,Info,Pickaxe,PackageOpen,Plus,Save,Download,Upload,Sprout,Award,ArrowRight,Zap,LockKeyhole,MoveRight,Flame,Gem,Hexagon,Anvil,CircuitBoard,Map,Users,MessageCircle,Send,ChevronDown};
const icon=(name:string,cls='')=>`<i data-lucide="${name.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase()}" class="${cls}" aria-hidden="true"></i>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const refreshIcons=()=>{createIcons({icons:{...icons,Swords,Shirt,Trophy},attrs:{'stroke-width':1.6}});document.querySelectorAll('svg[data-lucide]').forEach(svg=>svg.removeAttribute('data-lucide'));};
const text=(id:string,value:string)=>{const node=el(id);if(node.textContent!==value)node.textContent=value;};
const html=(id:string,value:string)=>{const node=el(id);if(node.innerHTML!==value)node.innerHTML=value;};
const hidden=(id:string,value:boolean)=>{const node=el(id);if(node.hidden!==value)node.hidden=value;};
const clock=(t:number)=>`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
export class UI {
  category:Category='Production'; selectedId:number|null=null;
  atlasView:Atlas;
  paused=false;modalOpen=false;readonly audio=new GameAudio();
  private characterEditor?:CharacterEditor;
  private leaderboardView?:LeaderboardUI;
  private dialogTrigger?:HTMLElement;
  private introChecked=new Set<string>();private introOwner?:string;
  private soundOwner='';private soundChapter=-1;private footsteps=0;private soundPosition?:{x:number;z:number};
  toastUntil=0;lastWon=false;time=0;renderedInspector='';
  renderedHover='';renderedMap='';
  private journeyRender='';private pendingCommission=false;private endingOpen=false;private campaignOwner='';
  chatOpen=false;unreadChat=0;renderedChat='__initial__';
  private hints:PlayerHints;
  known:Discoveries;discoveryQueue:Discovery[]=[];discoveryUntil=0;activeDiscovery?:Discovery;
  private discoveryRoom:string|null;private discoveryState:Simulation['state'];private discoveryConnected=false;
  private freshMaterials=new Set<Item>();private freshBlueprints=new Set<Kind>();
  waypoint:{x:number;z:number;label:string}|null=null;
  constructor(public sim:Simulation,public world:World,public session:GameSession){
    this.atlasView=new Atlas(sim,session,()=>this.waypoint,p=>{this.waypoint=p;this.renderedMap='';});
    this.known=discoveries(sim.state);this.discoveryRoom=session.room;this.discoveryState=sim.state;this.discoveryConnected=session.connected;
    el('ui').innerHTML=`
      <header class="topbar">
        <div class="identity"><div class="brand-icon">${icon('Wind')}</div><div><h1>IRONWOOD<span>™</span></h1><p>THE ART OF INDUSTRY</p></div></div>
        <div class="inventory-hud">
          <section class="resources panel" aria-label="Inventory"><span class="inventory-label" title="Your supplies">${icon('PackageOpen')}</span><div id="inventory-items" class="inventory-items"></div><button id="inventory-craft" title="Handcraft · C" aria-label="Craft with your supplies">${icon('Wrench')}<kbd>C</kbd></button></section>
          <div id="discovery" class="discovery" role="status" aria-live="polite" aria-atomic="true" hidden></div>
        </div>
        <nav class="top-actions" aria-label="Game controls"><button id="pause" class="icon-button panel" aria-label="Pause simulation" title="Pause · Space">${icon('Pause')}</button><button id="sound" class="icon-button panel" aria-label="Enable sound" title="Sound">${icon('VolumeX')}</button><button id="settings" class="icon-button panel" aria-label="Open settings" title="Settings">${icon('Settings2')}</button></nav>
        <nav class="expedition-bar panel" aria-label="Explore Ironwood"><button id="leaderboard" title="Leaderboard · L" aria-haspopup="dialog">${icon('Trophy')} Leaderboard <kbd aria-hidden="true">L</kbd></button><button id="atlas" title="World map · M">${icon('Map')} Map <kbd aria-hidden="true">M</kbd></button><button id="coop">${icon('Users')} World <span id="crew-status">Connecting…</span></button><button id="journey" title="Chapters, upgrades & badges · J">${icon('Award')} Journey <span id="journey-count">1 / 8</span></button></nav>
      </header>
      <aside id="global-chat" class="global-chat">
        <button id="chat-toggle" class="chat-tab panel" aria-expanded="false" aria-controls="chat-panel">${icon('MessageCircle')}<span>World chat</span><b id="chat-unread" hidden>0</b></button>
        <section id="chat-panel" class="chat-panel panel" aria-label="World chat" hidden>
          <header><div><span class="tiny-dot"></span><strong>WORLD CHAT</strong></div><button id="chat-close" aria-label="Collapse world chat">${icon('ChevronDown')}</button></header>
          <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
          <label id="chat-input-label" class="chat-input-label" for="chat-input">Message the world</label>
          <form id="chat-form" class="chat-form"><input id="chat-input" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" placeholder="Write a message…" aria-describedby="chat-input-help"/><button type="submit" aria-label="Send message">${icon('Send')}</button></form>
          <p id="chat-input-help" class="chat-input-help">Press Enter to send</p>
        </section>
      </aside>
      <div id="expedition-hint" class="expedition-hint panel"></div>
      <aside class="mission panel">
        <div class="eyebrow"><span class="tiny-dot"></span> YOUR NEXT CHAPTER <span id="chapter">01 / 08</span><button id="mission-toggle" aria-label="Collapse chapter details" aria-expanded="true" aria-controls="mission-details">${icon('ChevronDown')}</button></div>
        <h2 id="mission-title">A spark of possibility</h2><div id="mission-details"><p id="mission-copy">Every great invention starts small.<br>Give your workshop room to grow.</p>
        <div id="objectives"></div>
        <button id="mission-action" class="button" hidden></button>
        <button id="mission-journey" class="mission-journey">View chapters & rewards ${icon('ArrowRight')}</button>
        <div class="mission-foot"><span>${icon('Flag')} THE MECHANIST’S GUILD</span><button id="guide" aria-label="Open field guide" title="Field guide">${icon('ArrowUpRight')}</button></div></div>
      </aside>
      <div class="island-caption"><span id="biome-caption">THE OPEN FRONTIER</span><span>EST. DAY <b id="day">01</b></span></div>
      <aside id="inspector" class="inspector panel" hidden></aside>
      <div id="dock-hints" class="dock-hints">
        <div id="world-label" class="world-label" hidden></div>
        <div id="build-hint" class="build-hint panel" hidden></div>
        <div id="toast" role="status" class="toast" hidden></div>
      </div>
      <div id="fps-counter" class="fps-counter" hidden>Measuring FPS…</div>
      <div id="paused" class="paused" hidden>${icon('Pause')} ESCAPE <small>Space to resume</small></div>
      <div class="bottom-area">
        <div class="factory-status"><div><span class="live-dot"></span><strong id="factory-state">Your workshop is waking up</strong></div><p><span id="power-stat">12 / 24</span> power <span class="dot-divider">·</span> <span id="machine-stat">4</span> machines <span class="dot-divider">·</span> <span id="rate-stat">0</span> / min dispatched</p><button id="power-view">${icon('Zap')} Highlight power network</button></div>
        <section class="build-dock" aria-label="Recipe book. Hover or focus to open.">
          <div class="dock-head"><div class="categories" role="tablist" aria-label="Building category">${(['Production','Logistics','Power'] as Category[]).map(c=>`<button id="category-${c}" data-category="${c}" role="tab" tabindex="${c==='Production'?0:-1}" aria-controls="build-items" aria-selected="${c==='Production'}">${icon(c==='Production'?'Factory':c==='Logistics'?'Waypoints':'Wind')}${c}</button>`).join('')}</div><div class="dock-tools"><button id="build-toggle" aria-label="Keep blueprints open" aria-pressed="false" title="Keep blueprints open">${icon('ChevronDown')}</button><button id="inspect-tool" class="active" aria-label="Inspect mode" aria-pressed="true" title="Inspect · Escape">${icon('MousePointer2')}</button><button id="dismantle" aria-label="Dismantle mode" aria-pressed="false" title="Dismantle · X">${icon('Hammer')}</button><span></span><button id="craft" aria-label="Open handcrafting" title="Handcraft · C">${icon('Wrench')}</button></div></div>
          <div id="build-items" class="build-items" role="tabpanel" aria-labelledby="category-Production"></div>
          <div class="dock-foot"><span><kbd>1</kbd> – <kbd>6</kbd> select <span>·</span> <kbd>R</kbd> rotate <span>·</span> <kbd>ESC</kbd> cancel</span><span id="dock-note">MAKE SOMETHING REMARKABLE</span></div>
        </section>
        <div class="map-wrap"><div class="map-head"><span>THE GREEN REACH</span><button id="recenter" aria-label="Recenter camera" title="Recenter · F">${icon('LocateFixed')}</button></div><canvas id="minimap" width="320" height="240" aria-label="Nearby terrain and engineers" aria-describedby="map-nearby"></canvas><button id="map-nearby" title="Find nearby engineers on the map">Connecting…</button><div class="map-foot"><span>N ${icon('Navigation2')}</span><span id="coordinates">00 : 00</span><button id="rotate-camera" aria-label="Rotate camera" title="Rotate camera · Q">${icon('RotateCw')}</button></div></div>
      </div>
      <footer class="controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move <span>·</span> <kbd>SHIFT</kbd> run <span>·</span> <kbd>E</kbd> gather <span>·</span> <kbd>/</kbd> chat <span>·</span> scroll to zoom</span><span id="save-state">${icon('Check')} Autosave enabled</span><button id="help">${icon('CircleHelp')} Field guide</button></footer>
      <dialog id="dialog"><div id="dialog-content"></div></dialog>`;
    this.hints=new PlayerHints(el('dock-hints'));
    const hintControls:Record<string,HintId>={atlas:'map',coop:'world',journey:'journey','mission-journey':'journey',craft:'craft','inventory-craft':'craft',settings:'settings','customize-character':'appearance','combat-attack':'combat','power-view':'power',collect:'inspect',feed:'inspect','upgrade-building':'upgrades','dismantle':'dismantle'};
    el('ui').addEventListener('click',event=>{const button=(event.target as Element).closest('button');if(button?.dataset.build)this.hints.schedule.complete('build');const learned=button&&hintControls[button.id];if(learned)this.hints.schedule.complete(learned);});
    this.bind();this.renderInventory();this.renderBuilds();this.updateSoundControls();refreshIcons();this.applyGraphics();this.update(0);
    world.onAction=(x,z,drag)=>this.act(x,z,drag);world.onMove=()=>this.updateHover();
    session.onGather=(playerId,strike)=>{world.gather(playerId,strike);if(playerId===session.id)this.audio.play(strike.item==='log'?'wood':strike.item==='crystal'?'crystal':'stone',GATHER_IMPACT);};
    session.onResult=message=>{const effect=soundForResult(message);if(effect)this.audio.play(effect);};
    world.onRotate=(id,dir)=>{const message=this.session.action({type:'rotate',id,dir});if(message)this.toast(message);};
    world.onTurn=(x,z,dir)=>{this.session.action({type:'turn',x,z,dir});};
    world.onConveyors=(path,dir)=>{
      if(this.modalOpen)return;
      if(world.conveyorPlan?.error){this.toast(world.conveyorPlan.error);return;}
      const message=this.session.action({type:'conveyors',path,dir});if(message)this.toast(message);
    };
    session.onMessage=message=>{this.toast(message);if(el('craft-feedback'))el('craft-feedback').textContent=message;if(el('journey-feedback'))el('journey-feedback').textContent=message;if(this.pendingCommission&&!message.startsWith('The beacon is lit')){this.pendingCommission=false;this.journeyRender='';}};
    session.onChat=message=>{if(!this.chatOpen&&message.playerId!==session.id){this.unreadChat++;this.updateChatBadge();}this.renderChat();};
    session.onChange=()=>{world.multiplayer=true;world.crew=session.players.filter(p=>p.id!==session.id);world.bases=session.bases;world.ownId=session.id;const own=session.players.find(p=>p.id===session.id);if(own)world.setAppearance(own.appearance);text('crew-status',session.status);if(el('crew-feedback'))text('crew-feedback',session.status);this.updateChatInput();};
    this.toast(sim.state.buildings.length?'Follow your next chapter to keep the workshop growing.':'Connecting to Ironwood. Your own home plot and supplies will be ready shortly.',7500);
  }
  renderBuilds(animate:Kind[]=[]){
    el('inspect-tool').setAttribute('aria-pressed',String(this.world.mode==='inspect'&&!this.world.selectedKind));
    el('dismantle').setAttribute('aria-pressed',String(this.world.mode==='dismantle'));
    const list=this.availableBuilds();
    el('build-items').innerHTML=list.map((kind,i)=>{
      const d=DEFS[kind],fresh=this.freshBlueprints.has(kind);
      return `<button class="build-card ${this.world.selectedKind===kind?'selected':''} ${animate.includes(kind)?'is-discovered':''}" data-build="${kind}" aria-label="Build ${d.name}" aria-pressed="${this.world.selectedKind===kind}" title="${d.name} — ${d.subtitle} — ${entries(d.cost).map(([k,n])=>`${n} ${ITEMS[k].name}`).join(', ')}"><span class="slot-key">${i+1}</span>${fresh?'<span class="new-blueprint">NEW</span>':''}<img src="${this.world.thumbnails[kind]}" alt="" draggable="false"/>${d.generation?`<span class="building-power">${d.generation} power</span>`:''}<span class="building-name">${d.name}</span><span class="building-cost">${entries(d.cost).map(([k,n])=>`${itemIcon(k)} ${n}`).join('<span class="cost-separator"></span>')}</span></button>`;
    }).join('');
    el('build-items').querySelectorAll<HTMLButtonElement>('[data-build]').forEach(b=>b.onclick=()=>this.select(b.dataset.build as Kind));refreshIcons();
  }
  availableBuilds(){return this.known.blueprints.filter(k=>DEFS[k].category===this.category);}
  renderInventory(){
    const container=el('inventory-items');
    for(const item of this.known.materials){
      if(el(`res-${item}`))continue;
      const d=ITEMS[item],node=document.createElement('div');
      node.className=`resource ${this.freshMaterials.has(item)?'is-discovered':''}`;node.dataset.material=item;node.tabIndex=0;
      node.innerHTML=`${itemIcon(item)}<small>${d.name}</small><b id="res-${item}">0</b>`;
      node.addEventListener('animationend',()=>node.classList.remove('is-discovered'));
      container.append(node);
    }
    container.classList.toggle('compact',this.known.materials.length>6);refreshIcons();
  }
  updateDiscoveries(){
    const s=this.sim.state,next=discoveries(s);
    // Snapshot objects change every network update; only a different expedition resets notices.
    const reset=this.discoveryRoom!==this.session.room||(!this.session.room&&this.discoveryState!==s)||(!this.discoveryConnected&&this.session.connected);
    this.discoveryRoom=this.session.room;this.discoveryState=s;this.discoveryConnected=this.session.connected;
    if(reset){
      this.known=next;this.discoveryQueue=[];this.activeDiscovery=undefined;this.freshMaterials.clear();this.freshBlueprints.clear();
      hidden('discovery',true);el('inventory-items').replaceChildren();this.renderInventory();this.renderBuilds();
      if(el('craft-recipes'))this.renderCraftRecipes();
      if(this.world.selectedKind&&!next.blueprints.includes(this.world.selectedKind))this.cancel();
      return;
    }
    let changed=false;const blueprints:Kind[]=[];
    for(const item of next.materials)if(!this.known.materials.includes(item)){
      this.known.materials.push(item);this.freshMaterials.add(item);this.discoveryQueue.push({type:'material',item});changed=true;
    }
    for(const kind of next.blueprints)if(!this.known.blueprints.includes(kind)){
      this.known.blueprints.push(kind);this.freshBlueprints.add(kind);blueprints.push(kind);this.discoveryQueue.push({type:'blueprint',kind});changed=true;
    }
    for(const recipe of next.recipes)if(!this.known.recipes.includes(recipe)){
      this.known.recipes.push(recipe);this.discoveryQueue.push({type:'recipe',recipe});changed=true;
    }
    if(changed){this.renderInventory();this.renderBuilds(blueprints);if(el('craft-recipes'))this.renderCraftRecipes();}
    // A modal hides the HUD. Keep each discovery queued until it can actually be seen.
    if(this.modalOpen){if(this.activeDiscovery){this.discoveryUntil=this.time+4;el('discovery').classList.remove('leaving');}return;}
    if(this.activeDiscovery&&this.time>=this.discoveryUntil){
      el('discovery').classList.add('leaving');
      if(this.time<this.discoveryUntil+.2)return;
      hidden('discovery',true);this.activeDiscovery=undefined;
    }
    if(this.activeDiscovery||!this.discoveryQueue.length)return;
    const discovery=this.discoveryQueue.shift()!;this.activeDiscovery=discovery;this.discoveryUntil=this.time+4;
    const material=discovery.type==='material';
    const name=discovery.type==='blueprint'?DEFS[discovery.kind].name:ITEMS[discovery.type==='material'?discovery.item:discovery.recipe].name;
    const artwork=discovery.type==='blueprint'?`<img src="${this.world.thumbnails[discovery.kind]}" alt=""/>`:itemIcon(discovery.type==='material'?discovery.item:discovery.recipe);
    const detail=material?'Now shown in your supplies':discovery.type==='recipe'?'Ready in handcrafting · C':`Ready in ${DEFS[discovery.kind].category}`;
    const notice=el('discovery');notice.classList.remove('leaving');notice.innerHTML=`<span class="discovery-art">${artwork}</span><div><small>${material?'New material discovered!':'New blueprint discovered!'}</small><strong>${name}</strong><p>${detail}</p></div><button id="dismiss-discovery" aria-label="Dismiss discovery">${icon('X')}</button>`;
    notice.hidden=false;el('dismiss-discovery').onclick=()=>{this.discoveryUntil=this.time;};refreshIcons();this.audio.play('discovery');
    if(material){
      const resource=el(`res-${discovery.item}`)?.closest('.resource');resource?.classList.add('is-discovered');
      if(!el('inventory-items').contains(document.activeElement))resource?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
  }
  select(kind:Kind){
    if(!this.known.blueprints.includes(kind)){this.toast('Discover the ingredients to reveal this blueprint.');return;}
    if(DEFS[kind].unlock>this.sim.state.unlock){this.toast(kind==='press'?'Produce 10 iron ingots to unlock the gear press.':`Produce 8 gears to unlock the ${DEFS[kind].name.toLowerCase()}.`);return;}
    if(this.world.selectedKind===kind){this.cancel();return;}
    this.world.setBuild(kind);this.selectedId=null;this.world.highlightBuilding(null);el('inspector').hidden=true;
    this.freshBlueprints.delete(kind);
    el('inspect-tool').classList.remove('active');el('dismantle').classList.remove('active');
    this.renderBuilds();this.updateHover();this.audio.play('select');
  }
  cancel(){this.world.setBuild(null);this.world.mode='inspect';el('build-hint').hidden=true;el('dismantle').classList.remove('active');el('inspect-tool').classList.add('active');this.renderBuilds();}
  act(x:number,z:number,drag:boolean){
    if(this.modalOpen)return;
    if(this.world.mode==='dismantle'){
      const b=this.sim.at(x,z);if(!b)return;const message=this.session.action({type:'dismantle',id:b.id});if(message)this.toast(message);this.selectedId=null;this.world.highlightBuilding(null);el('inspector').hidden=true;return;
    }
    if(this.world.selectedKind){
      const message=this.session.action({type:'place',kind:this.world.selectedKind,x,z,dir:this.world.dir});
      if(message&&!drag)this.toast(message);
      this.updateHover();return;
    }
    const b=this.sim.at(x,z);
    if(!b&&this.world.hoverResource){const message=this.session.action({type:'gather',target:this.world.hoverResource});if(message)this.toast(message);return;}
    this.selectedId=b?.id||null;this.world.highlightBuilding(this.selectedId);this.renderedInspector='';
    if(!b){el('inspector').hidden=true;const site=this.sim.siteAt(x,z);if(site){const message=this.session.action({type:'gather',target:site.id});if(message)this.toast(message);}}
    else this.renderInspector(b);
  }
  updateHover(){
    const w=this.world;el('world-label').hidden=true;
    if(w.selectedKind){
      if(w.selectedKind==='conveyor'){
        const plan=w.conveyorPlan,b=this.sim.at(w.hover.x,w.hover.z);
        const err=plan?.error||(!plan&&b&&!ownsBuilding(this.sim.state,b)?'Only the owner and their clan can connect these machines.':!plan&&!b?this.sim.placementError('conveyor',w.hover.x,w.hover.z):null);
        const title=plan?`${plan.tiles.length} conveyor${plan.tiles.length===1?'':'s'} · ${plan.cost} timber`:b?.kind==='conveyor'?'Extend or turn this conveyor':'Conveyor · automatic turns and slopes';
        const detail=err||(plan?'Release to build · Retrace to shorten · Esc to cancel':b?'Drag from an output to extend the route':'Click to place · Drag to draw a route');
        const output=plan?.tiles.at(-1)?.dir??b?.dir??w.dir;
        const end=w.conveyorPath.at(-1),connected=end&&this.sim.at(end.x,end.z);
        const directionHint=plan&&connected&&connected.kind!=='conveyor'&&!err?'Machine input connected':`Output ${['east →','south ↓','west ←','north ↑'][output]} · <kbd>R</kbd> rotate${plan?' end':''}`;
        const key=JSON.stringify([title,detail,directionHint]);
        el('build-hint').hidden=false;el('build-hint').classList.toggle('invalid',!!err);
        if(key!==this.renderedHover){this.renderedHover=key;el('build-hint').innerHTML=`${icon(err?'Info':'MoveRight')}<div><strong>${title}</strong><span>${detail}</span><span>${directionHint}</span></div>`;refreshIcons();}
        return;
      }
      const d=DEFS[w.selectedKind],err=this.sim.placementError(w.selectedKind,w.hover.x,w.hover.z);
      el('build-hint').hidden=false;el('build-hint').classList.toggle('invalid',!!err);
      const key=`${w.selectedKind}:${w.dir}:${err}`;
      if(key!==this.renderedHover){this.renderedHover=key;el('build-hint').innerHTML=`${icon(err?'Info':'MousePointer2')}<div><strong>${d.name}</strong><span>${err||`Click to place · Output ${['east →','south ↓','west ←','north ↑'][w.dir]}`}</span>${d.generation?`<span>${w.selectedKind==='steam'?'Coal deposit only · 72 power · mines its own fuel':d.subtitle}</span>`:''}</div><kbd>R</kbd>`;refreshIcons();}
    } else if(w.mode==='dismantle'){
      el('build-hint').hidden=false;if(this.renderedHover!=='dismantle'){this.renderedHover='dismantle';el('build-hint').classList.remove('invalid');el('build-hint').innerHTML=`${icon('Hammer')}<div><strong>Dismantle</strong><span>Click a building to recover its materials.</span></div><kbd>ESC</kbd>`;refreshIcons();}
    } else {
      el('build-hint').hidden=true;const b=this.sim.at(w.hover.x,w.hover.z);
      if(b&&w.pointerPresent&&!this.selectedId){const label=el('world-label');label.hidden=false;label.textContent=DEFS[b.kind].name;}
      else if(!b&&w.pointerPresent){
        const id=w.hoverResource||this.sim.siteAt(w.hover.x,w.hover.z)?.id,target=id&&this.sim.gatherTarget(id);
        if(target){
          const label=el('world-label');
          const site=target.node?.siteId||(!target.node&&target.id),machine=target.item==='log'?'Lumber camp':target.item==='ore'?'Iron mine':target.item==='coal'?'Coal power plant or mineral drill':'Mineral drill';
          label.hidden=false;
          label.textContent=`${target.name} · ${target.item==='log'?'Click to chop':'Click to mine'}${site?` · ${machine} site`:''}`;
        }
      }
    }
  }
  renderInspector(b:Building){
    const owned=ownsBuilding(this.sim.state,b);
    const def={...DEFS[b.kind],name:b.kind==='storage'?CHESTS[tier(b)].name:DEFS[b.kind].name,duration:machineDuration(b),output:this.sim.output(b)},rate=b.events.length*total(this.sim.output(b));
    const coalSite=b.kind==='steam'?this.sim.siteAt(b.x,b.z):undefined;
    const html=`<div class="inspector-top"><span class="eyebrow">${def.category.toUpperCase()} <span>№ ${String(b.id).padStart(3,'0')}</span></span><button id="close-inspector" aria-label="Close inspector">${icon('X')}</button></div><h2>${def.name}</h2><p class="flavor">${def.subtitle}</p><div class="machine-state ${b.status==='Working'?'working':''}"><span class="tiny-dot"></span>${b.status}</div>
      ${def.duration?`<div class="recipe">${entries(def.input||{}).map(([k,n])=>`<span style="color:${ITEMS[k].color}">${itemIcon(k)}<b>${n}</b></span>`).join('<small>+</small>')||icon('Pickaxe')}<span class="recipe-arrow">→</span>${entries(def.output||{}).map(([k,n])=>`<span style="color:${ITEMS[k].color}">${itemIcon(k)}<b>${n}</b></span>`).join('')}<small>${def.duration}s</small></div><div class="progress-track"><i id="machine-progress"></i></div><div class="stat-pair"><span>Production <small>last 60s</small></span><b>${rate} <small>/ ${60/def.duration*total(def.output||{})} per min</small></b></div><div class="stat-pair"><span>Power supplied</span><b>${Math.round(b.power*100)}% <small>of ${def.power}</small></b></div>`:''}
      ${b.kind==='windmill'?`<div class="stat-pair"><span>Mechanical power</span><b>${def.generation} <small>capacity</small></b></div><p class="note">Free power for your first wood and iron lines. Windmills must be at least 4 tiles apart. For a larger factory, build a coal power plant on a coal deposit for ${DEFS.steam.generation} power. Posts extend connections by 5 tiles.</p>`:''}
      ${def.fuel?`<div class="stat-pair"><span>Power capacity</span><b>${def.generation}</b></div><div class="stat-pair"><span>Current burn</span><b>${Math.ceil(b.fuelRemaining)}s</b></div>${coalSite?.item==='coal'?`<div class="stat-pair"><span>Coal in seam</span><b>${this.sim.remaining(coalSite).toLocaleString('en-US')}</b></div><p class="note">Mines and burns 1 coal every ${def.burnTime}s automatically. No starter power needed. When the seam runs out, deliver coal by conveyor or load it here. Posts carry power back to your factory.</p>`:`<p class="note">1 ${ITEMS[def.fuel].name.toLowerCase()} powers this ${b.kind==='steam'?'plant':'engine'} for ${def.burnTime}s. Load fuel or connect a conveyor. Posts connect within 5 tiles.</p>`}`:''}
      ${b.kind==='post'?'<p class="note">Automatically wires to generators and posts within 5 tiles. Machines within 4.6 tiles receive power. Wires stay visible; highlight the network to trace its connections.</p>':''}
      ${b.kind==='depot'?`<div class="stat-pair"><span>Mechanisms delivered</span><b>${this.sim.state.delivered}</b></div><p class="note">Route an assembly bench here by conveyor. Automated deliveries count toward your guild commission.</p>`:''}
      <div class="buffer">${total(b.input)?`<span>INPUT</span><p>${entries(b.input).filter(([,n])=>n>0).map(([k,n])=>`<span>${itemIcon(k)}${n} ${ITEMS[k].name.toLowerCase()}</span>`).join('')}</p>`:''}${total(b.output)?`<span>OUTPUT</span><p>${entries(b.output).filter(([,n])=>n>0).map(([k,n])=>`<span>${itemIcon(k)}${n} ${ITEMS[k].name.toLowerCase()}</span>`).join('')}</p>`:''}${b.item?`<span>ON BELT</span><p>${itemIcon(b.item)}${ITEMS[b.item].name}</p>`:''}</div>
      ${this.upgradeContent(b,owned)}
      ${!owned?'<p class="owner-note">Another engineer’s workshop · Inspect only</p>':''}<div class="inspector-buttons">${owned&&b.kind!=='depot'&&!def.generation&&b.kind!=='post'?`<button id="collect" class="button secondary">${icon('PackageOpen')} Collect</button>`:''}${owned&&def.input?`<button id="feed" class="button secondary">${icon('Plus')} Load inputs</button>`:''}</div><div class="port-note">${def.generation||b.kind==='post'?`${icon('Zap')} Automatic wires · machines within 4.6 tiles${def.fuel?`<br>Fuel inputs on all sides except ${['east','south','west','north'][b.dir]}.`:''}`:`${icon('MoveRight')} Output faces ${['east','south','west','north'][b.dir]} · inputs on other sides`}</div>`;
    const updateProgress=()=>{const bar=el('machine-progress');if(bar&&def.duration){const width=`${Math.round(b.progress/def.duration*100)}%`;if(bar.style.width!==width)bar.style.width=width;}};
    if(html===this.renderedInspector){updateProgress();return;}
    const focused=el('inspector').contains(document.activeElement)?document.activeElement?.id:null;
    this.renderedInspector=html;el('inspector').hidden=false;el('inspector').innerHTML=html;updateProgress();
    if(focused)el(focused)?.focus({preventScroll:true});
    el('close-inspector').onclick=()=>{this.selectedId=null;this.world.highlightBuilding(null);el('inspector').hidden=true;};
    const collect=el('collect');if(collect)collect.onclick=()=>{const m=this.session.action({type:'collect',id:b.id});if(m)this.toast(m);};
    const feed=el('feed');if(feed)feed.onclick=()=>{const m=this.session.action({type:'feed',id:b.id});if(m)this.toast(m);};
    const upgrade=el<HTMLButtonElement>('upgrade-building');if(upgrade)upgrade.onclick=()=>{const m=this.session.action({type:'upgrade',id:b.id});if(m)this.toast(m);};refreshIcons();
  }
  upgradeContent(b:Building,owned:boolean){
    const options=upgradeOptions(b);if(!options.length)return '';
    const next=options[tier(b)+1],storage=b.kind==='storage',current=storage?`${total(b.input).toLocaleString('en-US')} / ${chestCapacity(b).toLocaleString('en-US')} items`:`${machineSpeed(b)}× production · same power`;
    const canUpgrade=!!next&&this.sim.state.unlock>=next.unlock&&canAfford(this.sim.state.inventory,next.cost)&&this.session.connected;
    return `<section class="upgrade-card" aria-label="Building upgrades"><div class="upgrade-heading"><span>${storage?'STORAGE':'DRIVE'} TIER ${tier(b)+1} / ${options.length}</span>${icon(storage?'PackageOpen':'Zap')}</div><strong>${current}</strong>${next?`<p>${storage?`${CHESTS[tier(b)+1].capacity.toLocaleString('en-US')} items · ${CHESTS[tier(b)+1].capacity/chestCapacity(b)}× capacity`:`${MACHINE_UPGRADES[tier(b)+1].speed}× production at the same power cost`}</p><p class="upgrade-cost">${entries(next.cost).map(([k,n])=>`<span class="${(this.sim.state.inventory[k]||0)<n?'missing':''}">${itemIcon(k)}${n} ${ITEMS[k].name.toLowerCase()}</span>`).join(' · ')}</p>${owned?`<button id="upgrade-building" class="button" ${canUpgrade?'':'disabled'}>${this.sim.state.unlock<next.unlock?`Unlock in chapter ${next.unlock+1}`:`Upgrade · ${next.name}`}</button>`:''}`:'<p class="upgrade-max">Fully upgraded</p>'}</section>`;
  }
  update(dt:number){
    this.time+=dt;const s=this.sim.state;
    this.maybeShowIntro();this.updateAudio(dt);
    this.updateDiscoveries();
    const machines=ownedBuildings(s),w=this.world;
    this.hints.update(dt,{nearResource:!!this.sim.gatherTarget(),hasMachines:machines.length>0,needsPower:machines.some(b=>DEFS[b.kind].power>0&&b.power===0),inspecting:this.selectedId!==null,building:!!w.selectedKind,conveyor:w.selectedKind==='conveyor',dismantling:w.mode==='dismantle',nearPlayer:this.session.players.some(p=>p.id!==this.session.id&&Math.hypot(p.x-s.player.x,p.z-s.player.z)<=CELL*3),hasClan:!!this.session.clan,advanced:s.unlock>=3,hasCombat:!!el('combat-attack'),canCustomize:!!el('customize-character')},!this.session.connected||this.modalOpen||document.hidden||!el('toast').hidden||!el('discovery').hidden||this.chatOpen||!!document.activeElement?.closest('input,textarea,select,[contenteditable="true"]'));
    this.updateChatInput();
    for(const k of this.known.materials){
      const count=Math.floor(s.inventory[k]||0);text(`res-${k}`,String(count));
      const node=el(`res-${k}`).closest<HTMLElement>('.resource')!,label=`${ITEMS[k].name}: ${count}`;
      if(node.title!==label){node.title=label;node.setAttribute('aria-label',label);node.classList.toggle('empty',count===0);}
    }
    text('power-stat',`${this.sim.demand} / ${this.sim.supply}`);
    text('machine-stat',String(s.buildings.filter(b=>ownsBuilding(s,b)&&DEFS[b.kind].power>0).length));
    text('rate-stat',String(s.deliveryEvents.length));
    const active=s.buildings.filter(b=>ownsBuilding(s,b)&&b.status==='Working').length;
    text('factory-state',active?`${active} machines finding their rhythm`:s.buildings.length?'A quiet moment in the workshop':'Build your first lumber camp');
    text('day',String(Math.floor(s.time/600)+1).padStart(2,'0'));
    text('coordinates',`${Math.round(s.player.x/CELL)} : ${Math.round(s.player.z/CELL)}`);
    hidden('paused',!this.paused);
    if(this.time>this.toastUntil)hidden('toast',true);
    const b=s.buildings.find(b=>b.id===this.selectedId);if(b)this.renderInspector(b);else if(this.selectedId){this.selectedId=null;hidden('inspector',true);this.world.highlightBuilding(null);}
    if(this.campaignOwner!==(s.owner||'')){this.campaignOwner=s.owner||'';this.lastWon=false;this.pendingCommission=false;}
    if(s.won&&!this.lastWon&&!s.campaign.completionSeen&&(!this.modalOpen||this.pendingCommission)){this.lastWon=true;this.pendingCommission=false;this.showWin();}
    text('journey-count',s.won?'Completed':`${s.unlock+1} / ${CHAPTERS.length}`);
    el('journey').classList.toggle('journey-complete',s.won);
    if(el('journey-chapters'))this.renderJourney();
    this.updateMission();this.drawMap();this.renderChat();
    this.updateExpedition();this.updateCraftButtons();if(this.modalOpen&&el('atlas-canvas'))this.atlasView.draw();
    text('dock-note',this.world.selectedKind?`${DEFS[this.world.selectedKind].name.toUpperCase()} · ${['EAST','SOUTH','WEST','NORTH'][this.world.dir]}`:'MAKE SOMETHING REMARKABLE');
  }
  updateMission(){
    const s=this.sim.state,tutorial=s.unlock===0?tutorialStep(this.sim):undefined,chapter=CHAPTERS[s.unlock];
    text('chapter',s.won?'COMPLETE':tutorial?'TUTORIAL':`0${s.unlock+1} / 08`);
    text('mission-title',s.won?'Master of Ironwood':tutorial?.title||chapter.title);
    text('mission-copy',s.won?'The beacon is lit. All eight chapters are complete, and your place in the guild is earned. This world is still yours to build.':tutorial?.copy||chapter.copy);
    const steps=tutorial?[{text:tutorial.objective,n:tutorial.n,max:tutorial.max}]:chapterObjectives(s);
    html('objectives',s.won?'<p class="completion-note">✓ Campaign complete · Permanent badge earned</p>':steps.map(v=>`<div class="objective ${v.n>=v.max?'complete':''}"><span class="objective-check">${v.n>=v.max?'✓':''}</span><span>${v.text}</span><b>${Math.min(v.n,v.max)}<small>/${v.max}</small></b></div>`).join('')+`<div class="progress-track"><i style="width:${steps.reduce((n,v)=>n+Math.min(1,v.n/v.max),0)/steps.length*100}%"></i></div><p class="challenge-note">${s.unlock===7&&!s.campaign.mastery?`Current minute ${clock(s.time-s.challenge.start)} · three consecutive minutes`:`Next reward: ${chapter.reward}`}</p>`);
    const action=this.missionAction(),finale=s.unlock===7&&!s.won;hidden('mission-action',!action&&!finale);
    if(action||finale)text('mission-action',finale?'View the final commission':`Choose ${DEFS[action!].name.toLowerCase()}`);
    text('mission-journey',s.won?'View your completion badge →':'View chapters & rewards →');
    this.world.tutorialMarker.visible=!!tutorial?.site;
    if(tutorial?.site)this.world.tutorialMarker.position.set(tutorial.site.x*CELL,this.world.height(tutorial.site.x*CELL,tutorial.site.z*CELL)+.04,tutorial.site.z*CELL);
  }
  missionAction():Kind|undefined {
    const s=this.sim.state;if(s.won)return;
    if(s.unlock===0)return tutorialStep(this.sim)?.action;
    const choices:Partial<Record<number,Kind[]>>={1:['press'],2:['assembler','depot'],3:['foundry','storage'],4:['kiln','etcher'],5:['forge'],6:['artificer']};
    return choices[s.unlock]?.find(kind=>!ownedBuildings(s).some(b=>b.kind===kind)&&this.known.blueprints.includes(kind));
  }
  chooseMissionBuild(){
    const kind=this.missionAction();if(!kind)return;
    this.category=DEFS[kind].category;
    document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>{const selected=b.dataset.category===this.category;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    el('build-items').setAttribute('aria-labelledby','category-'+this.category);
    if(this.world.selectedKind!==kind)this.select(kind);else this.renderBuilds();
    const site=tutorialStep(this.sim)?.site;
    if(site){this.waypoint={x:site.x,z:site.z,label:site.name};this.renderedMap='';}
  }
  drawMap(){
    const nearby=this.atlasView.nearby().length;text('map-nearby',this.session.connected?`${nearby} engineer${nearby===1?'':'s'} nearby`:'Reconnecting…');
    const player=this.sim.state.player,key=`${this.sim.revision}:${this.sim.state.explored.length}:${Math.round(player.x*10.8/CELL)}:${Math.round(player.z*9.2/CELL)}:${this.session.connected}:${this.session.players.map(p=>`${p.id},${p.name},${p.color},${p.x},${p.z}`).join(';')}`;
    if(this.renderedMap===key)return;this.renderedMap=key;
    this.paintMap(el<HTMLCanvasElement>('minimap'),false);
  }
  bind(){
    el('help').before(el('fps-counter'));
    const tabs=[...document.querySelectorAll<HTMLButtonElement>('[data-category]')];
    tabs.forEach((button,index)=>{
      button.onclick=()=>{
        this.category=button.dataset.category as Category;
        tabs.forEach(tab=>{tab.setAttribute('aria-selected',String(tab===button));tab.tabIndex=tab===button?0:-1;});
        el('build-items').setAttribute('aria-labelledby',button.id);this.renderBuilds();
      };
      button.onkeydown=event=>{
        const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
        if(next===undefined)return;event.preventDefault();tabs[next].focus();tabs[next].click();
      };
    });
    el('build-toggle').onclick=()=>{
      const pinned=el('build-toggle').closest('.build-dock')!.classList.toggle('is-pinned');
      el('build-toggle').setAttribute('aria-pressed',String(pinned));
      el('build-toggle').setAttribute('aria-label',pinned?'Unpin blueprints':'Keep blueprints open');
      el('build-toggle').title=pinned?'Unpin blueprints':'Keep blueprints open';
    };
    const setChapterExpanded=(expanded:boolean)=>{
      el('mission-details').hidden=!expanded;el('mission-toggle').setAttribute('aria-expanded',String(expanded));
      el('mission-toggle').setAttribute('aria-label',expanded?'Collapse chapter details':'Expand chapter details');
    };
    const compactChapter=matchMedia('(max-width:800px), (pointer: coarse)');
    setChapterExpanded(!compactChapter.matches);compactChapter.addEventListener('change',event=>setChapterExpanded(!event.matches));
    el('mission-toggle').onclick=()=>setChapterExpanded(el('mission-details').hidden);
    el('pause').onclick=()=>this.togglePause();el('sound').onclick=()=>{
      const audible=this.audio.settings.enabled&&this.audio.settings.volume>0;
      if(!audible&&this.audio.settings.volume===0)this.audio.setVolume(.65);
      this.audio.setEnabled(!audible);this.updateSoundControls();void this.audio.unlock().then(()=>this.audio.play('select'));
    };
    el('settings').onclick=()=>this.settings();el('help').onclick=()=>this.guide();el('guide').onclick=()=>this.guide();el('craft').onclick=el('inventory-craft').onclick=()=>this.crafting();
    const characterButton=document.createElement('button');characterButton.id='customize-character';characterButton.className='icon-button panel';characterButton.setAttribute('aria-label','Customize character');characterButton.title='Customize character · V';characterButton.innerHTML=icon('Shirt');characterButton.onclick=()=>this.customizeCharacter();el('settings').before(characterButton);
    el('mission-action').onclick=()=>this.sim.state.unlock===7?this.journey():this.chooseMissionBuild();
    el('journey').onclick=el('mission-journey').onclick=()=>this.journey();
    el('atlas').onclick=()=>this.atlas();el('map-nearby').onclick=()=>this.atlas();el('coop').onclick=()=>this.multiplayer();
    el('leaderboard').onclick=()=>this.leaderboard();
    el('chat-toggle').onclick=()=>this.setChatOpen(!this.chatOpen);el('chat-close').onclick=()=>this.setChatOpen(false);
    const chatInput=el<HTMLInputElement>('chat-input');
    chatInput.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&!event.isComposing){event.preventDefault();this.setChatOpen(false);}});
    el<HTMLFormElement>('chat-form').onsubmit=event=>{
      event.preventDefault();const error=this.session.say(chatInput.value);
      if(error){this.toast(error);return;}
      chatInput.value='';chatInput.focus({preventScroll:true});
    };
    el('inspect-tool').onclick=()=>this.cancel();el('dismantle').onclick=()=>this.dismantleMode();
    el('recenter').onclick=()=>{this.world.targetZoom=36;this.world.target.copy(this.world.player.position);};
    el('rotate-camera').onclick=()=>this.world.targetAzimuth+=Math.PI/2;
    el('power-view').setAttribute('aria-pressed','false');
    el('power-view').onclick=()=>{
      this.world.showPower=!this.world.showPower;el('power-view').classList.toggle('enabled',this.world.showPower);
      el('power-view').setAttribute('aria-pressed',String(this.world.showPower));
      el('power-view').innerHTML=icon('Zap')+' Highlight power network';refreshIcons();
    };
    const dialog=el<HTMLDialogElement>('dialog');
    dialog.addEventListener('close',()=>{
      this.modalOpen=dialog.open;this.world.keys.clear();if(dialog.open)return;
      this.finishIntro();this.characterEditor?.dispose();this.characterEditor=undefined;
      this.leaderboardView?.dispose();this.leaderboardView=undefined;
      dialog.classList.remove('intro-dialog','leaderboard-dialog','settings-dialog');
      if(this.endingOpen){this.endingOpen=false;this.session.action({type:'acknowledge-completion'});}
      const trigger=this.dialogTrigger;this.dialogTrigger=undefined;
      // Native dialog.close() may restore focus before this queued event runs.
      // Do not steal it if the player has already moved to another control.
      if(document.activeElement===document.body||document.activeElement===this.world.canvas||dialog.contains(document.activeElement))
        (trigger?.isConnected&&trigger.getClientRects().length?trigger:this.world.canvas).focus({preventScroll:true});
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab'||event.defaultPrevented)return;
      const controls=[...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&node.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    window.addEventListener('keydown',e=>{
      const target=e.target instanceof HTMLElement?e.target:undefined;
      if(e.ctrlKey||e.metaKey||e.altKey||dialog.open||target?.closest('input,select,textarea,[contenteditable="true"]'))return;
      if(target?.closest('button,a,summary,[role="tab"]')&&!['KeyM','KeyJ','KeyL','KeyV','KeyC','KeyH'].includes(e.code))return;
      const learned:Partial<Record<string,HintId>>={KeyW:'move',KeyA:'move',KeyS:'move',KeyD:'move',ArrowUp:'move',ArrowDown:'move',ArrowLeft:'move',ArrowRight:'move',Slash:'chat',KeyE:'gather',KeyM:'map',KeyC:'craft',KeyJ:'journey',KeyQ:'camera',KeyF:'camera',KeyB:'build',KeyR:'rotate',KeyX:'dismantle'};
      if(learned[e.code])this.hints.schedule.complete(learned[e.code]!);
      if(e.repeat&&e.code!=='KeyE')return;
      if(e.code==='Escape'){this.cancel();this.selectedId=null;this.world.highlightBuilding(null);el('inspector').hidden=true;}
      if(e.code==='KeyR'){this.world.rotateBuild();this.updateHover();}
      if(e.code==='KeyQ')this.world.targetAzimuth+=Math.PI/2;
      if(e.code==='KeyF'){this.world.targetZoom=36;this.world.target.copy(this.world.player.position);}
      if(e.code==='KeyE'&&!e.repeat){const m=this.session.action({type:'gather'});if(m)this.toast(m);}
      if(e.code==='KeyM')this.atlas();
      if(e.code==='KeyJ')this.journey();
      if(e.code==='KeyL')this.leaderboard();
      if(e.code==='KeyV')this.customizeCharacter();
      if(e.code==='KeyB'){const kind=this.availableBuilds()[0];if(kind)this.select(kind);}
      if(e.code==='KeyX')this.dismantleMode();if(e.code==='KeyC')this.crafting();if(e.code==='KeyH')this.guide();
      if(e.code==='Space'){e.preventDefault();this.togglePause();}
      if(/^Digit[1-9]$/.test(e.code)){const kind=this.availableBuilds()[Number(e.code.slice(-1))-1];if(kind)this.select(kind);}
    });
    this.world.canvas.addEventListener('contextmenu',e=>{e.preventDefault();this.cancel();});
  }
  setChatOpen(open:boolean){
    const wasFocused=el('chat-panel').contains(document.activeElement);
    this.chatOpen=open;el('chat-panel').hidden=!open;el('chat-toggle').hidden=open;el('chat-toggle').setAttribute('aria-expanded',String(open));
    if(open){this.unreadChat=0;this.updateChatBadge();this.renderedChat='';this.renderChat();requestAnimationFrame(()=>el<HTMLInputElement>('chat-input').focus({preventScroll:true}));}
    else if(wasFocused)el('chat-toggle').focus({preventScroll:true});
  }
  updateChatBadge(){const badge=el('chat-unread');badge.hidden=this.unreadChat===0;badge.textContent=String(Math.min(this.unreadChat,99));}
  updateChatInput(){
    const input=el<HTMLInputElement>('chat-input');
    input.disabled=!this.session.connected;
    el<HTMLFormElement>('chat-form').querySelector<HTMLButtonElement>('button')!.disabled=!this.session.connected;
    text('chat-input-label',this.session.connected?'Message the world':'Reconnecting…');
  }
  renderChat(){
    const key=this.session.chat.map(message=>message.id).join(':');if(key===this.renderedChat)return;this.renderedChat=key;
    const list=el('chat-messages');list.replaceChildren();
    if(!this.session.chat.length){const empty=document.createElement('p');empty.className='chat-empty';empty.textContent='The frontier is quiet. Press / to say hello.';list.append(empty);return;}
    for(const message of this.session.chat){
      const item=document.createElement('article');item.className=message.playerId===this.session.id?'chat-message chat-message-own':'chat-message';
      const meta=document.createElement('header'),author=document.createElement('span');author.className='chat-author';
      if(message.xProfile)author.append(profileChip(message.xProfile));else{author.classList.add('chat-author-guest');author.textContent=message.name;author.style.setProperty('--author-color',message.color);}
      const time=document.createElement('time');time.dateTime=new Date(message.sentAt).toISOString();time.textContent=new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const body=document.createElement('p');body.textContent=message.text;meta.append(author,time);item.append(meta,body);list.append(item);
    }
    if(this.chatOpen)requestAnimationFrame(()=>list.scrollTop=list.scrollHeight);
  }
  dismantleMode(){const off=this.world.mode==='dismantle';this.cancel();if(!off){this.world.mode='dismantle';this.world.grid.visible=true;el('dismantle').classList.add('active');el('inspect-tool').classList.remove('active');}el('dismantle').setAttribute('aria-pressed',String(!off));el('inspect-tool').setAttribute('aria-pressed',String(off));this.updateHover();}
  togglePause(){if(this.session.room){this.toast('The shared world keeps running while anyone is online.');return;}this.paused=!this.paused;el('pause').innerHTML=icon(this.paused?'Play':'Pause');el('pause').setAttribute('aria-label',this.paused?'Resume simulation':'Pause simulation');refreshIcons();}
  toast(message:string,ms=3500){
    if(matchMedia('(max-width: 800px), (pointer: coarse)').matches)message=message.replace(/press E\b/gi,'tap Gather').replace(/Open M\b/g,'Tap Map').replace(/press C\b/gi,'tap Craft').replace('on the left','at the top');
    el('toast').textContent=message;el('toast').hidden=false;this.toastUntil=this.time+ms/1000;
  }
  private updateSoundControls(){
    const {enabled,volume}=this.audio.settings,button=el('sound');
    const audible=enabled&&volume>0;
    button.innerHTML=icon(audible?'Volume2':'VolumeX');button.setAttribute('aria-label',audible?'Mute sound':'Enable sound');button.setAttribute('aria-pressed',String(audible));button.title=audible?`Sound effects · ${Math.round(volume*100)}%`:'Sound effects muted';
    for(const id of ['intro-sound','audio-enabled']){const input=el<HTMLInputElement>(id);if(input)input.checked=enabled;}
    const preview=el<HTMLButtonElement>('audio-preview');if(preview)preview.disabled=!audible;
    if(el('audio-status'))text('audio-status',!enabled?'Sound is off. Turn on sound effects to hear a preview.':volume===0?'Volume is at 0%. Raise it to hear a preview.':'Sound is on. Use Test sound to check the volume.');
    el('audio-volume')?.setAttribute('aria-valuetext',`${Math.round(volume*100)} percent`);refreshIcons();
  }
  private updateAudio(dt:number){
    const s=this.sim.state,position=s.player,previous=this.soundPosition;this.soundPosition={...position};
    if(!this.session.connected){this.soundOwner='';this.footsteps=0;return;}
    if(this.soundOwner!==this.session.id){this.soundOwner=this.session.id;this.soundChapter=s.unlock;this.footsteps=0;return;}
    if(s.unlock>this.soundChapter&&!this.modalOpen)this.audio.play('milestone');this.soundChapter=s.unlock;
    if(!previous||this.modalOpen||this.paused||dt<=0){this.footsteps=0;return;}
    const distance=Math.hypot(position.x-previous.x,position.z-previous.z);
    if(distance<.01||distance>dt*9){this.footsteps=0;return;}
    this.footsteps+=distance;if(this.footsteps>=1.25){this.footsteps%=1.25;this.audio.play('footstep');}
  }
  private maybeShowIntro(){
    if(!this.session.connected||!this.session.id||this.modalOpen||this.introChecked.has(this.session.id))return;
    const owner=this.session.id;this.introChecked.add(owner);
    if(isNewWorkshop(this.sim.state)&&!hasSeenIntro(owner))this.showIntro();
  }
  private finishIntro(){
    if(!this.introOwner)return;rememberIntro(this.introOwner);this.introChecked.add(this.introOwner);this.introOwner=undefined;
  }
  showIntro(){
    this.openDialog(introContent(this.world.thumbnails.windmill));this.introOwner=this.session.id;
    const dialog=el<HTMLDialogElement>('dialog');dialog.classList.add('intro-dialog');dialog.setAttribute('aria-labelledby','intro-title');dialog.setAttribute('aria-describedby','intro-description');
    el('toast').hidden=true;this.toastUntil=0;this.updateSoundControls();
    el<HTMLInputElement>('intro-sound').onchange=event=>{this.audio.setEnabled((event.target as HTMLInputElement).checked);this.updateSoundControls();};
    const dismiss=(begin:boolean)=>{this.finishIntro();dialog.close();this.modalOpen=false;if(begin){this.chooseMissionBuild();void this.audio.unlock().then(()=>this.audio.play('welcome'));this.toast('Your first chapter is on the left. Follow the marker to the forest.',6000);}this.world.canvas.focus({preventScroll:true});};
    el('begin-tutorial').onclick=()=>dismiss(true);el('intro-look-around').onclick=()=>dismiss(false);
    el('begin-tutorial').focus({preventScroll:true});
  }
  openDialog(html:string){
    this.characterEditor?.dispose();this.characterEditor=undefined;
    this.leaderboardView?.dispose();this.leaderboardView=undefined;el('dialog').classList.remove('leaderboard-dialog');
    this.finishIntro();this.world.cancelConveyor();const dialog=el<HTMLDialogElement>('dialog');
    if(!dialog.open)this.dialogTrigger=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    dialog.classList.remove('intro-dialog','settings-dialog');dialog.removeAttribute('aria-labelledby');dialog.removeAttribute('aria-label');dialog.removeAttribute('aria-describedby');this.modalOpen=true;this.world.keys.clear();
    el('dialog-content').innerHTML=`<div class="dialog-toolbar"><button id="close-dialog" class="dialog-close" aria-label="Close dialog">${icon('X')}</button></div>${html}`;
    const heading=el('dialog-content').querySelector('h2');if(heading){heading.id||='dialog-title';dialog.setAttribute('aria-labelledby',heading.id);}
    if(html.includes('THE MECHANIST’S FIELD GUIDE')){
      if(matchMedia('(max-width: 800px), (pointer: coarse)').matches)heading?.insertAdjacentHTML('afterend','<p class="mobile-guide">Drag the thumb stick to walk; reach its edge to run. Tap Gather for nearby materials and Attack for enemies. Tap Build, choose a blueprint, then tap the ground to place it. Drag to draw conveyors. Rotate turns the output; Done ends building. Craft, Map, and Chat are in the bottom bar. Menu contains camera zoom, Journey, Clans, your character, and settings.</p>');
      el('dialog-content').insertAdjacentHTML('beforeend',`<details class="guide-controls"><summary>All controls & player hints</summary><dl>${PLAYER_HINTS.map(hint=>`<dt>${hint.title} · ${hint.keys}</dt><dd>${hint.copy}</dd>`).join('')}</dl></details>`);
    }
    dialog.showModal();dialog.scrollTop=0;el('close-dialog').onclick=()=>dialog.close();el('close-dialog').focus({preventScroll:true});refreshIcons();
  }
  customizeCharacter(){
    if(!this.session.connected){this.toast('Connect to the world to customize your engineer.');return;}
    this.openDialog(characterEditorContent());
    const dialog=el<HTMLDialogElement>('dialog');dialog.setAttribute('aria-labelledby','character-title');
    this.characterEditor=new CharacterEditor(dialog,this.world.assets.get('engineer')!,this.session,message=>this.toast(message));
    el('close-dialog').focus({preventScroll:true});
  }
  leaderboard(){
    this.openDialog(leaderboardContent());
    if(this.dialogTrigger===this.world.canvas||this.dialogTrigger===document.body)this.dialogTrigger=el('leaderboard');
    const dialog=el<HTMLDialogElement>('dialog');dialog.classList.add('leaderboard-dialog');dialog.setAttribute('aria-labelledby','leaderboard-title');dialog.setAttribute('aria-describedby','leaderboard-description');
    this.leaderboardView=new LeaderboardUI(el('leaderboard-view'),this.session);
    el('close-dialog').focus({preventScroll:true});
  }
  guide(){this.openDialog(`<span class="eyebrow">THE MECHANIST’S FIELD GUIDE</span><h2>Small beginnings.<br>Extraordinary possibilities.</h2><p>You start with an unbuilt workshop site and a pack of supplies. Hover over the dark-green recipe book at the bottom to reveal its building choices. Follow the tutorial on the left: it advances as you build and connect your first production lines.</p><div class="guide-steps"><div><b>01</b><section><h3>Install wood production</h3><p>Choose Lumber camp and place it on the forest site highlighted by the tutorial. Choose Windmill in Power and place it within 4 tiles of the camp. Build a sawmill nearby. Your starting supplies cover these first machines.</p></section></div><div><b>02</b><section><h3>Connect and collect</h3><p>Choose Conveyor in Logistics. Draw a path from the camp’s output to the sawmill, then from the sawmill to a storage chest. Clear any trees or rocks in the way by walking nearby and pressing E. R turns output arrows; inputs accept goods on the other three sides. Press Escape to inspect the chest, then Collect its planks for building.</p></section></div><div><b>03</b><section><h3>Bring iron into the workshop</h3><p>Place an iron mine on the iron deposit highlighted by the tutorial and connect it to a stone furnace. Power both machines. One windmill supplies 12 power, enough for your first wood and iron lines. Keep windmills at least 4 tiles apart. Gather coal and copper to discover the coal power plant: build it directly on a coal deposit for 72 power. It mines and burns 1 coal every 20 seconds. Posts automatically wire together within 5 tiles and power machines within 4.6 tiles. Produce 10 ingots to unlock the gear press, then connect the furnace to it.</p></section></div><div><b>04</b><section><h3>Build for the guild</h3><p>8 factory-made gears unlock the assembly bench and dispatch depot. Build both. Supply the bench with 2 planks and 1 gear per mechanism and connect its output to the depot. Dispatch 20 to open the steel, glass, circuit, alloy, and aether chapters. Inspect chests to expand storage from 100 to 4,000 items; upgrade production machines for 1.5× or 2× speed. Open Journey with J to follow all eight chapters.</p></section></div></div><p class="note">WASD moves; Shift runs. Short on supplies? Press E near timber or ore deposits to gather, and C to handcraft. X dismantles with full refunds, including upgrades. The final commission requires 100 dispatches, 3 minutes at 8/min and 80% assembly utilization, and beacon materials. Finish it in Journey to earn your permanent Master of Ironwood badge. Progress saves automatically. Solo production pauses while a dialog is open or the tab is hidden; shared factories keep running while a crew member is online.</p><button id="replay-intro" class="button secondary intro-replay">Revisit the introduction ${icon('ArrowRight')}</button>`);el('replay-intro').onclick=()=>this.showIntro();}
  crafting(){
    this.openDialog(`<span class="eyebrow">YOUR DISCOVERED BLUEPRINTS</span><h2>A little handiwork.</h2><p>Turn your supplies into something useful. Discover materials to reveal more blueprints.</p><div id="craft-recipes" class="craft-recipes"></div><p id="craft-feedback" role="status" class="note">${this.session.room?'Clan members share supplies and tool upgrades. Solo engineers keep their own pack.':'Gather raw materials with E. Factory-made goods unlock new chapters.'}</p>`);
    this.renderCraftRecipes();
  }
  renderCraftRecipes(){
    const focused=document.activeElement instanceof HTMLButtonElement?document.activeElement.dataset.craft:undefined;
    el('craft-recipes').innerHTML=this.known.recipes.map(k=>{const r=CRAFTS[k];return `<div><span class="craft-icon">${itemIcon(k)}</span><section><h3>${r.label}</h3><p class="craft-cost">${entries(r.cost).map(([k,n])=>`<span>${itemIcon(k)}${n} ${ITEMS[k].name.toLowerCase()}</span>`).join('')}</p><p>${r.note}</p></section><button data-craft="${k}" class="button">Craft</button></div>`;}).join('')||'<p>Gather materials to discover your first blueprint.</p>';
    document.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach(b=>b.onclick=()=>{const m=this.session.action({type:'craft',recipe:b.dataset.craft as Craft});if(m)el('craft-feedback').textContent=m;this.update(0);});
    this.updateCraftButtons();refreshIcons();
    if(focused)document.querySelector<HTMLButtonElement>(`[data-craft="${focused}"]`)?.focus({preventScroll:true});
  }
  updateCraftButtons(){for(const b of document.querySelectorAll<HTMLButtonElement>('[data-craft]')){const k=b.dataset.craft as Craft,owned=k==='pickaxe'&&(this.sim.state.inventory.pickaxe||0)>0;b.disabled=owned||!canAfford(this.sim.state.inventory,CRAFTS[k].cost)||!!(this.session.room&&!this.session.connected);b.textContent=owned?'Equipped':'Craft';}}
  updateExpedition(){
    const s=this.sim.state,p=s.player;
    const mobile=matchMedia('(max-width: 800px), (pointer: coarse)').matches;
    hidden('pause',!!this.session.room);
    const near=this.sim.gatherTarget();
    let message=tutorialStep(this.sim)?'Follow the tutorial · WASD to move · E to gather · C to craft':'Explore the frontier · M map · C craft';
    if(near)message=`${near.name} · ${near.left} ${ITEMS[near.item].name.toLowerCase()} · ${near.tier&&!(s.inventory.pickaxe||0)?'Steel pickaxe required':near.item==='log'?'E to chop':'E to mine'}`;
    else if(this.waypoint){const dx=this.waypoint.x*CELL-p.x,dz=this.waypoint.z*CELL-p.z;const a=Math.atan2(dz,dx);const direction=['E','SE','S','SW','W','NW','N','NE'][(Math.round(a/(Math.PI/4))+8)%8];message=`${this.waypoint.label} · ${Math.round(Math.hypot(dx,dz))}m ${direction} · M map`;}
    if(!this.session.connected)message=this.session.status+' · Open World to reconnect';
    if(mobile)message=message.replace('Follow the tutorial · WASD to move · E to gather · C to craft','Drag to move · Tap Build').replace('Explore the frontier · M map · C craft','Explore the frontier').replace('E to chop','Tap Gather').replace('E to mine','Tap Gather').replace('M map','Map');
    text('biome-caption',BIOMES[biomeAt(p.x/CELL,p.z/CELL)].name.toUpperCase());
    text('expedition-hint',message);
    if(this.session.room)text('save-state',this.session.saveStatus);
  }
  paintMap(canvas:HTMLCanvasElement,large:boolean){this.atlasView.paint(canvas,large);}
  atlas(){
    this.openDialog(this.atlasView.content());el<HTMLDialogElement>('dialog').setAttribute('aria-labelledby','atlas-title');this.atlasView.mount();
  }
  multiplayer(){
    this.openDialog(`<span class="eyebrow">IRONWOOD · ONE SHARED WORLD</span><h2>Your place on the frontier.</h2><p>Everyone arrives in the same world, with a separate home plot. Visit other engineers and watch their factories work. Meet within 3 tiles and choose Team up to form a clan. Accepting pools your supplies, tools, and factory progress so you can build together.</p><form id="crew-form"><label for="engineer-name">Your engineer’s name</label><input id="engineer-name" name="nickname" required maxlength="20" pattern="[a-zA-Z0-9 _-]+" placeholder="Engineer" autocomplete="nickname" aria-describedby="name-hint"/><p id="name-hint" class="note">Use letters, numbers, spaces, hyphens, or underscores.</p><button class="button" type="submit">Save name</button></form><p id="crew-feedback" class="note" role="status"></p><div class="settings-list"><button id="home-waypoint" class="button secondary">Find my base</button><button id="copy-invite" class="button secondary">Copy world link</button><button id="world-reconnect" class="button secondary">Reconnect</button></div><h3>Engineers online</h3><div id="world-engineers" class="world-engineers"></div><p class="note">Your base is saved by the world server. This browser remembers your engineer; clearing browser storage or using a different device creates a new identity. One active tab per engineer. Factories run while anyone is online.</p>`);
    el<HTMLInputElement>('engineer-name').value=this.session.players.find(p=>p.id===this.session.id)?.name||'';
    if(this.session.xProfile){el<HTMLInputElement>('engineer-name').disabled=true;el<HTMLButtonElement>('crew-form').querySelector<HTMLButtonElement>('button')!.disabled=true;text('name-hint','Your name comes from your X profile.');}
    el<HTMLInputElement>('engineer-name').pattern='[a-zA-Z0-9 _\\-]+';
    const accountButton=document.createElement('button');accountButton.className='button secondary';accountButton.textContent=this.session.xProfile?'Your X account':'Log in with X to save progress';accountButton.onclick=()=>this.account(()=>this.multiplayer());el('crew-form').after(accountButton);
    el('dialog-content').lastElementChild!.textContent='Log in with X to keep your base across browsers and devices. Guests can keep playing in this browser. One active tab per engineer; factories run while anyone is online.';
    text('crew-feedback',this.session.status);
    el<HTMLFormElement>('crew-form').onsubmit=e=>{e.preventDefault();if(!this.session.connected){text('crew-feedback','Reconnect before saving your name.');return;}this.session.rename(el<HTMLInputElement>('engineer-name').value);};
    el('home-waypoint').onclick=()=>{const b=this.sim.state.base;if(b){this.waypoint={...b,label:'My base'};this.renderedMap='';el<HTMLDialogElement>('dialog').close();this.toast('Follow the compass to your home plot.');}};
    el('world-reconnect').onclick=()=>this.session.start();
    el('copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin);text('crew-feedback','World link copied. Friends receive their own home plot.');}catch{text('crew-feedback','Share '+location.origin+' to invite another engineer.');}};
    for(const p of this.session.players){
      const b=document.createElement('button');b.textContent=p.name+(p.id===this.session.id?' · You':'');const small=document.createElement('small');small.textContent=`Base ${p.base.x} : ${p.base.z} · Set waypoint`;b.append(small);b.onclick=()=>{this.waypoint={...p.base,label:p.id===this.session.id?'My base':p.name+'’s base'};this.renderedMap='';el<HTMLDialogElement>('dialog').close();};el('world-engineers').append(b);
    }
  }
  save(manual=false){if(this.session.room){text('save-state',this.session.saveStatus);if(manual)this.toast(!this.session.connected?'Reconnect to the world to continue saving.':this.session.xProfile?'Your workshop saves automatically to your X account.':'Your guest workshop is on the server. Log in with X to keep it across browsers and devices.');return this.session.connected;}try{localStorage.setItem(SAVE_KEY,this.sim.serialize());el('save-state').innerHTML=`${icon('Check')} Saved ${clock(this.sim.state.time)}`;refreshIcons();if(manual)this.toast('Your workshop is saved.');return true;}catch{this.toast('Could not save in this browser. Export a save from settings.');return false;}}
  account(back?:()=>void){
    const profile=this.session.xProfile;
    this.openDialog(`<span class="eyebrow">YOUR ENGINEER</span><h2>${profile?'A familiar face on the frontier.':'Make this place yours.'}</h2><div id="account-identity" class="account-identity"></div><p>${profile?'Your base, supplies, and discoveries save automatically. Log in with the same X account to pick up on another device.':'Log in with X to keep your base, supplies, and discoveries. Your X photo, name, verification, and organisation badge appear above your engineer when available.'}</p><p class="note">${profile?'Logging out keeps your saved workshop. You’ll continue as a new guest.':'Your current guest progress will be linked on your first login. If you already have a saved workshop, we’ll take you back to it.'}</p><div id="account-actions" class="account-actions"><button id="account-action" class="button">${profile?'Log out':xLogo+' Continue with X'}</button></div><p id="account-feedback" class="note" role="status"></p>`);
    el<HTMLDialogElement>('dialog').setAttribute('aria-label','X account');
    el('dialog').removeAttribute('aria-labelledby');
    if(back){const button=document.createElement('button');button.type='button';button.className='dialog-back';button.textContent='← Back';button.onclick=back;el('dialog-content').querySelector('.dialog-toolbar')!.append(button);}
    if(profile){
      const handle=document.createElement('small');handle.textContent='@'+profile.username;el('account-identity').append(profileChip(profile),handle);
      const link=document.createElement('a');link.className='button secondary';link.href='https://x.com/'+encodeURIComponent(profile.username);link.target='_blank';link.rel='noopener noreferrer';link.textContent='View X profile';el('account-actions').append(link);
    }
    const button=el<HTMLButtonElement>('account-action');button.disabled=this.session.authBusy;
    button.onclick=async()=>{
      button.disabled=true;button.textContent=profile?'Logging out…':'Opening X…';
      const message=await (profile?this.session.logout():this.session.login());
      if(!button.isConnected)return;
      if(message){text('account-feedback',message);button.disabled=false;button.textContent=profile?'Log out':'Continue with X';}
      else if(profile){el<HTMLDialogElement>('dialog').close();this.toast('Logged out. Your X workshop is saved.');}
    };
  }
  applyGraphics(){document.documentElement.dataset.graphics=this.world.graphics.quality;hidden('fps-counter',!this.world.graphics.showFps);}
  updateFps(fps:number){if(this.world.graphics.showFps)text('fps-counter',`${Math.round(fps)} FPS`);}
  settings(){
    this.openDialog(`<section class="settings-view">
      <span class="eyebrow">MAKE YOURSELF AT HOME</span><h2 id="settings-title">Settings</h2>
      <p class="settings-intro">Changes apply immediately and are remembered in this browser. The shared world keeps running.</p>
      <section class="settings-section graphics-settings" aria-labelledby="graphics-heading">
        <h3 id="graphics-heading">${icon('PanelsTopLeft')} Graphics</h3>
        <div class="setting-row"><label for="graphics-quality">Quality</label><select id="graphics-quality" aria-describedby="graphics-description"><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="quality">Quality</option></select></div>
        <p id="graphics-description" class="setting-help"></p>
        <label class="setting-toggle"><span><span id="fps-label">Show FPS counter</span><small id="fps-help">See how smoothly the game is running.</small></span><input id="show-fps" type="checkbox" aria-labelledby="fps-label" aria-describedby="fps-help"/></label>
      </section>
      <section class="settings-section audio-settings" aria-labelledby="audio-heading">
        <h3 id="audio-heading">${icon('Volume2')} Audio</h3>
        <label class="setting-toggle"><span><span id="sound-label">Sound effects</span><small id="sound-help">Workshop sounds, footsteps, and discoveries.</small></span><input id="audio-enabled" type="checkbox" aria-labelledby="sound-label" aria-describedby="sound-help"/></label>
        <div class="setting-volume"><label for="audio-volume">Volume</label><output id="audio-volume-value" for="audio-volume"></output><input id="audio-volume" type="range" min="0" max="100" step="5" aria-describedby="audio-status"/><button id="audio-preview" class="button secondary" aria-describedby="audio-status">Test sound</button></div>
        <p id="audio-status" class="setting-help" role="status"></p>
      </section>
      <section class="settings-section hint-settings" aria-labelledby="hints-heading">
        <h3 id="hints-heading">${icon('CircleHelp')} Player hints</h3>
        <label class="setting-toggle"><span><span id="hints-label">Show contextual hints</span><small id="hints-help">One hint at a time, while you play.</small></span><input id="show-hints" type="checkbox" aria-labelledby="hints-label" aria-describedby="hints-help"/></label>
        <button id="reset-hints" class="button secondary">Replay hints</button><p id="hints-feedback" class="setting-help" role="status"></p>
      </section>
      <section class="settings-section" aria-labelledby="saving-heading">
        <h3 id="saving-heading">${icon('Save')} Account & saving</h3>
        <p id="settings-account-copy" class="setting-help">${this.session.xProfile?'Your workshop saves to your X account. Use the same account to play on another device.':'Playing as a guest. Log in with X to keep your workshop across browsers and devices.'}</p>
        <button id="settings-account" class="button">${this.session.xProfile?'Your X account':xLogo+' Log in with X to save progress'}</button>
        <div class="settings-list"><button id="manual-save" class="button secondary">Check save status</button><button id="export-save" class="button secondary">${icon('Download')} Export snapshot</button></div>
        <p id="settings-save-feedback" class="setting-help" role="status"></p>
        <p class="setting-help">Snapshots are for viewing your workshop data. They can’t be imported to restore progress.</p>
      </section>
      <button id="settings-done" class="button settings-done">Done</button>
    </section>`);
    el('dialog').classList.add('settings-dialog');
    const quality=el<HTMLSelectElement>('graphics-quality'),counter=el<HTMLInputElement>('show-fps');quality.value=this.world.graphics.quality;counter.checked=this.world.graphics.showFps;
    const describeQuality=()=>text('graphics-description',({performance:'Smoother play with lighter detail. Best for slower devices.',balanced:'A balance of smooth play and detail. Recommended for most devices.',quality:'Sharper detail and shadows. Uses more graphics power.'})[quality.value as GraphicsQuality]);describeQuality();
    const hints=el<HTMLInputElement>('show-hints');hints.checked=this.hints.schedule.enabled;
    hints.onchange=()=>this.hints.schedule.setEnabled(hints.checked);
    el('reset-hints').onclick=()=>{this.hints.schedule.reset();hints.checked=true;text('hints-feedback','Hints will appear again when you return to the world.');};
    const volume=el<HTMLInputElement>('audio-volume');volume.value=String(Math.round(this.audio.settings.volume*100));text('audio-volume-value',`${volume.value}%`);this.updateSoundControls();
    el<HTMLInputElement>('audio-enabled').onchange=event=>{this.audio.setEnabled((event.target as HTMLInputElement).checked);this.updateSoundControls();};
    volume.oninput=()=>{this.audio.setVolume(Number(volume.value)/100);text('audio-volume-value',`${volume.value}%`);this.updateSoundControls();};
    el('audio-preview').onclick=()=>{void this.audio.unlock().then(()=>this.audio.play('wood'));};
    quality.onchange=counter.onchange=()=>{this.world.setGraphics({quality:quality.value as GraphicsQuality,showFps:counter.checked});this.applyGraphics();describeQuality();};
    el('manual-save').onclick=()=>{const saved=this.save();text('settings-save-feedback',this.session.room?(saved?(this.session.xProfile?'Connected. Your workshop saves automatically to your X account.':'Connected. Your guest workshop saves automatically. Log in with X to keep it across devices.'):'Disconnected. Open World and reconnect to continue saving.'):(saved?'Your workshop is saved in this browser.':'Could not save in this browser.'));};
    el('settings-account').onclick=()=>this.account(()=>this.settings());
    el('settings-done').onclick=()=>el<HTMLDialogElement>('dialog').close();
    el('export-save').onclick=()=>{const url=URL.createObjectURL(new Blob([this.sim.serialize()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ironwood-snapshot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);text('settings-save-feedback','Snapshot downloaded. Your workshop continues to save automatically.');};
  }
  journey(){
    this.openDialog(`<span class="eyebrow">THE MECHANIST’S GUILD · JOURNEY BOOK</span><h2 id="journey-title">Small beginnings.<br>A lasting legacy.</h2><p>Eight chapters, a growing workshop, and a place in the guild. Each chapter brings new tools and a badge to keep.</p><div id="journey-chapters"></div><section class="journey-upgrades"><h3>Make room for bigger ideas.</h3><p>Inspect a chest or production machine to upgrade it. Contents stay put; dismantling returns your upgrade materials.</p><div class="chest-ladder">${CHESTS.map((chest,i)=>`<div><span class="chest-glyph chest-glyph-${i}">${icon('PackageOpen')}</span><strong>${chest.capacity.toLocaleString('en-US')}</strong><small>${chest.name}</small></div>`).join('')}</div><p>Precision drives run machines at 1.5× speed. Aether drives reach 2×, with the same power demand. Power and inputs still matter.</p></section><p id="journey-feedback" class="note" role="status"></p>`);
    el<HTMLDialogElement>('dialog').setAttribute('aria-labelledby','journey-title');this.journeyRender='';this.renderJourney();
  }
  renderJourney(){
    const s=this.sim.state,key=JSON.stringify([s.unlock,s.won,s.campaign,chapterObjectives(s),this.session.connected]);if(key===this.journeyRender)return;this.journeyRender=key;
    const focus=el('journey-chapters').contains(document.activeElement)?document.activeElement?.id:undefined;
    el('journey-chapters').innerHTML=`<div class="journey-summary"><strong>${s.won?8:s.unlock} / 8 chapters complete</strong><span>${s.campaign.badges.length} badges earned</span></div><ol class="chapter-list">${CHAPTERS.map((chapter,i)=>{
      const done=i<s.unlock||s.won,current=i===s.unlock&&!s.won;
      return `<li class="${done?'chapter-done':current?'chapter-current':'chapter-locked'}" ${current?'aria-current="step"':''}><span class="chapter-number">${done?icon('Check'):String(i+1).padStart(2,'0')}</span><section><div class="chapter-heading"><h3>${chapter.title}</h3><span>${done?'Complete':current?'In progress':'Upcoming'}</span></div>${current?`<p>${chapter.copy}</p><ul class="chapter-goals">${chapterObjectives(s).map(goal=>`<li><span>${goal.text}</span><b>${Math.min(goal.n,goal.max)} / ${goal.max}</b></li>`).join('')}</ul>`:''}<p class="chapter-reward">${done?`Badge earned: ${chapter.badge}`:chapter.reward}</p></section></li>`;
    }).join('')}</ol>${s.won?`<button id="revisit-ending" class="button">${icon('Award')} View completion badge</button>`:s.unlock===7?`<section class="beacon-commission"><h3>The final commission</h3><p>Contribute ${entries(BEACON_COST).map(([k,n])=>`${n} ${ITEMS[k].name.toLowerCase()}`).join(', ')} from your supplies to light the guild beacon. These materials will be used.</p><button id="light-beacon" class="button" ${canComplete(s)&&this.session.connected?'':'disabled'}>${icon('Zap')} Light the beacon</button></section>`:''}`;
    if(focus)el(focus)?.focus({preventScroll:true});
    const finish=el<HTMLButtonElement>('light-beacon');if(finish)finish.onclick=()=>{this.pendingCommission=true;finish.disabled=true;const message=this.session.action({type:'commission'});if(message){this.pendingCommission=false;text('journey-feedback',message);}};
    const revisit=el('revisit-ending');if(revisit)revisit.onclick=()=>this.showWin();refreshIcons();
  }
  showWin(){
    const s=this.sim.state;this.endingOpen=true;
    this.openDialog(`<section class="ending"><span class="eyebrow">THE FINAL CHAPTER · COMPLETE</span><div class="completion-seal">${icon('Award')}<span>VIII</span></div><p class="ending-overline">THE MECHANIST’S GUILD CERTIFIES</p><h2 id="ending-title">Master of<br>Ironwood.</h2><p class="ending-story">The last core settles into place. Across the frontier, the guild beacon comes alive.</p><p>You arrived with a pack of timber and an idea. Now your work lights the way for every engineer who follows. The guild’s commission is complete.</p><div class="completion-ribbon">${icon('Check')} All 8 chapters completed · Permanent badge earned</div><div class="win-stats"><div><b>8 / 8</b><span>chapters complete</span></div><div><b>${s.delivered}</b><span>mechanisms dispatched</span></div><div><b>${s.campaign.badges.length}</b><span>badges earned</span></div></div><div class="ending-actions"><button id="keep-building" class="button">Keep building ${icon('ArrowRight')}</button><button id="download-badge" class="button secondary">${icon('Download')} Save certificate</button></div><p class="ending-footnote">Your badge stays in the Journey book. Your workshop and the frontier remain open.</p></section>`);
    el<HTMLDialogElement>('dialog').setAttribute('aria-labelledby','ending-title');
    el('keep-building').onclick=()=>el<HTMLDialogElement>('dialog').close();
    el('download-badge').onclick=()=>{
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="#f3efdf"/><rect x="28" y="28" width="904" height="584" rx="8" fill="none" stroke="#b29a64"/><rect x="38" y="38" width="884" height="564" rx="4" fill="none" stroke="#b29a64" opacity=".4"/><g fill="#344d3c" text-anchor="middle"><text x="480" y="92" font-family="sans-serif" font-size="15" letter-spacing="5">THE MECHANIST’S GUILD</text><circle cx="480" cy="186" r="58" fill="none" stroke="#b29a64" stroke-width="2"/><circle cx="480" cy="186" r="48" fill="none" stroke="#b29a64"/><text x="480" y="202" font-family="Georgia,serif" font-size="42" fill="#98793d">VIII</text><text x="480" y="294" font-family="Georgia,serif" font-size="25">This certifies completion of</text><text x="480" y="368" font-family="Georgia,serif" font-size="70">IRONWOOD</text><text x="480" y="425" font-family="Georgia,serif" font-size="32">Master of Ironwood</text><text x="480" y="476" font-family="sans-serif" font-size="16">All eight chapters complete. The guild beacon is lit.</text><text x="480" y="552" font-family="sans-serif" font-size="13" letter-spacing="3">SMALL BEGINNINGS. A LASTING LEGACY.</text></g></svg>`;
      const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),link=document.createElement('a');link.href=url;link.download='ironwood-master-certificate.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    this.audio.play('milestone');
  }
}
