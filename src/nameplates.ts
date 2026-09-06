import type {World} from './world';
import type {GameSession} from './session';
import {profileImage,type XProfile} from './identity';
import {CHAT_MAX_LENGTH} from './protocol';
import {LiveChatInput} from './live-chat';
import './nameplates.css';

export const xLogo='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3l13.31 17.403Z"/></svg>';

export function profileChip(profile:XProfile):HTMLElement {
  const chip=document.createElement('span');chip.className='profile-chip';
  const avatar=document.createElement('span');avatar.className='profile-avatar';avatar.textContent=Array.from(profile.name)[0]||'?';
  const url=profileImage(profile.avatarUrl);
  if(url){const image=document.createElement('img');image.src=url;image.alt='';image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();avatar.append(image);}
  const name=document.createElement('span');name.className='profile-name';name.textContent=profile.name;
  chip.append(avatar,name);chip.title=`${profile.name} · @${profile.username}`;
  if(profile.verified){
    const badge=document.createElement('span');badge.className=`profile-verified profile-verified--${profile.verifiedType}`;
    badge.title=profile.verifiedType==='business'?'Verified business on X':profile.verifiedType==='government'?'Verified government account on X':'Verified on X';
    badge.setAttribute('role','img');badge.setAttribute('aria-label',badge.title);
    badge.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 1 3 2 3.6.4.9 3.5L22 10l-1 3.5.1 3.5-3.3 1.5-2.2 2.8-3.6-.6-3.4.9-2.4-2.7-3.3-1.3-.1-3.6L1 10.6l2.4-2.8.7-3.5 3.6-.6Z"/><path fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m7.5 12 3 3 6-6"/></svg>';
    chip.append(badge);
  }
  const affiliation=profile.affiliation,organisationUrl=profileImage(affiliation?.badgeUrl);
  if(affiliation&&organisationUrl){const image=document.createElement('img');image.className='profile-affiliation';image.src=organisationUrl;image.alt=`Affiliated with ${affiliation.name}`;image.title=image.alt;image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();chip.append(image);}
  return chip;
}

/** DOM nameplates stay crisp at every zoom and follow the rendered character each frame. */
export class Nameplates {
  private layer=document.createElement('div');
  private own=document.createElement('div');
  private button=document.createElement('button');
  private speech=document.createElement('div');
  private composer=document.createElement('input');
  private peers=new Map<string,{node:HTMLElement;key:string}>();
  private ownKey='';
  private composing=false;
  private composerHelp=document.createElement('div');
  private liveInput:LiveChatInput;
  constructor(private world:World,private session:GameSession,private account:()=>void,private notify:(message:string)=>void){
    this.layer.className='nameplates';this.layer.setAttribute('aria-label','Engineers');
    this.own.className='nameplate-anchor nameplate-own';this.button.className='nameplate-button';this.button.type='button';
    this.speech.className='nameplate-speech';this.speech.hidden=true;
    this.composer.className='nameplate-composer';this.composer.type='text';this.composer.maxLength=CHAT_MAX_LENGTH;this.composer.placeholder='Say something…';this.composer.autocomplete='off';this.composer.setAttribute('aria-label','Message everyone nearby');this.composer.hidden=true;
    this.composer.setAttribute('aria-label','Live message above your engineer');this.composer.setAttribute('aria-describedby','overhead-chat-help');
    this.composerHelp.id='overhead-chat-help';this.composerHelp.className='nameplate-composer-help';this.composerHelp.textContent='Live above your engineer · Esc or click away to finish';this.composerHelp.hidden=true;
    this.own.append(this.button,this.speech,this.composer,this.composerHelp);this.layer.append(this.own);document.getElementById('ui')!.before(this.layer);
    this.liveInput=new LiveChatInput(this.composer,session,()=>this.closeComposer());
    // Let a focused control use Space/Enter without triggering game shortcuts.
    this.button.addEventListener('keydown',event=>event.stopPropagation());
    this.button.onclick=()=>{this.world.keys.clear();if(this.session.xProfile)this.account();else void this.session.login().then(message=>{if(message)this.notify(message);});};
    window.addEventListener('keydown',event=>{
      const target=event.target instanceof HTMLElement?event.target:null;
      if(event.key!=='/'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||target?.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
      event.preventDefault();this.openComposer();
    });
  }
  openComposer(){if(!this.session.connected){this.notify('Connect to the world before starting live chat.');return;}this.world.cancelConveyor();this.composing=true;this.world.keys.clear();this.own.hidden=false;this.button.hidden=true;this.speech.hidden=true;this.composer.hidden=false;this.composerHelp.hidden=false;this.composer.focus({preventScroll:true});}
  private closeComposer(){const wasComposing=this.composing;this.composing=false;this.composer.hidden=true;this.composerHelp.hidden=true;this.world.keys.clear();if(wasComposing)this.composer.blur();}
  update(){
    if(this.composing&&!this.session.connected)this.liveInput.close();
    const s=this.session,key=JSON.stringify([s.xProfile,s.authBusy,s.connected]);
    if(key!==this.ownKey){
      this.ownKey=key;this.button.replaceChildren();this.button.disabled=s.authBusy||!s.connected;
      this.button.setAttribute('aria-busy',String(s.authBusy));
      if(s.xProfile){this.button.append(profileChip(s.xProfile));this.button.setAttribute('aria-label',`Account: ${s.xProfile.name}, @${s.xProfile.username}`);this.button.title='Your X account · Progress saves automatically';}
      else{this.button.innerHTML=`<span class="nameplate-x">${xLogo}</span><span class="nameplate-prompt">${s.authBusy?'Opening X…':s.connected?'Log in to save progress':'Connecting…'}</span>`;this.button.setAttribute('aria-label','Log in with X to save progress');this.button.title='Connect your X account to keep your base across devices';}
    }
    const ownPlayer=s.players.find(player=>player.id===s.id),ownSpeech=ownPlayer?.speech&&ownPlayer.speech.expiresAt>Date.now()?ownPlayer.speech:undefined;
    this.button.hidden=this.composing||!!ownSpeech;this.composer.hidden=!this.composing;this.speech.hidden=this.composing||!ownSpeech;
    if(ownSpeech&&this.speech.textContent!==ownSpeech.text)this.speech.textContent=ownSpeech.text;
    this.position(this.own,this.world.player.position.x,this.world.player.position.z,2.8);
    // Keep the engineer's account prompt from covering conveyor tiles while building.
    if(this.world.selectedKind==='conveyor'&&!this.composing&&!ownSpeech)this.own.hidden=true;
    const state=s.sim.state,nearEnemy=(state.mobs??[]).some(m=>m.health>0&&Math.hypot(m.x-state.player.x,m.z-state.player.z)<8)
      ||s.players.some(p=>p.id!==s.id&&!state.clanMembers?.includes(p.id)&&p.combat?.health!==0&&Math.hypot(p.x-state.player.x,p.z-state.player.z)<5);
    if((nearEnemy||state.combat?.health===0)&&!this.composing&&!ownSpeech)this.own.hidden=true;
    const visible=new Set<string>();
    for(const p of s.players){
      if(p.combat?.health===0)continue;
      const character=this.world.crewObjects.get(p.id);if(p.id===s.id||!character)continue;
      visible.add(p.id);let plate=this.peers.get(p.id);
      if(!plate){const node=document.createElement('div');node.className='nameplate-anchor nameplate-peer';plate={node,key:''};this.peers.set(p.id,plate);this.layer.append(node);}
      const speech=p.speech&&p.speech.expiresAt>Date.now()?p.speech:undefined,key=JSON.stringify([p.name,p.xProfile,speech?.text,speech?.typing]);
      if(plate.key!==key){plate.key=key;plate.node.replaceChildren();plate.node.classList.toggle('nameplate-speaking',!!speech);plate.node.classList.toggle('nameplate-typing',!!speech?.typing);if(speech)plate.node.textContent=speech.text;else if(p.xProfile)plate.node.append(profileChip(p.xProfile));else plate.node.textContent=p.name;}
      this.position(plate.node,character.position.x,character.position.z,2.8);
    }
    for(const [id,plate] of this.peers)if(!visible.has(id)){plate.node.remove();this.peers.delete(id);}
  }
  private position(node:HTMLElement,x:number,z:number,height:number){
    const point=this.world.project(x,z,height);node.hidden=!point.visible;
    if(point.visible)node.style.translate=`${point.x.toFixed(1)}px ${point.y.toFixed(1)}px`;
  }
}
