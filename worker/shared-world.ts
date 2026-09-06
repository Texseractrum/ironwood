import {DurableObject} from 'cloudflare:workers';
import {SharedWorld,type WorldProfile} from '../src/open-world';
import {newState,Simulation,type State,type Building} from '../src/simulation';
import {chatText,isAction,validMove,SPEECH_DURATION,type ChatMessage,type ServerMessage,type Speech} from '../src/protocol';
import {CELL,isBelt} from '../src/data';
import {digest,readAuthCookie,type AuthFlow,type AuthSession} from './auth';
import type {XProfile} from '../src/identity';
import {isClanAction} from '../src/protocol';
import {combatState,isCombatAction} from '../src/combat-data';
import {leaderboard} from '../src/leaderboard';

interface Connection {playerId?:string;accountId?:string;sessionHash?:string;expires?:number;opened:number;lastSeen:number;lastMove:number;lastChat?:number;window:number;messages:number;speechUpdates?:number;speechFinishes?:number}
export class SharedWorldObject extends DurableObject<Record<string,unknown>> {
  world=new SharedWorld();connections=new Map<WebSocket,Connection>();timer?:number;ticks=0;
  storedBuildings=new Map<number,string>();storedProfiles=new Map<string,string>();storedDeposits=new Map<string,number>();
  storedClans=new Map<string,string>();
  chat:ChatMessage[]=[];speeches=new Map<string,Speech>();
  private combatDirty=false;
  online(){return new Set([...this.connections.values()].flatMap(c=>c.playerId?[c.playerId]:[]));}
  constructor(ctx:DurableObjectState,env:Record<string,unknown>){
    super(ctx,env);
    const sql=ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS world_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS clans (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS buildings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS deposits (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL, data TEXT NOT NULL)');
    const meta=sql.exec<{value:string}>('SELECT value FROM world_meta WHERE key = ?','state').toArray()[0];
    if(meta){
      const state=JSON.parse(meta.value) as State;
      state.buildings=sql.exec<{id:number;data:string}>('SELECT id, data FROM buildings ORDER BY id').toArray().map(row=>{this.storedBuildings.set(row.id,row.data);return JSON.parse(row.data) as Building;});
      state.deposits=Object.fromEntries(sql.exec<{id:string;amount:number}>('SELECT id, amount FROM deposits').toArray().map(row=>{this.storedDeposits.set(row.id,row.amount);return [row.id,row.amount];}));
      this.world=new SharedWorld(Simulation.restore(JSON.stringify(state)).state);
    }
    const next=sql.exec<{value:string}>('SELECT value FROM world_meta WHERE key = ?','nextSlot').toArray()[0];this.world.nextSlot=next?Number(next.value):0;
    for(const row of sql.exec<{id:string;data:string}>('SELECT id, data FROM profiles')){this.world.profiles.set(row.id,JSON.parse(row.data));this.storedProfiles.set(row.id,row.data);}
    for(const row of sql.exec<{id:string;data:string}>('SELECT id, data FROM clans')){this.world.clans.saved.set(row.id,JSON.parse(row.data));this.storedClans.set(row.id,row.data);}
    this.chat=sql.exec<{data:string}>('SELECT data FROM chat_messages ORDER BY sent_at DESC LIMIT 50').toArray().reverse().map(row=>JSON.parse(row.data) as ChatMessage);
    for(const socket of ctx.getWebSockets()){
      const c=socket.deserializeAttachment() as Connection;c.lastMove=Date.now();c.lastSeen=Date.now();this.connections.set(socket,c);
    }
    this.world.sim.onGather=strike=>this.broadcast({type:'gathered',playerId:this.world.sim.state.owner!,strike});
    this.world.combat.onHit=event=>{this.combatDirty=true;this.broadcast({type:'combat',event});};
    this.world.combat.onRespawn=p=>{
      this.combatDirty=true;
      for(const [ws,c] of this.connections)if(c.playerId===p.id){c.lastMove=Date.now();this.send(ws,{type:'respawn',x:p.x,z:p.z});}
    };
    if(this.connections.size)this.start();
  }
  async fetch(request:Request){
    if(this.connections.size>=128)return new Response('The world is busy. Please reconnect shortly.',{status:503});
    const token=readAuthCookie(request),auth=token?await this.getAuthSession(token):undefined;
    const {0:client,1:server}=new WebSocketPair(),now=Date.now();
    const c:Connection={opened:now,lastSeen:now,lastMove:now,window:now,messages:0};
    if(auth){c.accountId=auth.profile.id;c.expires=auth.expires;c.sessionHash=await digest(token);}
    this.ctx.acceptWebSocket(server);server.serializeAttachment(c);this.connections.set(server,c);this.start();
    return new Response(null,{status:101,webSocket:client});
  }
  async putAuthFlow(state:string,flow:AuthFlow){await this.ctx.storage.put('auth:flow:'+await digest(state),flow);await this.scheduleAuthCleanup();}
  async consumeAuthFlow(state:string){
    const key='auth:flow:'+await digest(state);
    return this.ctx.storage.transaction(async tx=>{const flow=await tx.get<AuthFlow>(key);await tx.delete(key);return flow&&flow.expires>Date.now()?flow:undefined;});
  }
  async createAuthSession(token:string,profile:XProfile,guestToken:string,expires:number){
    const key='auth:session:'+await digest(token),p=this.world.accountProfile(profile,guestToken);
    this.persist();
    await this.ctx.storage.put(key,{profile,expires} satisfies AuthSession);
    // A claimed guest must reconnect with its account cookie before controlling this base.
    for(const [ws,c] of this.connections)if(c.playerId===p.id&&!c.accountId){this.connections.delete(ws);ws.close(4001,'Sign in to continue');}
    await this.scheduleAuthCleanup();
  }
  async getAuthSession(token:string){
    const key='auth:session:'+await digest(token),session=await this.ctx.storage.get<AuthSession>(key);
    if(session&&session.expires>Date.now())return session;
    if(session)await this.ctx.storage.delete(key);
  }
  async getLeaderboard(token:string,page:number){
    const session=token?await this.getAuthSession(token):undefined;
    return leaderboard(this.world,session?.profile.id,page);
  }
  async deleteAuthSession(token:string){
    const hash=await digest(token);await this.ctx.storage.delete('auth:session:'+hash);
    for(const [ws,c] of this.connections)if(c.sessionHash===hash){this.connections.delete(ws);ws.close(4001,'Signed out');}
    this.persist();this.snapshot();
  }
  async scheduleAuthCleanup(){if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+60*60*1000);}
  async alarm(){
    let startAfter:string|undefined,remaining=false;
    do{
      const entries=await this.ctx.storage.list<AuthFlow|AuthSession>({prefix:'auth:',limit:500,startAfter});
      const expired=[...entries].filter(([,value])=>value.expires<=Date.now()).map(([key])=>key);
      for(let i=0;i<expired.length;i+=128)await this.ctx.storage.delete(expired.slice(i,i+128));
      remaining||=entries.size>expired.length;
      startAfter=entries.size===500?[...entries.keys()].at(-1):undefined;
    }while(startAfter);
    if(remaining)await this.ctx.storage.setAlarm(Date.now()+60*60*1000);
  }
  send(ws:WebSocket,message:ServerMessage){try{ws.send(JSON.stringify(message));}catch(error){console.warn('World client disconnected',String(error));this.connections.delete(ws);ws.close(1011,'Connection lost');}}
  broadcast(message:ServerMessage){for(const [ws,c] of this.connections)if(c.playerId)this.send(ws,message);}
  recordChat(p:WorldProfile,text:string,now:number){
    const entry:ChatMessage={id:crypto.randomUUID(),playerId:p.id,name:p.name,color:p.color,text,sentAt:now,xProfile:p.xProfile};
    this.chat.push(entry);this.ctx.storage.sql.exec('INSERT INTO chat_messages (id,sent_at,data) VALUES (?,?,?)',entry.id,entry.sentAt,JSON.stringify(entry));
    while(this.chat.length>50){const removed=this.chat.shift()!;this.ctx.storage.sql.exec('DELETE FROM chat_messages WHERE id = ?',removed.id);}
    this.broadcast({type:'chat',message:entry});
  }
  setSpeech(playerId:string,speech:Speech|null){
    if(speech)this.speeches.set(playerId,speech);else this.speeches.delete(playerId);
    this.broadcast({type:'speech',playerId,speech});
  }
  persist(){
    const state=this.world.sim.state;
    this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      const header={...state,inventory:{},owner:undefined,base:undefined,buildings:[],deposits:{},discovered:[],explored:[]};
      sql.exec('INSERT OR REPLACE INTO world_meta (key,value) VALUES (?,?)','state',JSON.stringify(header));
      sql.exec('INSERT OR REPLACE INTO world_meta (key,value) VALUES (?,?)','nextSlot',String(this.world.nextSlot));
      for(const p of this.world.profiles.values()){const data=JSON.stringify(p);if(data!==this.storedProfiles.get(p.id))sql.exec('INSERT OR REPLACE INTO profiles (id,data) VALUES (?,?)',p.id,data);}
      for(const clan of this.world.clans.saved.values()){const data=JSON.stringify(clan);if(data!==this.storedClans.get(clan.id))sql.exec('INSERT OR REPLACE INTO clans (id,data) VALUES (?,?)',clan.id,data);}
      const ids=new Set(state.buildings.map(b=>b.id));
      for(const id of this.storedBuildings.keys())if(!ids.has(id))sql.exec('DELETE FROM buildings WHERE id = ?',id);
      for(const b of state.buildings){const data=JSON.stringify(b);if(data!==this.storedBuildings.get(b.id))sql.exec('INSERT OR REPLACE INTO buildings (id,data) VALUES (?,?)',b.id,data);}
      for(const [id,amount] of Object.entries(state.deposits))if(amount!==this.storedDeposits.get(id))sql.exec('INSERT OR REPLACE INTO deposits (id,amount) VALUES (?,?)',id,amount);
    });
    // Update the caches only after the transaction commits successfully.
    this.storedProfiles=new Map([...this.world.profiles.values()].map(p=>[p.id,JSON.stringify(p)]));
    this.storedClans=new Map([...this.world.clans.saved.values()].map(c=>[c.id,JSON.stringify(c)]));
    this.storedBuildings=new Map(state.buildings.map(b=>[b.id,JSON.stringify(b)]));this.storedDeposits=new Map(Object.entries(state.deposits));
  }
  snapshot(){
    const now=Date.now();
    for(const [id,speech] of this.speeches)if(speech.expiresAt<=now)this.speeches.delete(id);
    const online=new Set([...this.connections.values()].flatMap(c=>c.playerId?[c.playerId]:[]));
    for(const id of this.speeches.keys())if(!online.has(id))this.speeches.delete(id);
    this.world.clans.prune(online,now);
    const players=[...online].flatMap(id=>{const p=this.world.profiles.get(id);return p?[{...this.world.publicPlayer(p),speech:this.speeches.get(id)}]:[];});
    const bases=this.world.bases(online);
    for(const [ws,c] of this.connections){const p=c.playerId&&this.world.profiles.get(c.playerId);if(!p)continue;
      const nearbyBases=bases.filter(b=>Math.abs(b.x-p.x/CELL)<400&&Math.abs(b.z-p.z/CELL)<400);
      this.send(ws,{type:'world',state:this.world.snapshot(p),players,bases:nearbyBases,explored:p.explored,revision:this.world.sim.revision,population:this.world.profiles.size,clan:this.world.clans.summary(p,online),invites:[...this.world.clans.invites.values()].filter(i=>i.fromId===p.id||i.toId===p.id)});
    }
  }
  start(){
    if(this.timer!==undefined)return;
    this.timer=setInterval(()=>{
      const now=Date.now();
      for(const [ws,c] of this.connections)if(now-c.lastSeen>120000||(!c.playerId&&now-c.opened>10000)||(c.expires!==undefined&&now>=c.expires)){this.connections.delete(ws);ws.close(c.accountId?4001:1000,'Connection expired');}
      if(!this.connections.size){clearInterval(this.timer??null);this.timer=undefined;this.persist();return;}
      if([...this.connections.values()].some(c=>c.playerId))this.world.tick(.1,this.online());
      if(this.combatDirty){this.combatDirty=false;this.persist();this.snapshot();}
      this.ticks++;if(this.ticks%50===0)this.persist();if(this.ticks%2===0)this.snapshot();
    },100);
  }
  webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
    const c=this.connections.get(ws);if(!c)return;
    const now=Date.now();c.lastSeen=now;if(now-c.window>=1000){c.window=now;c.messages=0;c.speechUpdates=0;c.speechFinishes=0;}
    if(++c.messages>80){ws.close(1008,'Too many requests');return;}
    if(typeof raw!=='string'||raw.length>2048){ws.close(1009,'Message too large');return;}
    let message:Record<string,unknown>;
    try{message=JSON.parse(raw);}catch{this.send(ws,{type:'result',message:'Invalid request.'});return;}
    if(!message||typeof message!=='object')return;
    if(message.type==='ping')return;
    if(message.type==='join'&&!c.playerId){
      let p=c.accountId?[...this.world.profiles.values()].find(p=>p.xProfile?.id===c.accountId):typeof message.token==='string'?this.world.guestProfile(message.token):undefined;
      if(c.accountId&&!p){ws.close(4001,'Sign in again');return;}
      if(!p){
        const name=typeof message.name==='string'?message.name.replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,20):'';
        p=this.world.createProfile(crypto.randomUUID(),crypto.randomUUID()+crypto.randomUUID(),name);
      }
      // One active controller per identity prevents duplicate movement and inventory races.
      if(combatState(p).health>0)this.world.spawnAtBase(p);
      for(const [old,other] of this.connections)if(old!==ws&&other.playerId===p.id){this.connections.delete(old);old.close(1008,'Opened in another tab');}
      c.playerId=p.id;ws.serializeAttachment(c);this.persist();
      this.send(ws,{type:'welcome',id:p.id,token:p.xProfile?'':p.token,xProfile:p.xProfile,chat:this.chat});this.snapshot();return;
    }
    const p=c.playerId&&this.world.profiles.get(c.playerId);if(!p)return;
    if(p.xProfile&&(c.accountId!==p.xProfile.id||!c.expires||c.expires<=now)){ws.close(4001,'Sign in again');return;}
    if(message.type==='customize'){
      if(!this.world.customize(p,message.appearance)){this.send(ws,{type:'result',message:'Choose an available option for each part of your outfit.'});return;}
      this.persist();this.snapshot();this.send(ws,{type:'appearance-saved',appearance:p.appearance!});return;
    }
    if(message.type==='rename'){
      if(p.xProfile){this.send(ws,{type:'result',message:'Your name comes from your X profile.'});return;}
      const name=typeof message.name==='string'?message.name.replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,20):'';
      if(name){p.name=name;this.persist();this.snapshot();this.send(ws,{type:'result',message:'Your engineer’s name is saved.'});}return;
    }
    if(message.type==='speech'){
      if(typeof message.text!=='string'||typeof message.done!=='boolean')return;
      const text=chatText(message.text);
      // Drafts are ephemeral and never write to SQLite or trigger full world snapshots.
      // Always accept a finish/clear, even after a burst of typing.
      if(message.done){
        if(text){
          if((c.speechFinishes=(c.speechFinishes??0)+1)<=5){c.lastChat=now;this.recordChat(p,text,now);}
          else this.send(ws,{type:'result',message:'Give everyone a moment before starting another message.'});
        }
        this.setSpeech(p.id,text?{text,expiresAt:now+SPEECH_DURATION}:null);
      }else if(!text||(c.speechUpdates=(c.speechUpdates??0)+1)<=30){
        this.setSpeech(p.id,text?{text,expiresAt:now+SPEECH_DURATION,typing:true}:null);
      }
      return;
    }
    if(message.type==='chat'){
      const text=chatText(message.text);
      if(!text){this.send(ws,{type:'result',message:'Write a message before sending it.'});return;}
      if(now-(c.lastChat??0)<750){this.send(ws,{type:'result',message:'Give everyone a moment before sending another message.'});return;}
      c.lastChat=now;
      this.recordChat(p,text,now);
      this.setSpeech(p.id,{text,expiresAt:now+SPEECH_DURATION});return;
    }
    if(message.type==='move'){
      if(now-c.lastMove<45)return;
      const target={x:message.x as number,z:message.z as number};
      if(combatState(p).health>0&&validMove(this.world.sim,p,target,(now-c.lastMove)/1000)){p.x=target.x;p.z=target.z;this.world.discover(p);}
      else this.send(ws,{type:'correction',x:p.x,z:p.z});
      c.lastMove=now;return;
    }
    if(isCombatAction(message)){
      const result=this.world.combat.action(p,message,this.online());this.persist();if(result)this.send(ws,{type:'result',message:result});this.snapshot();return;
    }
    if(isClanAction(message)){
      if(combatState(p).health<=0){this.send(ws,{type:'result',message:'You are respawning at your base.'});return;}
      const online=new Set([...this.connections.values()].flatMap(c=>c.playerId?[c.playerId]:[]));
      const result=this.world.clans.action(p,message,online,now);this.persist();this.send(ws,{type:'result',message:result});this.snapshot();return;
    }
    if(!isAction(message)){this.send(ws,{type:'result',message:'Unknown world action.'});return;}
    if(message.type==='place'&&!isBelt(message.kind)&&[...this.connections.values()].some(other=>{const q=other.playerId&&this.world.profiles.get(other.playerId);return q&&Math.hypot(message.x*CELL-q.x,message.z*CELL-q.z)<1.2;})){
      this.send(ws,{type:'result',message:'Leave space for the engineers standing here.'});return;
    }
    const result=this.world.action(p,message);this.persist();if(result)this.send(ws,{type:'result',message:result});this.snapshot();
  }
  webSocketClose(ws:WebSocket){this.connections.delete(ws);ws.close();this.persist();this.snapshot();if(!this.connections.size){clearInterval(this.timer??null);this.timer=undefined;}}
  webSocketError(ws:WebSocket,error:unknown){console.warn('Shared world socket error',String(error));this.webSocketClose(ws);}
}
