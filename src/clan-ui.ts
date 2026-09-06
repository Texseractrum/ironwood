import type {GameSession} from './session';
import type {World} from './world';
import {TEAM_DISTANCE,CLAN_LIMIT,type ClanAction} from './protocol';
import {createIcons,Shield} from 'lucide';
import './clans.css';

const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{
  const element=document.createElement(tag);element.textContent=text;element.className=className;return element;
};

/** Keep invitation controls still and focused while positions stream in. */
export class ClanUI {
  private panel=node('aside','','clan-panel panel');
  private toggle=node('button','','clan-launcher');
  private toggleLabel=node('span','Clans','clan-launcher-label');
  private expanded=false;private key='';
  constructor(private session:GameSession,private world:World,private notify:(message:string)=>void,private waypoint:(base:{x:number;z:number},name:string)=>void){
    this.toggle.id='clan-toggle';this.toggle.type='button';this.toggle.setAttribute('aria-controls','clan-panel');
    this.toggle.title='Clans and nearby engineers';
    const mark=node('i');mark.setAttribute('data-lucide','shield');mark.setAttribute('aria-hidden','true');this.toggle.append(mark,this.toggleLabel);
    this.panel.id='clan-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','Clans and nearby engineers');
    document.querySelector('.expedition-bar')!.append(this.toggle);document.getElementById('ui')!.append(this.panel);
    createIcons({icons:{Shield},attrs:{'stroke-width':1.6}});
    this.toggle.onclick=()=>{this.world.keys.clear();this.expanded=!this.expanded;this.update();};
    for(const element of [this.panel,this.toggle])element.addEventListener('keydown',event=>event.stopPropagation());
    this.panel.addEventListener('focusin',()=>this.world.keys.clear());
  }
  private action(label:string,action:ClanAction,secondary=false){
    const button=node('button',label,`button${secondary?' secondary':''}`);button.type='button';
    button.onclick=()=>{this.world.keys.clear();const error=this.session.action(action);if(error)this.notify(error);};return button;
  }
  update(){
    const s=this.session,me=s.players.find(p=>p.id===s.id);
    const nearby=s.connected&&me?s.players.filter(p=>p.id!==s.id&&Math.hypot(p.x-me.x,p.z-me.z)<=TEAM_DISTANCE):[];
    const strangers=nearby.filter(p=>!s.clan||p.clanId!==s.clan.id);
    const invites=s.connected?s.invites:[];
    const title=s.clan?`Clan · ${s.clan.members.length}`:'Clans';if(this.toggleLabel.textContent!==title)this.toggleLabel.textContent=title;
    // Phones surface invitations in the menu so nearby players never cover movement.
    const compact=matchMedia('(max-width: 800px), (pointer: coarse)').matches;
    const visible=this.expanded||(!compact&&(strangers.length>0||invites.length>0));
    this.toggle.setAttribute('aria-expanded',String(visible));this.panel.hidden=!visible;
    const label=document.querySelector<HTMLElement>('.inventory-label');
    if(label){label.title=s.clan?'Clan supplies · shared with every member':'Your supplies';label.classList.toggle('clan-inventory',!!s.clan);label.setAttribute('aria-label',label.title);}
    document.querySelector('.resources')?.setAttribute('aria-label',s.clan?'Shared clan inventory':'Inventory');
    const key=JSON.stringify([s.connected,s.clan,strangers.map(p=>[p.id,p.name,p.clanId]),invites,this.expanded]);
    if(key===this.key)return;this.key=key;
    const focused=this.panel.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset.focus:undefined;
    this.panel.replaceChildren();
    const head=node('div','','clan-heading');head.append(node('h3',s.clan?.name||'Build together'));
    if(this.expanded){const close=node('button','×','clan-close');close.type='button';close.setAttribute('aria-label','Close clan details');close.onclick=()=>{this.expanded=false;this.update();this.toggle.focus();};head.append(close);}
    this.panel.append(head);
    this.panel.append(node('p',s.clan?'Shared supplies, tools, and workshops.':`Meet within 3 tiles to form a clan of up to ${CLAN_LIMIT} engineers.`,'clan-copy'));
    if(!s.connected){this.panel.append(node('p','Reconnect to manage your clan.','clan-copy'));return;}
    if(this.expanded&&s.clan){
      const roster=node('div','','clan-roster');
      for(const member of s.clan.members){
        const button=node('button','','clan-member');button.type='button';button.dataset.focus=member.id;
        button.append(node('span',member.name+(member.id===s.id?' · You':'')),node('small',`${member.online?'Online':'Offline'} · Find base`));
        button.onclick=()=>{this.waypoint(member.base,member.name+'’s base');this.expanded=false;this.update();};roster.append(button);
      }
      this.panel.append(roster);
    }
    for(const invite of invites){
      const incoming=invite.toId===s.id,other=s.players.find(p=>p.id===(incoming?invite.fromId:invite.toId));
      const row=node('section','','clan-invite');row.append(node('strong',incoming?`${other?.name||'An engineer'} wants to team up`:`Invitation sent to ${other?.name||'engineer'}`));
      row.append(node('p',incoming?'Accept to pool all supplies and let clan members build, collect, and dismantle across your bases.':'Waiting for them to accept. Stay nearby.'));
      const actions=node('div','','clan-actions');
      if(incoming)actions.append(this.action('Accept & share',{type:'team-accept',inviteId:invite.id}),this.action('Decline',{type:'team-decline',inviteId:invite.id},true));
      else actions.append(this.action('Cancel invite',{type:'team-cancel',inviteId:invite.id},true));
      row.append(actions);this.panel.append(row);
    }
    for(const other of strangers){
      if(invites.some(i=>i.fromId===other.id||i.toId===other.id))continue;
      const row=node('div','','clan-neighbor');row.append(node('span',other.name));
      if(s.clan&&other.clanId)row.append(node('small','In another clan'));
      else if((s.clan?.members.length||0)>=CLAN_LIMIT)row.append(node('small','Clan full'));
      else {const button=this.action('Team up',{type:'team-invite',targetId:other.id});button.setAttribute('aria-label',`Team up with ${other.name}`);row.append(button);}
      this.panel.append(row);
    }
    if(!strangers.length&&!invites.length)this.panel.append(node('p',s.clan?'Meet more engineers to invite them.':'Find engineers in World or on the map, then walk over to meet them.','clan-copy'));
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((button,i)=>{button.dataset.focus??=String(i);if(button.dataset.focus===focused)button.focus({preventScroll:true});});
  }
}
