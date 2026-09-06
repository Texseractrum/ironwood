import { Simulation } from './simulation';
import type {GatherStrike} from './gathering';
import type {CombatAction,CombatEvent} from './combat-data';
import { chatText, type Action, type Player, type Base, type ChatMessage, type ServerMessage } from './protocol';
import type {XProfile} from './identity';
import type {ClanAction,ClanSummary,TeamInvite} from './protocol';
import {normalizeAppearance,type Appearance} from './appearance';

const IDENTITY_KEY='ironwood-world-identity-v1';
export class GameSession {
  readonly room='ironwood';id='';status='Connecting…';players:Player[]=[];bases:Base[]=[];explored:string[]=[];chat:ChatMessage[]=[];population=0;connected=false;
  xProfile?:XProfile;authEnabled=false;authBusy=false;
  clan?:ClanSummary;invites:TeamInvite[]=[];
  socket?:WebSocket;onMessage:(message:string)=>void=()=>{};onChat:(message:ChatMessage)=>void=()=>{};onChange:()=>void=()=>{};
  onGather:(playerId:string,strike:GatherStrike)=>void=()=>{};
  onResult:(message:string)=>void=()=>{};
  onSpawn:()=>void=()=>{};
  onCombat:(event:CombatEvent)=>void=()=>{};
  private retry?:ReturnType<typeof setTimeout>;private heartbeat?:ReturnType<typeof setInterval>;
  private attempts=0;private firstSnapshot=true;private moveClock=0;private layout='';private token='';
  private appearanceSave?:{finish:(error?:string)=>void;timer:ReturnType<typeof setTimeout>};
  constructor(public sim:Simulation){try{this.token=localStorage.getItem(IDENTITY_KEY)||'';}catch{/* An ephemeral guest can still connect. */}}
  action(action:Action|ClanAction|CombatAction):string {
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return 'Connecting to the world. Please wait before making changes.';
    this.socket.send(JSON.stringify(action));return '';
  }
  say(value:string):string {
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return 'Connecting to world chat. Please try again in a moment.';
    const message=chatText(value);if(!message)return 'Write a message before sending it.';
    this.socket.send(JSON.stringify({type:'chat',text:message}));return '';
  }
  speak(value:string,done=false){
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return;
    this.socket.send(JSON.stringify({type:'speech',text:chatText(value),done}));
  }
  start(){this.disconnect();this.attempts=0;this.firstSnapshot=true;this.connect();void this.checkAuth();}
  get saveStatus(){return !this.connected?'World · reconnecting':this.xProfile?`@${this.xProfile.username} · server autosave`:'Guest · log in to keep your progress';}
  async checkAuth(){
    try{const response=await fetch('/api/auth/session',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();this.authEnabled=data.enabled===true;}
    catch{this.authEnabled=false;}
    this.onChange();
  }
  async login():Promise<string|undefined>{
    if(this.authBusy)return;
    if(!this.connected)return 'Connect to the world before logging in so we can keep your progress.';
    this.authBusy=true;this.onChange();
    try{
      const response=await fetch('/api/auth/x/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guestToken:this.token}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'X login is unavailable. Please try again.');
      const url=new URL(data.url);if(url.origin!=='https://x.com'||url.pathname!=='/i/oauth2/authorize')throw new Error('Could not open X login. Please try again.');
      location.assign(url.href);
    }catch(error){this.authBusy=false;this.onChange();return error instanceof Error?error.message:'Could not open X login. Please try again.';}
  }
  async logout():Promise<string|undefined>{
    if(this.authBusy)return;
    this.authBusy=true;this.onChange();
    try{
      const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Could not log out. Please try again.');
      this.token='';this.xProfile=undefined;try{localStorage.removeItem(IDENTITY_KEY);}catch{/* The in-memory guest identity is cleared too. */}
      this.start();
    }catch(error){return error instanceof Error?error.message:'Could not log out. Please try again.';}
    finally{this.authBusy=false;this.onChange();}
  }
  rename(name:string){if(this.connected)this.socket?.send(JSON.stringify({type:'rename',name}));}
  customize(appearance:Appearance):Promise<string|undefined>{
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return Promise.resolve('Reconnect to the world before saving your look.');
    if(this.appearanceSave)return Promise.resolve('Your outfit is still saving.');
    return new Promise(resolve=>{
      const finish=(error?:string)=>{clearTimeout(this.appearanceSave?.timer);this.appearanceSave=undefined;resolve(error);};
      this.appearanceSave={finish,timer:setTimeout(()=>finish('The save was not confirmed. Reconnect and check your outfit.'),10000)};
      this.socket!.send(JSON.stringify({type:'customize',appearance:normalizeAppearance(appearance)}));
    });
  }
  private connect(){
    this.status=this.attempts?'Reconnecting…':'Connecting…';this.connected=false;this.onChange();
    const url=new URL('/api/world',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);this.socket=socket;
    socket.onopen=()=>socket.send(JSON.stringify({type:'join',token:this.token}));
    socket.onmessage=event=>{
      if(socket!==this.socket)return;
      let message:ServerMessage;
      try{message=JSON.parse(event.data);}catch{this.onMessage('An unreadable world update arrived. Reconnecting…');socket.close();return;}
      if(message.type==='welcome'){
        this.id=message.id;this.token=message.token;this.xProfile=message.xProfile;this.chat=message.chat??[];this.attempts=0;
        try{if(message.xProfile)localStorage.removeItem(IDENTITY_KEY);else localStorage.setItem(IDENTITY_KEY,message.token);}catch{if(!message.xProfile)this.onMessage('Browser storage is unavailable. Log in with X to keep your progress.');}
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},15000);
      }
      if(message.type==='chat'){
        if(!this.chat.some(item=>item.id===message.message.id))this.chat=[...this.chat,message.message].slice(-50);
        this.onChat(message.message);this.onChange();
      }
      if(message.type==='speech'){
        const player=this.players.find(player=>player.id===message.playerId);
        if(player)player.speech=message.speech??undefined;
        this.onChange();
      }
      if(message.type==='world'){
        if(!this.firstSnapshot&&message.clan?.id!==this.clan?.id&&message.clan)this.onMessage(`Joined ${message.clan.name}. Supplies and workshops are now shared.`);
        this.clan=message.clan;this.invites=message.invites||[];
        const previous=this.sim.state.player,oldCombat=this.sim.state.combat,nextCombat=message.state.combat;
        const combatTeleport=!!nextCombat&&(nextCombat.health<=0||oldCombat?.deaths!==nextCombat.deaths||(oldCombat?.health===0&&nextCombat.health>0));
        this.sim.state=message.state;
        this.sim.state.player=this.firstSnapshot||combatTeleport?message.state.player:previous;
        const spawned=this.firstSnapshot;this.firstSnapshot=false;this.connected=true;this.status=message.players.length+' online';
        this.players=message.players;this.bases=message.bases;this.explored=message.explored;this.population=message.population;
        // Reindex fresh objects, but keep server power authoritative for partial networks.
        const power=this.sim.state.buildings.map(b=>b.power);
        this.sim.map.clear();this.sim.byId.clear();for(const b of this.sim.state.buildings){this.sim.map.set(b.x+','+b.z,b);this.sim.byId.set(b.id,b);}
        this.sim.computePower();this.sim.state.buildings.forEach((b,i)=>b.power=power[i]);
        const layout=this.sim.state.buildings.map(b=>[b.id,b.kind,b.x,b.z,b.dir,b.level||0].join(':')).join('|')+';'+this.sim.powerEdges.map(([a,b])=>`${a.id}:${b.id}`).join('|');
        if(this.layout!==layout){this.layout=layout;this.sim.revision++;}
        if(spawned)this.onSpawn();
        this.onChange();
      }
      if(message.type==='combat')this.onCombat(message.event);
      if(message.type==='respawn'){this.sim.state.player={x:message.x,z:message.z};this.moveClock=0;this.onSpawn();this.onMessage('Back at your base. Your supplies are safe. Protected for 5 seconds, or until you attack.');}
      if(message.type==='gathered')this.onGather(message.playerId,message.strike);
      if(message.type==='appearance-saved')this.appearanceSave?.finish();
      if(message.type==='result'){this.onResult(message.message);this.onMessage(message.message);}
      if(message.type==='correction')this.sim.state.player={x:message.x,z:message.z};
    };
    socket.onerror=()=>{this.status='World server unreachable';this.onChange();};
    socket.onclose=event=>{
      if(socket!==this.socket)return;
      this.connected=false;clearInterval(this.heartbeat);this.players=[];this.invites=[];
      this.appearanceSave?.finish('Connection lost. Reconnect and check your outfit before trying again.');
      if(event.code===4001){this.xProfile=undefined;this.onMessage('Your login changed or expired. Reconnecting…');}
      if(event.code===1008){this.status='Open in another tab';this.onMessage('Your engineer is active in another tab. Use World → Reconnect to play here.');this.onChange();return;}
      this.status='Reconnecting…';this.onChange();this.firstSnapshot=true;
      this.retry=setTimeout(()=>{this.attempts++;this.connect();},Math.min(1000*2**Math.min(this.attempts,4),15000));
    };
  }
  update(dt:number){
    if(this.sim.state.combat?.health===0)return;
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return;this.moveClock+=dt;
    if(this.moveClock<.1)return;this.moveClock=0;this.socket.send(JSON.stringify({type:'move',...this.sim.state.player}));
  }
  private disconnect(){this.appearanceSave?.finish('Connection changed. Reopen the editor after reconnecting.');clearTimeout(this.retry);clearInterval(this.heartbeat);const socket=this.socket;this.socket=undefined;socket?.close();this.connected=false;}
}
