import type {GameSession} from './session';
import type {LeaderboardPage} from './leaderboard';
import {profileChip,xLogo} from './nameplates';
import './leaderboard.css';

export function leaderboardContent(){
  return `<section id="leaderboard-view">
    <span class="eyebrow">THE MECHANIST’S GUILD · MATERIALS</span>
    <h2 id="leaderboard-title">Leaderboard</h2>
    <p id="leaderboard-description">X engineers, ranked by total materials in their account inventory. Gather and collect supplies to climb the ranks.</p>
    <div id="leaderboard-membership" class="leaderboard-membership"></div>
    <div class="leaderboard-toolbar"><p id="leaderboard-status" role="status" aria-atomic="true"></p><button id="leaderboard-refresh" class="button secondary" type="button">Refresh</button></div>
    <div id="leaderboard-results" aria-busy="true">
      <p id="leaderboard-empty" class="leaderboard-empty" hidden>No X engineers yet. Log in with X to take the first spot.</p>
      <table class="leaderboard-table" hidden>
        <caption class="leaderboard-sr-only">Current total materials in X engineers’ inventories</caption>
        <thead><tr><th scope="col">Rank</th><th scope="col">Engineer</th><th scope="col">Materials</th></tr></thead>
        <tbody id="leaderboard-rows"></tbody>
      </table>
    </div>
    <nav id="leaderboard-pagination" class="leaderboard-pagination" aria-label="Leaderboard pages" hidden>
      <button id="leaderboard-previous" class="button secondary" type="button">Previous</button>
      <span id="leaderboard-page"></span>
      <button id="leaderboard-next" class="button secondary" type="button">Next</button>
    </nav>
    <p class="leaderboard-rules">Counts each item in your inventory equally. Spending supplies lowers your total. Includes offline engineers; clan members use their shared inventory total. Equal totals share a rank. Updates every 15 seconds while open.</p>
  </section>`;
}

export class LeaderboardUI {
  private data?:LeaderboardPage;
  private request?:AbortController;
  private busy=false;
  private disposed=false;
  private timer:ReturnType<typeof setInterval>;
  private rendered='';
  private membership='';
  private dialog:HTMLDialogElement;
  private trapFocus=(event:KeyboardEvent)=>{
    if(event.key!=='Tab')return;
    const controls=[...this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')].filter(node=>node.getClientRects().length>0);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  constructor(private root:HTMLElement,private session:GameSession){
    this.dialog=root.closest('dialog')!;this.dialog.addEventListener('keydown',this.trapFocus);
    this.node<HTMLButtonElement>('leaderboard-refresh').onclick=()=>{if(!this.busy)void this.load(this.data?.page??1);};
    this.node<HTMLButtonElement>('leaderboard-previous').onclick=()=>{if(!this.busy&&this.data&&this.data.page>1)void this.load(this.data.page-1);};
    this.node<HTMLButtonElement>('leaderboard-next').onclick=()=>{if(!this.busy&&this.data&&this.data.page<this.data.pages)void this.load(this.data.page+1);};
    this.renderMembership();
    void this.load(1);
    this.timer=setInterval(()=>{if(!document.hidden&&!this.busy)void this.load(this.data?.page??1,true);},15000);
  }
  private node<T extends HTMLElement=HTMLElement>(id:string){return this.root.querySelector<T>('#'+id)!;}
  private controls(){
    this.node('leaderboard-refresh').setAttribute('aria-disabled',String(this.busy));
    this.node('leaderboard-previous').setAttribute('aria-disabled',String(this.busy||!this.data||this.data.page===1));
    this.node('leaderboard-next').setAttribute('aria-disabled',String(this.busy||!this.data||this.data.page===this.data.pages));
    this.node('leaderboard-results').setAttribute('aria-busy',String(this.busy));
  }
  private async load(page:number,automatic=false){
    this.busy=true;this.controls();
    const status=this.node('leaderboard-status');
    if(!automatic)status.textContent=this.data?'Refreshing leaderboard…':'Loading leaderboard…';
    const request=new AbortController();this.request=request;
    const timeout=setTimeout(()=>request.abort(),10000);
    try{
      const response=await fetch(`/api/leaderboard?page=${page}`,{cache:'no-store',signal:request.signal});
      if(!response.ok)throw new Error('Leaderboard unavailable');
      const data:LeaderboardPage=await response.json();
      if(this.disposed)return;
      this.data=data;this.render();
      const summary=`${data.total.toLocaleString()} X engineer${data.total===1?'':'s'} · Total materials`;
      if(status.textContent!==summary)status.textContent=summary;
    }catch{
      if(!this.disposed)status.textContent=this.data?'Couldn’t update the leaderboard. Showing the last results. Try Refresh.':'Couldn’t load the leaderboard. Try Refresh.';
    }finally{
      clearTimeout(timeout);
      if(!this.disposed){this.busy=false;this.controls();}
    }
  }
  private renderMembership(){
    const own=this.data?.own,key=JSON.stringify([own,this.session.xProfile?.id]);
    if(key===this.membership)return;this.membership=key;
    const membership=this.node('leaderboard-membership');membership.replaceChildren();
    const text=document.createElement('p');
    if(own){
      const title=document.createElement('strong');title.textContent=`Your rank · #${own.rank.toLocaleString()}`;
      text.append(title,document.createTextNode(`${own.totalMaterials.toLocaleString()} materials${own.clan?' · Shared clan inventory':''}`));membership.append(text);
    }else if(this.session.xProfile){
      text.textContent='Your X account is eligible. Your rank will appear when the leaderboard loads.';membership.append(text);
    }else{
      text.textContent='Save your workshop and join the ranks.';
      const login=document.createElement('button');login.type='button';login.className='button';login.id='leaderboard-login';login.innerHTML=xLogo+' Log in with X';
      login.onclick=async()=>{
        login.disabled=true;
        const message=await this.session.login();
        if(this.disposed)return;
        if(message){this.node('leaderboard-status').textContent=message;login.disabled=false;}
      };
      membership.append(text,login);
    }
  }
  private render(){
    const data=this.data!;this.renderMembership();
    const key=JSON.stringify([data.entries,data.own?.playerId]);
    if(key!==this.rendered){
      this.rendered=key;
      const rows=this.node('leaderboard-rows'),fragment=document.createDocumentFragment();
      const focused=document.activeElement instanceof HTMLAnchorElement&&rows.contains(document.activeElement)?document.activeElement.closest('tr')?.dataset.playerId:undefined;
      for(const entry of data.entries){
        const row=document.createElement('tr'),rank=document.createElement('td'),engineer=document.createElement('th'),score=document.createElement('td');
        row.dataset.playerId=entry.playerId;engineer.scope='row';
        const own=entry.playerId===data.own?.playerId;row.classList.toggle('leaderboard-own',own);row.classList.toggle('leaderboard-first',entry.rank===1);
        rank.className='leaderboard-rank';rank.textContent=String(entry.rank);rank.setAttribute('aria-label',`Rank ${entry.rank}`);
        const link=document.createElement('a');link.href='https://x.com/'+encodeURIComponent(entry.profile.username);link.target='_blank';link.rel='noopener noreferrer';
        link.setAttribute('aria-label',`${entry.profile.name}, @${entry.profile.username}${own?' · You':''} on X (opens in a new tab)`);link.append(profileChip(entry.profile));
        const handle=document.createElement('span');handle.className='leaderboard-handle';handle.textContent='@'+entry.profile.username+(own?' · You':'');
        link.append(handle);engineer.append(link);
        if(entry.clan){const clan=document.createElement('small');clan.className='leaderboard-clan';clan.textContent=entry.clan;engineer.append(clan);}
        score.className='leaderboard-score';score.textContent=entry.totalMaterials.toLocaleString();row.append(rank,engineer,score);fragment.append(row);
      }
      rows.replaceChildren(fragment);
      if(focused){const row=[...rows.children].find(row=>(row as HTMLElement).dataset.playerId===focused);(row?.querySelector('a')??this.node('leaderboard-refresh')).focus({preventScroll:true});}
    }
    this.root.querySelector('table')!.hidden=data.total===0;
    this.node('leaderboard-empty').hidden=data.total!==0;
    this.node('leaderboard-pagination').hidden=data.pages<=1;
    this.node('leaderboard-page').textContent=`Page ${data.page} of ${data.pages}`;
  }
  dispose(){this.disposed=true;clearInterval(this.timer);this.request?.abort();this.dialog.removeEventListener('keydown',this.trapFocus);}
}
