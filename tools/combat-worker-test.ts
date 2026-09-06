import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';
import {Simulation} from '../src/simulation';
import {validMove,type ServerMessage} from '../src/protocol';

const directory=await mkdtemp('.context/combat-storage-');
const port=await new Promise<number>(resolve=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const port=(probe.address() as {port:number}).port;probe.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`;
let server:ChildProcess|undefined;const sockets:WebSocket[]=[];
async function until(fn:()=>unknown|Promise<unknown>,label:string,seconds=15){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){if(await fn())return;await delay(75);}throw new Error(`Timed out: ${label}`);}
async function start(){
  const processHandle=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','127.0.0.1','--port',String(port),'--persist-to',directory],{stdio:['ignore','pipe','pipe']});server=processHandle;
  let output='';processHandle.stdout!.on('data',b=>output+=b);processHandle.stderr!.on('data',b=>output+=b);
  await until(async()=>{if(processHandle.exitCode!==null)throw new Error(output);try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'Worker startup',30);
}
async function stop(){const child=server;server=undefined;if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}
async function join(name:string,token?:string){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/world');sockets.push(ws);
  const client={ws,latest:undefined as Extract<ServerMessage,{type:'world'}>|undefined,welcome:undefined as Extract<ServerMessage,{type:'welcome'}>|undefined,events:[] as ServerMessage[],send:(message:unknown)=>ws.send(JSON.stringify(message))};
  ws.onmessage=e=>{const message=JSON.parse(String(e.data)) as ServerMessage;if(message.type==='world')client.latest=message;else if(message.type==='welcome')client.welcome=message;else client.events.push(message);};
  await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=reject;});client.send({type:'join',name,token});await until(()=>client.latest&&client.welcome,'join');return client;
}
// Find a walkable route using the same terrain/collision rules as the client.
function route(sim:Simulation,from:{x:number;z:number},to:{x:number;z:number}){
  type Node={gx:number;gz:number;x:number;z:number;score:number;previous?:Node};
  const first:Node={gx:0,gz:0,...from,score:0},pending=[first],seen=new Set(['0,0']);
  let finish:Node|undefined;
  for(let step=0;pending.length&&step<30000;step++){
    pending.sort((a,b)=>a.score+Math.hypot(a.x-to.x,a.z-to.z)-b.score-Math.hypot(b.x-to.x,b.z-to.z));const current=pending.shift()!;
    if(Math.hypot(current.x-to.x,current.z-to.z)<2.2&&validMove(sim,current,to,.5)){finish=current;break;}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const gx=current.gx+dx,gz=current.gz+dz,key=`${gx},${gz}`;if(seen.has(key)||Math.abs(gx)>130||Math.abs(gz)>50)continue;seen.add(key);
      const next={gx,gz,x:from.x+gx*.8,z:from.z+gz*.8,score:current.score+Math.hypot(dx,dz)*.8,previous:current};
      if(validMove(sim,current,next,.5))pending.push(next);
    }
  }
  assert.ok(finish,'a walkable path connects neighboring bases');const result:{x:number;z:number}[]=[];
  for(let node:Node|undefined=finish;node;node=node.previous)result.unshift({x:node.x,z:node.z});return result;
}
try{
  await start();const a=await join('Combat Alice'),b=await join('Combat Bob');
  await until(()=>a.latest!.players.length===2,'presence');
  assert.equal(a.latest!.state.combat!.health,100);assert.equal(b.latest!.state.combat!.health,100);
  a.send({type:'attack',angle:Math.PI/2});
  await until(()=>b.events.some(e=>e.type==='combat'&&!e.event.target&&e.event.attacker.id===a.welcome!.id),'replicated empty swing');
  assert.equal(a.latest!.state.combat!.health,100);assert.equal(b.latest!.state.combat!.health,100);
  await until(()=>a.latest!.state.mobs!.length>0||b.latest!.state.mobs!.length>0,'server-generated creatures');
  const home=a.latest!.state.base!,away={x:home.x*2.3+3,z:home.z*2.3};await delay(550);a.send({type:'move',...away});await until(()=>Math.abs(a.latest!.state.player.x-away.x)<.01,'leave home center');
  b.send({type:'craft',recipe:'sword'});await until(()=>b.latest!.state.combat!.weapon==='sword','weapon auto-equip');
  const sim=new Simulation(b.latest!.state),path=route(sim,b.latest!.state.player,away);
  let i=0;
  while(i<path.length-1){
    const current=b.latest!.state.player;let next=i+1;
    while(next+1<path.length&&validMove(sim,current,path[next+1],.5))next++;
    await delay(530);b.send({type:'move',...path[next]});
    await until(()=>Math.hypot(b.latest!.state.player.x-path[next].x,b.latest!.state.player.z-path[next].z)<.1,'approach opponent');i=next;
  }
  const victim=a.welcome!.id,attacker=b.welcome!.id;
  for(const health of [72,44,16,0]){
    await until(()=>b.latest!.state.time>=b.latest!.state.combat!.attackReady,'weapon cooldown');
    b.send({type:'attack',target:{kind:'player',id:victim},damage:100000});
    await until(()=>a.latest!.state.combat!.health===health,`authoritative health ${health}`);
  }
  assert.equal(a.latest!.state.combat!.deaths,1);assert.equal(b.latest!.players.find(p=>p.id===victim)!.combat!.health,0);
  assert.ok(a.events.some(e=>e.type==='combat'&&e.event.killed));assert.equal(b.latest!.state.combat!.kills,1);
  const inventory=structuredClone(a.latest!.state.inventory),corpse={...a.latest!.state.player};
  a.send({type:'craft',recipe:'club'});a.send({type:'move',x:corpse.x+.5,z:corpse.z});
  await until(()=>a.events.some(e=>e.type==='result'&&e.message.includes('respawning')),'dead action rejection');
  assert.deepEqual(a.latest!.state.inventory,inventory);assert.deepEqual(a.latest!.state.player,corpse);
  await until(()=>a.latest!.state.combat!.health===100,'respawn',7);
  assert.deepEqual(a.latest!.state.player,{x:home.x*2.3,z:home.z*2.3});assert.deepEqual(a.latest!.state.inventory,inventory);
  assert.ok(a.events.some(e=>e.type==='respawn'));assert.ok(a.latest!.state.combat!.protectedUntil>a.latest!.state.time);
  b.send({type:'attack',target:{kind:'player',id:victim}});await until(()=>b.events.some(e=>e.type==='result'&&e.message.includes('protection')),'spawn shield');
  const tokenA=a.welcome!.token,tokenB=b.welcome!.token;for(const ws of sockets)ws.close();await delay(400);await stop();await start();
  const restored=await join('Alice restored',tokenA),killer=await join('Bob restored',tokenB);
  assert.equal(restored.welcome!.id,victim);assert.equal(killer.welcome!.id,attacker);
  assert.equal(restored.latest!.state.combat!.deaths,1);assert.equal(killer.latest!.state.combat!.kills,1);assert.equal(killer.latest!.state.combat!.weapon,'sword');
  assert.deepEqual(restored.latest!.state.inventory,inventory);
  console.log('COMBAT WORKER PASSED: actual WebSockets, generated mobs, validated movement, craft/equip, server damage, death lockout, base respawn, protection, SQLite restart persistence.');
}finally{for(const ws of sockets)ws.close();await stop();}
