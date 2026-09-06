import {createElement,Factory,Wrench,Map,MessageCircle,Menu,X,Award,Trophy,Users,Handshake,Shirt,Settings2,Volume2,CircleHelp,Zap,LocateFixed,Minus,RotateCw,Plus,Move,Pickaxe} from 'lucide';
import type {World} from './world';
import type {UI} from './ui';
import type {GameSession} from './session';

export const COMPACT_CONTROLS='(max-width: 800px), (pointer: coarse)';
const icons={Factory,Wrench,Map,MessageCircle,Menu,X,Award,Trophy,Users,Handshake,Shirt,Settings2,Volume2,CircleHelp,Zap,LocateFixed,Minus,RotateCw,Plus,Move,Pickaxe};

/** A circular dead zone prevents drift; the outer edge runs at full speed. */
export function joystickVector(dx:number,dy:number,radius:number){
  const distance=Math.hypot(dx,dy),amount=Math.min(1,distance/radius);
  if(amount<.15)return {x:0,z:0,run:false};
  const speed=(amount-.15)/.85;
  return {x:dx/distance*speed,z:dy/distance*speed,run:amount>.9};
}

export class MobileControls {
  private root=document.getElementById('ui')!;
  private media=matchMedia(COMPACT_CONTROLS);
  private pad:HTMLButtonElement;
  private stick:HTMLElement;
  private pointer?:number;
  private menu:HTMLElement;
  private buildButton:HTMLButtonElement;
  private menuButton:HTMLButtonElement;
  private buildActions:HTMLElement;
  private sheet:'build'|'menu'|null=null;
  constructor(private world:World,private ui:UI,private session:GameSession){
    const icon=(name:keyof typeof icons)=>{const svg=createElement(icons[name]);svg.setAttribute('aria-hidden','true');return svg.outerHTML;};
    this.root.insertAdjacentHTML('beforeend',`
      <nav class="mobile-bar panel" aria-label="Game shortcuts">
        <button id="mobile-build" aria-expanded="false" aria-controls="mobile-blueprints">${icon('Factory')}<span>Build</span></button>
        <button data-mobile-control="craft">${icon('Wrench')}<span>Craft</span></button>
        <button data-mobile-control="atlas">${icon('Map')}<span>Map</span></button>
        <button id="mobile-chat" aria-expanded="false" aria-controls="chat-panel">${icon('MessageCircle')}<span>Chat</span><b id="mobile-unread" hidden></b></button>
        <button id="mobile-menu-toggle" aria-expanded="false" aria-controls="mobile-menu">${icon('Menu')}<span>Menu</span><b id="mobile-invites" hidden></b></button>
      </nav>
      <section id="mobile-menu" class="mobile-menu panel" aria-label="Game menu" hidden>
        <header><strong>Explore & settings</strong><button id="mobile-menu-close" aria-label="Close game menu">${icon('X')}</button></header>
        <div class="mobile-menu-grid">
          ${([['journey','Award','Journey'],['leaderboard','Trophy','Leaderboard'],['coop','Users','World'],['clan-toggle','Handshake','Clan'],['customize-character','Shirt','Character'],['settings','Settings2','Settings'],['sound','Volume2','Sound'],['help','CircleHelp','Field guide'],['power-view','Zap','Power network'],['recenter','LocateFixed','Recenter']] as const).map(([id,glyph,label])=>`<button data-mobile-control="${id}">${icon(glyph)}<span>${label}</span></button>`).join('')}
        </div>
        <div class="mobile-camera" aria-label="Camera controls"><button id="mobile-zoom-out" aria-label="Zoom camera out">${icon('Minus')}</button><button data-mobile-control="rotate-camera" aria-label="Rotate camera">${icon('RotateCw')}<span>View</span></button><button id="mobile-zoom-in" aria-label="Zoom camera in">${icon('Plus')}</button></div>
      </section>
      <div class="mobile-movement">
        <button id="mobile-joystick" aria-label="Move engineer. Drag to walk; drag to the edge to run."><span class="joystick-cross" aria-hidden="true"></span><span class="joystick-thumb" aria-hidden="true">${icon('Move')}</span></button>
        <span>DRAG TO MOVE · EDGE TO RUN</span>
      </div>
      <button id="mobile-gather" class="mobile-gather panel">${icon('Pickaxe')}<span>Gather</span></button>
      <div id="mobile-build-actions" class="mobile-build-actions panel" aria-label="Building controls" hidden><button id="mobile-rotate">${icon('RotateCw')}<span>Rotate</span></button><button id="mobile-cancel">${icon('X')}<span>Done</span></button></div>
    `);
    this.pad=document.getElementById('mobile-joystick') as HTMLButtonElement;
    this.stick=this.pad.querySelector('.joystick-thumb')!;
    this.menu=document.getElementById('mobile-menu')!;
    this.buildButton=document.getElementById('mobile-build') as HTMLButtonElement;
    this.menuButton=document.getElementById('mobile-menu-toggle') as HTMLButtonElement;
    this.buildActions=document.getElementById('mobile-build-actions')!;
    this.root.querySelector('.build-dock')!.id='mobile-blueprints';
    this.buildButton.onclick=()=>this.openSheet(this.sheet==='build'?null:'build');
    this.menuButton.onclick=()=>this.openSheet(this.sheet==='menu'?null:'menu');
    document.getElementById('mobile-menu-close')!.onclick=()=>{this.openSheet(null);this.menuButton.focus({preventScroll:true});};
    this.root.querySelectorAll<HTMLButtonElement>('[data-mobile-control]').forEach(button=>button.onclick=()=>{
      this.openSheet(null);this.ui.setChatOpen(false);
      document.getElementById(button.dataset.mobileControl!)?.click();
    });
    document.getElementById('mobile-chat')!.onclick=()=>{this.openSheet(null);this.ui.setChatOpen(!this.ui.chatOpen);};
    document.getElementById('mobile-gather')!.onclick=()=>{
      if(this.ui.modalOpen||!this.session.connected||this.world.sim.state.combat?.health===0)return;
      const message=this.session.action({type:'gather'});if(message)this.ui.toast(message);
    };
    document.getElementById('mobile-rotate')!.onclick=()=>{this.world.rotateBuild();this.ui.updateHover();};
    document.getElementById('mobile-cancel')!.onclick=()=>{this.ui.cancel();this.world.canvas.focus({preventScroll:true});};
    document.getElementById('mobile-zoom-in')!.onclick=()=>this.world.targetZoom=Math.max(15,this.world.targetZoom-5);
    document.getElementById('mobile-zoom-out')!.onclick=()=>this.world.targetZoom=Math.min(47,this.world.targetZoom+5);
    this.root.addEventListener('click',event=>{
      if(!this.media.matches)return;
      const button=(event.target as Element).closest('button');
      if(button?.matches('[data-build],#inspect-tool,#dismantle,#mission-action,#begin-tutorial')){
        this.openSheet(null);
        if(!document.getElementById('mission-details')!.hidden)document.getElementById('mission-toggle')!.click();
      }
    });
    // Secondary fingers do not reliably generate clicks while a joystick is held.
    // Trigger game actions on touch-down and suppress the later synthetic click.
    this.root.addEventListener('pointerdown',event=>{
      const button=(event.target as Element).closest<HTMLButtonElement>('#mobile-gather,#combat-attack');
      if(event.pointerType==='touch'&&button){event.preventDefault();button.click();}
    });
    this.root.addEventListener('click',event=>{
      if(event instanceof PointerEvent&&event.pointerType==='touch'&&(event.target as Element).closest('#mobile-gather,#combat-attack'))event.stopImmediatePropagation();
    },true);
    this.pad.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.pointer!==undefined||this.blocked())return;
      event.preventDefault();this.pointer=event.pointerId;this.pad.setPointerCapture(event.pointerId);this.move(event);
    });
    this.pad.addEventListener('pointermove',event=>{if(event.pointerId===this.pointer)this.move(event);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])this.pad.addEventListener(type,event=>{if((event as PointerEvent).pointerId===this.pointer)this.reset();});
    window.addEventListener('blur',()=>this.reset());
    document.addEventListener('visibilitychange',()=>this.reset());
    document.addEventListener('focusin',event=>{if((event.target as Element).closest('input,textarea,select,dialog'))this.reset();});
    window.addEventListener('resize',()=>this.reset());
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.sheet){this.openSheet(null);this.menuButton.focus({preventScroll:true});}});
    this.world.canvas.addEventListener('pointerdown',event=>{
      if(this.media.matches&&this.sheet){this.openSheet(null);event.preventDefault();event.stopImmediatePropagation();}
    },true);
    const adapt=()=>{
      this.reset();this.openSheet(null);this.root.classList.toggle('mobile-controls',this.media.matches);
      this.root.querySelector('.build-dock')!.setAttribute('aria-label',this.media.matches?'Recipe book':'Recipe book. Hover or focus to open.');
    };
    this.media.addEventListener('change',adapt);adapt();
    // Follow the visible viewport when a phone keyboard covers part of the page.
    const viewport=window.visualViewport;
    const fit=()=>{
      this.root.style.setProperty('--visible-height',`${viewport?.height??innerHeight}px`);
      this.root.style.setProperty('--visible-top',`${viewport?.offsetTop??0}px`);
    };
    viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit);fit();
  }
  private move(event:PointerEvent){
    const r=this.pad.getBoundingClientRect(),dx=event.clientX-r.x-r.width/2,dy=event.clientY-r.y-r.height/2,radius=r.width*.34;
    this.world.touchMove=joystickVector(dx,dy,radius);
    const factor=Math.min(1,radius/Math.max(1,Math.hypot(dx,dy)));
    this.stick.style.transform=`translate(${dx*factor}px,${dy*factor}px)`;
    this.pad.classList.add('is-moving');
  }
  private reset(){
    if(this.pointer===undefined&&!this.world.touchMove.x&&!this.world.touchMove.z)return;
    const pointer=this.pointer;this.pointer=undefined;this.world.touchMove={x:0,z:0,run:false};
    if(pointer!==undefined&&this.pad.hasPointerCapture(pointer))this.pad.releasePointerCapture(pointer);
    this.stick.style.transform='';this.pad.classList.remove('is-moving');
  }
  private openSheet(sheet:'build'|'menu'|null){
    this.reset();this.sheet=sheet;
    if(sheet){this.ui.setChatOpen(false);document.getElementById('inspector')!.hidden=true;this.ui.selectedId=null;this.world.highlightBuilding(null);}
    this.root.classList.toggle('mobile-building',sheet==='build');
    this.root.classList.toggle('mobile-menu-open',sheet==='menu');
    this.menu.hidden=sheet!=='menu';
    this.buildButton.setAttribute('aria-expanded',String(sheet==='build'));
    this.menuButton.setAttribute('aria-expanded',String(sheet==='menu'));
  }
  private blocked(){
    return !this.media.matches||this.ui.modalOpen||this.ui.paused||this.ui.chatOpen||!!this.sheet||document.hidden||!this.session.connected||this.world.sim.state.combat?.health===0
      ||!document.getElementById('inspector')!.hidden||!document.getElementById('mission-details')!.hidden||!!this.root.querySelector('.clan-panel:not([hidden])');
  }
  update(){
    if(this.blocked())this.reset();
    if(!this.media.matches)return;
    if(this.ui.modalOpen&&this.sheet)this.openSheet(null);
    this.buildActions.hidden=this.world.mode==='inspect'&&!this.world.selectedKind;
    document.getElementById('mobile-rotate')!.hidden=this.world.mode==='dismantle';
    const chat=document.getElementById('mobile-chat')!;
    chat.setAttribute('aria-expanded',String(this.ui.chatOpen));
    const badge=document.getElementById('mobile-unread')!,unread=this.ui.unreadChat;
    badge.hidden=!unread;badge.textContent=String(Math.min(unread,99));
    const invites=this.session.invites.filter(invite=>invite.toId===this.session.id).length;
    const inviteBadge=document.getElementById('mobile-invites')!;inviteBadge.hidden=!invites;inviteBadge.textContent=String(invites);
    this.root.querySelector('[data-mobile-control="clan-toggle"] span')!.textContent=invites?`Clan (${invites} invites)`:'Clan';
  }
}
