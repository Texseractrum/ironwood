import { DurableObject } from 'cloudflare:workers';
import { Simulation } from '../src/simulation';
import { applyAction, isAction, ROOM_PATTERN, validMove, type Player, type ServerMessage } from '../src/protocol';
import {SharedWorldObject} from './shared-world';
import {handleAuth,readAuthCookie,type AuthConfig} from './auth';
export {SharedWorldObject};

interface Env extends AuthConfig {ROOMS:DurableObjectNamespace<GameRoom>;WORLD:DurableObjectNamespace<SharedWorldObject>;ASSETS:Fetcher}
interface Profile extends Player {token:string;miningReady:number}
interface Session {token?:string;opened:number;window:number;messages:number;lastMove:number;lastSeen:number}
interface SavedRoom {simulation:string;profiles:Profile[]}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/auth/'))return handleAuth(request,env,env.WORLD.getByName('ironwood-public-v1'));
    if(url.pathname==='/api/health')return Response.json({ok:true,multiplayer:true,world:'ironwood',procedural:true});
    if(url.pathname==='/api/leaderboard'){
      const headers={'Cache-Control':'private, no-store'};
      if(request.method!=='GET')return new Response('Use GET to view the leaderboard.',{status:405,headers:{...headers,Allow:'GET'}});
      const page=url.searchParams.get('page')??'1';
      if(!/^[1-9]\d{0,6}$/.test(page))return Response.json({error:'Choose a valid leaderboard page.'},{status:400,headers});
      try{
        const result=await env.WORLD.getByName('ironwood-public-v1').getLeaderboard(readAuthCookie(request),Number(page));
        return Response.json(result,{headers});
      }catch{
        return Response.json({error:'The leaderboard is unavailable. Please try again.'},{status:503,headers});
      }
    }
    if(url.pathname==='/api/world'){
      if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required.',{status:426});
      const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return new Response('Use the game website to connect.',{status:403});
      return env.WORLD.getByName('ironwood-public-v1').fetch(request);
    }
    if(url.pathname.startsWith('/api/rooms/')){
      const code=url.pathname.slice('/api/rooms/'.length);
      if(!ROOM_PATTERN.test(code))return new Response('Invalid room code.',{status:400});
      if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required.',{status:426});
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return new Response('Use the game website to join.',{status:403});
      return env.ROOMS.getByName(code).fetch(request);
    }
    if(url.pathname.startsWith('/api/'))return new Response('Not found',{status:404});
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

export class GameRoom extends DurableObject<Env> {
  sim=new Simulation();profiles=new Map<string,Profile>();sessions=new Map<WebSocket,Session>();
  timer?:ReturnType<typeof setInterval>;ticks=0;
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      const saved=await ctx.storage.get<SavedRoom>('room');
      if(saved){this.sim=Simulation.restore(saved.simulation);this.profiles=new Map(saved.profiles.map(p=>[p.token,p]));}
      for(const ws of ctx.getWebSockets()){
        const session=ws.deserializeAttachment() as Session;
        session.lastMove=Date.now();session.lastSeen=Date.now();this.sessions.set(ws,session);
      }
      if(this.sessions.size)this.start();
    });
  }
  fetch(){
    if(this.sessions.size>=8)return new Response('This room already has 8 players.',{status:409});
    const {0:client,1:server}=new WebSocketPair();
    const now=Date.now(),session:Session={opened:now,window:now,messages:0,lastMove:now,lastSeen:now};
    this.ctx.acceptWebSocket(server);server.serializeAttachment(session);this.sessions.set(server,session);this.start();
    return new Response(null,{status:101,webSocket:client});
  }
  send(ws:WebSocket,message:ServerMessage){
    try{ws.send(JSON.stringify(message));}catch(error){console.warn('Client disconnected during send',String(error));ws.close(1011,'Connection lost');}
  }
  snapshot(){
    const players=[...this.sessions.values()].flatMap(s=>{
      const p=s.token&&this.profiles.get(s.token);return p?[{id:p.id,name:p.name,x:p.x,z:p.z,color:p.color,base:p.base||{x:0,z:0}}]:[];
    });
    const message:ServerMessage={type:'snapshot',state:this.sim.state,players,revision:this.sim.revision};
    for(const [ws,s] of this.sessions)if(s.token)this.send(ws,message);
  }
  persist(){return this.ctx.storage.put('room',{simulation:this.sim.serialize(),profiles:[...this.profiles.values()]} satisfies SavedRoom);}
  start(){
    if(this.timer)return;
    this.timer=setInterval(()=>{
      const now=Date.now();
      for(const [ws,s] of this.sessions)if((!s.token&&now-s.opened>10000)||now-s.lastSeen>45000){ws.close(1000,'Session timed out');this.sessions.delete(ws);}
      if(!this.sessions.size){clearInterval(this.timer??null);this.timer=undefined;this.ctx.waitUntil(this.persist());return;}
      if([...this.sessions.values()].some(s=>s.token))this.sim.tick(.1);
      this.ticks++;if(this.ticks%2===0)this.snapshot();
      if(this.ticks%50===0)this.ctx.waitUntil(this.persist());
    },100);
  }
  async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer){
    const s=this.sessions.get(ws);if(!s)return;
    const now=Date.now();s.lastSeen=now;
    if(now-s.window>=1000){s.window=now;s.messages=0;}
    if(++s.messages>80){ws.close(1008,'Too many messages');return;}
    if(typeof raw!=='string'||raw.length>2048){ws.close(1009,'Message too large');return;}
    let m:Record<string,unknown>;
    try{m=JSON.parse(raw);}catch{this.send(ws,{type:'result',message:'Invalid message.'});return;}
    if(!m||typeof m!=='object')return;
    if(m.type==='ping')return;
    if(m.type==='join'&&!s.token){
      let p=typeof m.token==='string'?this.profiles.get(m.token):undefined;
      if(p)for(const [old,other] of this.sessions)if(old!==ws&&other.token===p.token){this.sessions.delete(old);old.close(1008,'Player reconnected elsewhere');}
      if(!p){
        if(this.profiles.size>=64){this.send(ws,{type:'result',message:'This expedition has reached its 64-visitor limit. Create a new room.'});ws.close(1008,'Visitor limit');return;}
        const name=typeof m.name==='string'?m.name.replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,20):'';
        const spawn={x:0,z:5.75};
        // Find a free spawn if the crew has built over the original arrival point.
        for(let z=2;z<=9;z++)if(this.sim.canWalk(0,z*2.3)){spawn.z=z*2.3;break;}
        p={id:crypto.randomUUID(),token:crypto.randomUUID()+crypto.randomUUID(),name:name||`Engineer ${this.profiles.size+1}`,color:['#e9c77e','#82c9d3','#c4a1e8','#ec9e82','#aad18c','#d994b7','#98adf0','#d0cf8a'][this.profiles.size%8],...spawn,base:{x:0,z:0},miningReady:0};
        this.profiles.set(p.token,p);
      }
      s.token=p.token;ws.serializeAttachment(s);await this.persist();
      this.send(ws,{type:'welcome',id:p.id,token:p.token});this.snapshot();return;
    }
    const p=s.token&&this.profiles.get(s.token);if(!p)return;
    if(m.type==='move'){
      const target={x:m.x as number,z:m.z as number};
      if(now-s.lastMove<45)return;
      if(validMove(this.sim,p,target,(now-s.lastMove)/1000)){
        p.x=target.x;p.z=target.z;this.sim.state.player={x:p.x,z:p.z};this.sim.discover();
      }else this.send(ws,{type:'correction',x:p.x,z:p.z});
      s.lastMove=now;return;
    }
    if(!isAction(m)){this.send(ws,{type:'result',message:'Unknown game action.'});return;}
    this.sim.state.player={x:p.x,z:p.z};this.sim.state.miningReady=p.miningReady;
    if(m.type==='place'&&[...this.sessions.values()].some(session=>{const other=session.token&&this.profiles.get(session.token);return other&&Math.hypot(m.x*2.3-other.x,m.z*2.3-other.z)<1.2;})){
      this.send(ws,{type:'result',message:'Leave room for your fellow engineer.'});return;
    }
    const message=applyAction(this.sim,m);p.miningReady=this.sim.state.miningReady;
    await this.persist();if(message)this.send(ws,{type:'result',message});this.snapshot();
  }
  async webSocketClose(ws:WebSocket){ws.close();this.sessions.delete(ws);await this.persist();this.snapshot();if(!this.sessions.size){clearInterval(this.timer??null);this.timer=undefined;}}
  async webSocketError(ws:WebSocket,error:unknown){console.warn('Room WebSocket error',String(error));await this.webSocketClose(ws);}
}
