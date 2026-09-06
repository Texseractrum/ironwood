import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';

// An isolated local world exercises actual SQLite restoration across process restarts.
const directory=await mkdtemp('.context/world-storage-');
const port=await new Promise((resolve,reject)=>{const probe=createServer();probe.on('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,sockets=[];let server;
async function until(fn,label,attempts=160){for(let i=0;i<attempts;i++){if(await fn())return;await delay(100);}throw Error('Timed out: '+label);}
async function start(){
  server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','127.0.0.1','--port',String(port),'--persist-to',directory],{stdio:['ignore','pipe','pipe']});
  let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  await until(async()=>{if(server.exitCode!==null)throw Error(output);try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'worker ready',300);
}
async function stop(){const process=server;server=undefined;if(!process||process.exitCode!==null)return;const exited=new Promise(resolve=>process.once('exit',resolve));process.kill('SIGTERM');await exited;await delay(300);}
async function join(name,token){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/world');sockets.push(ws);
  const c={ws,latest:null,welcome:null,results:[],corrections:[],strikes:[],send:m=>ws.send(JSON.stringify(m))};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='world')c.latest=m;if(m.type==='welcome')c.welcome=m;if(m.type==='result')c.results.push(m.message);if(m.type==='correction')c.corrections.push(m);if(m.type==='gathered')c.strikes.push(m);};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});c.send({type:'join',name,token});await until(()=>c.latest&&c.welcome,'join');return c;
}
try{
  await start();
  assert.equal((await (await fetch(base+'/api/health')).json()).world,'ironwood');
  assert.equal((await fetch(base+'/api/world')).status,426);
  const a=await join('Alice'),b=await join('Bob');await until(()=>a.latest.players.length===2,'shared presence');
  const appearance={skin:'umber',jacket:'ocean',apron:'canvas',hair:'silver',hat:'cap',goggles:true};
  a.send({type:'customize',appearance,id:b.welcome.id});
  await until(()=>b.latest.players.find(p=>p.id===a.welcome.id)?.appearance?.jacket==='ocean','appearance broadcast');
  assert.deepEqual(b.latest.players.find(p=>p.id===a.welcome.id).appearance,appearance);
  assert.equal(b.latest.players.find(p=>p.id===b.welcome.id).appearance.jacket,'moss');
  a.send({type:'customize',appearance:{...appearance,hat:'unknown'}});
  await until(()=>a.results.some(m=>m.includes('available option')),'invalid appearance rejected');
  assert.notDeepEqual(a.latest.state.base,b.latest.state.base);assert.ok(a.latest.players.every(p=>!('token' in p)));
  assert.ok(Math.hypot(a.latest.state.player.x-b.latest.state.player.x,a.latest.state.player.z-b.latest.state.player.z)<=32*2.3+2,'new engineers spawn about ten seconds apart at sprint speed');
  const logs=a.latest.state.inventory.log,baseA=a.latest.state.base;
  assert.deepEqual(a.latest.state.player,{x:baseA.x*2.3,z:baseA.z*2.3},'spawn directly at home');
  // Step away from the flag before placing a chest at the center of the base.
  for(let i=1;i<=5;i++){
    await delay(180);a.send({type:'move',x:baseA.x*2.3,z:baseA.z*2.3+i});
    await until(()=>Math.abs(a.latest.state.player.z-baseA.z*2.3-i)<.01,`clear construction site (step ${i})`);
  }
  a.send({type:'place',kind:'storage',x:baseA.x,z:baseA.z,dir:0});
  await until(()=>a.latest.state.buildings.length===1,'construction');
  assert.equal(a.latest.state.inventory.log,logs-8);assert.equal(b.latest.state.inventory.log,logs);
  const chest=a.latest.state.buildings[0];assert.equal(chest.owner,a.welcome.id);
  await until(()=>b.latest.state.buildings.some(m=>m.id===chest.id),'neighbor receives nearby construction from their spawn');
  a.send({type:'place',kind:'storage',x:baseA.x+1,z:baseA.z,dir:0});
  await until(()=>b.latest.state.buildings.filter(m=>m.owner===a.welcome.id).length===2,'new construction arrives live');
  b.send({type:'dismantle',id:chest.id});await until(()=>b.results.some(m=>m.includes('owner')),'ownership enforced');
  b.send({type:'place',kind:'storage',x:baseA.x+1,z:baseA.z,dir:0});await until(()=>b.results.some(m=>m.includes('another engineer')),'home protection');
  const planks=b.latest.state.inventory.plank;a.send({type:'craft',recipe:'plank'});await until(()=>a.latest.state.inventory.plank===planks+2,'personal crafting');assert.equal(b.latest.state.inventory.plank,planks);
  a.send({type:'move',x:1e6,z:1e6});await until(()=>a.corrections.length>0,'teleport rejection');
  const pos={...a.latest.state.player};await delay(200);a.send({type:'move',x:pos.x+.5,z:pos.z});
  await until(()=>b.latest.players.some(p=>p.id===a.welcome.id&&Math.abs(p.x-pos.x-.5)<.01),'live movement');
  // Authorized gathering reaches both the miner's animation and nearby observers.
  const destination={x:(baseA.x-2)*2.3,z:(baseA.z+4)*2.3};
  while(Math.hypot(a.latest.state.player.x-destination.x,a.latest.state.player.z-destination.z)>.05){
    const p=a.latest.state.player,dx=destination.x-p.x,dz=destination.z-p.z,d=Math.hypot(dx,dz),step=Math.min(1,d);
    const next={x:p.x+dx/d*step,z:p.z+dz/d*step};await delay(180);a.send({type:'move',...next});
    await until(()=>Math.hypot(a.latest.state.player.x-next.x,a.latest.state.player.z-next.z)<.05,'approach timber');
  }
  const timber=a.latest.state.inventory.log;
  a.send({type:'gather',target:`p:${Math.floor(baseA.x/32)}:${Math.floor(baseA.z/32)}:5`});
  await until(()=>a.strikes.length===1&&b.strikes.length===1,'gathering broadcast');
  assert.equal(a.strikes[0].playerId,a.welcome.id);assert.equal(a.strikes[0].strike.item,'log');assert.equal(a.strikes[0].strike.amount,5);
  await until(()=>a.latest.state.inventory.log===timber+5,'gathering inventory');
  const resultCount=a.results.length;a.send({type:'gather',target:`p:${Math.floor(baseA.x/32)}:${Math.floor(baseA.z/32)}:5`});
  await until(()=>a.results.length>resultCount,'cooldown response');assert.equal(a.strikes.length,1);assert.equal(b.strikes.length,1);
  const token=a.welcome.token,id=a.welcome.id,before=structuredClone(a.latest.state.inventory);
  a.ws.close();await until(()=>b.latest.players.length===1,'disconnect');
  const resumed=await join('Returning',token);assert.equal(resumed.welcome.id,id);assert.deepEqual(resumed.latest.state.base,baseA);assert.deepEqual(resumed.latest.state.inventory,before);
  assert.ok(Math.hypot(resumed.latest.state.player.x-baseA.x*2.3,resumed.latest.state.player.z-baseA.z*2.3)<2,'return beside the occupied home center');
  for(const ws of sockets)ws.close();await delay(400);await stop();await start();
  const restored=await join('Restored',token);assert.equal(restored.welcome.id,id);assert.deepEqual(restored.latest.state.inventory,before);assert.deepEqual(restored.latest.state.base,baseA);assert.equal(restored.latest.state.buildings[0].id,chest.id);
  assert.deepEqual(restored.latest.players.find(p=>p.id===id).appearance,appearance,'outfit persists through an actual SQLite restart');
  assert.equal(restored.latest.population,2,'reconnect never allocates another base');
  console.log('SHARED WORLD PASSED: public presence, distinct persistent bases, personal inventory, live movement/construction, successful gathering broadcasts, cooldowns, ownership, protected claims, protocol checks, reconnect, and SQLite process-restart recovery.');
}finally{for(const ws of sockets)ws.close();await stop();}
