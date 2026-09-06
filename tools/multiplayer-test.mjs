import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const base=process.env.GAME_URL||'http://localhost:8787';
const code=`verify-${crypto.randomUUID().slice(0,12)}`;
const sockets=[];
async function until(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await delay(50);}throw new Error(`Timed out: ${label}`);}
async function join(room,name,token){
  const url=new URL(`/api/rooms/${room}`,base);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(url);sockets.push(ws);
  const c={ws,latest:null,welcome:null,results:[],corrections:[],send:m=>ws.send(JSON.stringify(m))};
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='snapshot')c.latest=m;if(m.type==='welcome')c.welcome=m;if(m.type==='result')c.results.push(m.message);if(m.type==='correction')c.corrections.push(m);});
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  c.send({type:'join',name,token});await until(()=>c.latest&&c.welcome,'join');return c;
}
try{
  assert.equal((await (await fetch(`${base}/api/health`)).json()).multiplayer,true);
  assert.equal((await fetch(`${base}/api/rooms/bad`)).status,400);
  const a=await join(code,'Alice'),b=await join(code,'Bob');
  await until(()=>a.latest.players.length===2,'two players');
  assert.notEqual(a.welcome.id,b.welcome.id);
  assert.ok(a.latest.players.every(p=>!('token' in p)));
  const logs=a.latest.state.inventory.log,count=a.latest.state.buildings.length;
  assert.equal(count,0,'new shared expeditions start without buildings');
  a.send({type:'place',kind:'storage',x:0,z:0,dir:0});b.send({type:'place',kind:'storage',x:0,z:0,dir:0});
  await until(()=>a.latest.state.buildings.length===count+1&&b.latest.state.buildings.length===count+1,'shared building');
  assert.equal(a.latest.state.inventory.log,logs-8);assert.equal(b.latest.state.inventory.log,logs-8);
  await until(()=>[...a.results,...b.results].some(m=>m.includes('occupied')),'concurrent placement rejected');
  const planks=a.latest.state.inventory.plank;
  a.send({type:'craft',recipe:'plank'});b.send({type:'craft',recipe:'plank'});
  await until(()=>a.latest.state.inventory.plank===planks+4&&b.latest.state.inventory.plank===planks+4,'shared crafting');
  a.send({type:'place',kind:'storage',x:20,z:0,dir:0});
  await until(()=>a.results.some(m=>m.includes('closer')),'distance validation');
  a.send({type:'craft',recipe:'__proto__'});await until(()=>a.results.includes('Unknown game action.'),'protocol validation');
  a.send({type:'move',x:40,z:30});await until(()=>a.corrections.length,'teleport rejected');
  const me=a.latest.players.find(p=>p.id===a.welcome.id);await delay(150);
  a.send({type:'move',x:me.x+.6,z:me.z});
  await until(()=>b.latest.players.some(p=>p.id===me.id&&Math.abs(p.x-me.x-.6)<.01),'movement broadcast');
  const isolated=await join(`${code}-b`,'Elsewhere');assert.equal(isolated.latest.state.buildings.length,count);assert.equal(isolated.latest.players.length,1);
  const before=structuredClone(a.latest.state.inventory),token=a.welcome.token,id=a.welcome.id;
  a.ws.close();await until(()=>b.latest.players.length===1,'disconnect cleanup');
  const resumed=await join(code,'Alice',token);assert.equal(resumed.welcome.id,id);assert.deepEqual(resumed.latest.state.inventory,before);
  b.ws.close();resumed.ws.close();await delay(300);
  const returned=await join(code,'Returning',token);assert.equal(returned.latest.state.buildings.length,count+1);assert.deepEqual(returned.latest.state.inventory,before);
  console.log('MULTIPLAYER PASSED: two clients, shared factory/crafting, concurrent spending, proximity and protocol validation, movement, room isolation, reconnect, and saved room return.');
}finally{for(const ws of sockets)ws.close();}
