import type {World} from './world';
import type {GameSession} from './session';
import type {UI} from './ui';
import {CombatView} from './combat-view';
import {MAX_HEALTH,WEAPONS,MOB_TYPES,bestWeapon,type CombatEvent,type CombatTarget,type Weapon} from './combat-data';
import './combat.css';
import {itemIcon} from './item-icons';

export class CombatUI {
  view:CombatView;
  private panel=document.createElement('section');
  private death=document.createElement('section');
  private layer=document.createElement('div');
  private health:HTMLMeterElement;private value:HTMLElement;private weaponName:HTMLElement;private attack:HTMLButtonElement;private status:HTMLElement;private countdown:HTMLElement;
  private lastHealth=MAX_HEALTH;private dead=false;private hudClock=0;
  private weaponArt=document.createElement('span');private shownWeapon?:Weapon;
  private labels=new Map<string,HTMLElement>();
  private damage:{node:HTMLElement;x:number;z:number;left:number}[]=[];
  constructor(private world:World,private session:GameSession,private ui:UI){
    this.view=new CombatView(world);world.onRender=dt=>{this.view.update(dt);this.update(dt);};session.onCombat=event=>this.hit(event);
    this.panel.className='combat-hud panel';this.panel.setAttribute('aria-label','Health and weapons');
    this.panel.innerHTML=`<div class="combat-health"><label class="sr-only" for="player-health">Health</label><span aria-hidden="true">♥</span><meter id="player-health" min="0" max="100" value="100" low="30" high="65" optimum="100">100 health</meter><span id="health-value">100 / 100</span></div><div class="combat-loadout"><span id="combat-weapon" aria-label="Equipped weapon" title="Your best weapon equips automatically">Fists</span><button id="combat-attack" title="Swing your weapon · K">Attack <kbd>K</kbd></button></div><p id="combat-status" role="status" hidden></p>`;
    this.death.className='combat-death';this.death.hidden=true;this.death.setAttribute('role','status');this.death.setAttribute('aria-live','polite');
    this.death.innerHTML='<div><span>YOUR JOURNEY CONTINUES</span><h2>You fell in battle.</h2><p id="respawn-countdown"></p><small>Your supplies and workshop stay with you.</small></div>';
    this.layer.className='combat-labels';this.layer.setAttribute('aria-hidden','true');document.getElementById('ui')!.append(this.panel,this.layer,this.death);
    this.health=this.panel.querySelector('meter')!;this.value=this.panel.querySelector('#health-value')!;this.weaponName=this.panel.querySelector('#combat-weapon')!;this.attack=this.panel.querySelector('button')!;this.status=this.panel.querySelector('p')!;this.countdown=this.death.querySelector('p')!;
    this.weaponArt.className='combat-weapon-art';this.weaponArt.hidden=true;
    this.weaponName.before(this.weaponArt);
    this.attack.onclick=()=>{this.strike();world.canvas.focus();};
    this.panel.addEventListener('keydown',event=>event.stopPropagation());
    window.addEventListener('keydown',event=>{
      if(this.dead&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();return;}
      if(event.code!=='KeyK'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||(event.target as HTMLElement)?.closest('input,textarea,select,button,dialog,[contenteditable="true"]'))return;
      event.preventDefault();this.strike();
    },true);
    world.canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||document.querySelector('dialog[open]')||world.mode!=='inspect'||world.selectedKind)return;
      const target=this.view.pick(event.clientX,event.clientY);if(!target)return;
      event.preventDefault();event.stopImmediatePropagation();world.canvas.focus();this.strike(target);
    },true);
    world.canvas.addEventListener('pointermove',event=>{
      const target=world.mode==='inspect'&&!world.selectedKind&&this.view.pick(event.clientX,event.clientY);
      world.canvas.style.cursor=target?'crosshair':'';
      if(target){world.hoverResource=undefined;document.getElementById('world-label')!.hidden=true;}
    });
  }
  private strike(target?:CombatTarget){
    if(document.querySelector('dialog[open]')||this.dead||!this.session.connected)return;
    const s=this.world.sim.state,range=WEAPONS[bestWeapon(s.inventory)].range;
    if(!target){
      const candidates=[...(s.mobs??[]).filter(m=>m.health>0).map(m=>({...m,kind:'mob' as const})),...this.session.players.filter(p=>p.id!==this.session.id&&!s.clanMembers?.includes(p.id)&&p.combat?.health!==0&&(p.combat?.protectedUntil??0)<=s.time).map(p=>({...p,kind:'player' as const}))];
      const nearest=candidates.filter(p=>Math.hypot(p.x-s.player.x,p.z-s.player.z)<=range).sort((a,b)=>Math.hypot(a.x-s.player.x,a.z-s.player.z)-Math.hypot(b.x-s.player.x,b.z-s.player.z))[0];
      if(nearest)target={kind:nearest.kind,id:nearest.id};
    }
    const enemy=target?.kind==='mob'?s.mobs?.find(m=>m.id===target.id):this.session.players.find(p=>p.id===target?.id);
    const angle=enemy?Math.atan2(enemy.x-s.player.x,enemy.z-s.player.z):this.world.player.rotation.y;
    // Swing immediately, including during recovery. The server still decides damage.
    this.view.swing(this.world.ownId,s.player.x,s.player.z,angle);
    const message=this.session.action({type:'attack',target,angle});if(message)this.ui.toast(message);
  }
  private hit(event:CombatEvent){
    this.view.hit(event);
    if(!event.target||event.damage<=0)return;
    if(Math.hypot(event.x-this.world.sim.state.player.x,event.z-this.world.sim.state.player.z)<60){
      const node=document.createElement('span');node.className='combat-damage';node.textContent=`−${Math.ceil(event.damage)}`;this.layer.append(node);this.damage.push({node,x:event.x,z:event.z,left:.85});
    }
    if(event.target.kind==='player'&&event.target.id===this.session.id){this.panel.classList.remove('combat-hurt');void this.panel.offsetWidth;this.panel.classList.add('combat-hurt');}
    if(event.killed&&event.attacker.kind==='player'&&event.attacker.id===this.session.id&&event.target.kind==='player')this.ui.toast('Engineer defeated. They will respawn at their base.');
  }
  private update(dt:number){
    const s=this.world.sim.state,c=s.combat,dead=c?.health===0;
    if(dead!==this.dead){
      this.dead=dead;this.death.hidden=!dead;this.world.keys.clear();this.world.cancelConveyor();
      if(dead){(document.activeElement as HTMLElement)?.blur();document.querySelector<HTMLDialogElement>('dialog[open]')?.close();this.ui.cancel();}
    }
    this.hudClock+=dt;
    if(this.hudClock>=.1){
      this.hudClock=0;const health=Math.ceil(c?.health??MAX_HEALTH);this.health.value=health;
      if(this.lastHealth!==health||this.value.textContent!==`${health} / ${MAX_HEALTH}`){this.value.textContent=`${health} / ${MAX_HEALTH}`;this.health.textContent=`${health} health`;this.lastHealth=health;}
      this.panel.classList.toggle('combat-low',health<=30);
      const equipped=bestWeapon(s.inventory);
      if(equipped!==this.shownWeapon){this.shownWeapon=equipped;this.weaponName.textContent=WEAPONS[equipped].name;this.weaponArt.hidden=equipped==='fists';this.weaponArt.innerHTML=equipped==='fists'?'':itemIcon(equipped);}
      const waiting=(c?.attackReady??0)>s.time;this.attack.disabled=dead||!this.session.connected;
      this.attack.title=waiting?'Swing · Damage recovers between attacks':`${WEAPONS[equipped].damage} damage · Swing or attack a nearby enemy · K`;
      const status=(c?.protectedUntil??0)>s.time?`Protected for ${Math.ceil(c!.protectedUntil-s.time)}s · Attacking ends protection`:'';
      this.status.hidden=!status;
      if(this.status.textContent!==status)this.status.textContent=status;
      if(dead){const message=`Respawning at your base in ${Math.max(1,Math.ceil(c!.respawnAt-s.time))}…`;if(this.countdown.textContent!==message)this.countdown.textContent=message;}
    }
    const visible=new Set<string>();
    for(const mob of s.mobs??[]){
      const root=this.view.mobs.get(mob.id);if(!root)continue;visible.add(mob.id);
      let label=this.labels.get(mob.id);if(!label){label=document.createElement('span');label.className='combat-mob-name';label.dataset.mob=mob.id;label.textContent=MOB_TYPES[mob.kind].name;this.layer.append(label);this.labels.set(mob.id,label);}
      const point=this.world.project(root.position.x,root.position.z,2.25);label.hidden=!point.visible;label.style.translate=`${point.x}px ${point.y}px`;
      label.classList.toggle('combat-aggressive',!!mob.targetId);
    }
    for(const [id,label] of this.labels)if(!visible.has(id)){label.remove();this.labels.delete(id);}
    this.damage=this.damage.filter(hit=>{hit.left-=dt;const point=this.world.project(hit.x,hit.z,2.3+(.85-hit.left)*1.3);hit.node.hidden=!point.visible;hit.node.style.translate=`${point.x}px ${point.y}px`;hit.node.style.opacity=String(Math.min(1,hit.left*3));if(hit.left>0)return true;hit.node.remove();return false;});
  }
}
