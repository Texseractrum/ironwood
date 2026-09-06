import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {authFixture} from './auth-fixture.mjs';

const {mf,worker,origin}=await authFixture();
const sockets=[];
async function until(predicate,label){for(let i=0;i<150;i++){if(predicate())return;await delay(30);}throw new Error('Timed out: '+label);}
async function join({cookie='',token='',extra={}}={}){
  const response=await worker.fetch(origin+'/api/world',{headers:{Upgrade:'websocket',Origin:origin,Cookie:cookie}});
  assert.equal(response.status,101);const ws=response.webSocket;ws.accept();sockets.push(ws);
  const client={ws,welcome:null,world:null,closed:false,results:[]};
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.type==='welcome')client.welcome=message;if(message.type==='world')client.world=message;if(message.type==='result')client.results.push(message.message);});
  ws.addEventListener('close',()=>{client.closed=true;});
  ws.send(JSON.stringify({type:'join',token,...extra}));await until(()=>client.welcome&&client.world,'world join');return client;
}
async function login(guestToken=''){
  const start=await worker.fetch(origin+'/api/auth/x/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({guestToken})});
  assert.equal(start.status,200);const authorization=new URL((await start.json()).url),flowCookie=start.headers.get('Set-Cookie').split(';')[0];
  const callback=await worker.fetch(origin+'/api/auth/x/callback?code=approved&state='+authorization.searchParams.get('state'),{headers:{Cookie:flowCookie},redirect:'manual'});
  assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),'/?auth=success');
  const sessionCookie=callback.headers.getSetCookie().find(cookie=>cookie.startsWith('ironwood-session=')).split(';')[0];
  return {cookie:sessionCookie,callback,flowCookie,authorization};
}
try{
  const board=async(cookie='')=>{const response=await worker.fetch(origin+'/api/leaderboard',{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');return response.json();};
  assert.equal((await board()).total,0);
  assert.equal((await worker.fetch(origin+'/api/leaderboard',{method:'POST'})).status,405);
  for(const page of ['0','-1','1.5','NaN','99999999'])assert.equal((await worker.fetch(origin+'/api/leaderboard?page='+page)).status,400);
  const guest=await join(),id=guest.welcome.id,guestToken=guest.welcome.token;
  assert.equal((await board()).total,0,'guests do not enter the leaderboard');
  const initialPlanks=guest.world.state.inventory.plank;
  guest.ws.send(JSON.stringify({type:'craft',recipe:'plank'}));
  await until(()=>guest.results.some(result=>result.includes('plank')),'earned progress');
  await until(()=>guest.world.state.inventory.plank===initialPlanks+2,'crafted inventory snapshot');
  const inventory=structuredClone(guest.world.state.inventory),base=structuredClone(guest.world.state.base);
  const first=await login(guestToken);await until(()=>guest.closed,'claimed guest disconnected');
  const linked=await board(first.cookie);assert.equal(linked.total,1);assert.equal(linked.own.playerId,id);assert.equal(linked.entries[0].rank,1);assert.equal(linked.entries[0].totalMaterials,151);
  assert.equal(linked.own.totalMaterials,Object.values(inventory).reduce((sum,count)=>sum+count,0));
  assert.equal((await board()).own,null);assert.equal(JSON.stringify(linked).includes(guestToken),false);
  assert.equal((await (await worker.fetch(origin+'/api/leaderboard?accountId=12345&playerId='+id)).json()).own,null,'query parameters cannot impersonate an account');
  const account=await join({cookie:first.cookie});
  assert.equal(account.welcome.id,id);assert.equal(account.welcome.token,'');assert.equal(account.welcome.xProfile.username,'ada_fixture');
  assert.deepEqual(account.world.state.inventory,inventory);assert.deepEqual(account.world.state.base,base);
  const publicPlayer=account.world.players.find(player=>player.id===id);assert.equal(publicPlayer.xProfile.affiliation.name,'Ironwood Guild');assert.equal('token' in publicPlayer,false);
  const attacker=await join({token:guestToken,extra:{xProfile:{id:'12345',verified:true},accountId:'12345'}});
  assert.notEqual(attacker.welcome.id,id);assert.equal(attacker.welcome.xProfile,undefined);
  assert.equal((await board()).total,1,'forged X identity is not ranked');
  const second=await login(attacker.welcome.token),otherDevice=await join({cookie:second.cookie});
  assert.equal(otherDevice.welcome.id,id);assert.deepEqual(otherDevice.world.state.inventory,inventory);await until(()=>account.closed,'one active controller');
  assert.equal((await board(second.cookie)).total,1,'returning login does not duplicate leaderboard entries');
  otherDevice.ws.send(JSON.stringify({type:'rename',name:'Forged Name'}));await until(()=>otherDevice.results.includes('Your name comes from your X profile.'),'account name protected');
  const replay=await worker.fetch(origin+'/api/auth/x/callback?code=approved&state='+first.authorization.searchParams.get('state'),{headers:{Cookie:first.flowCookie},redirect:'manual'});assert.equal(replay.headers.get('Location'),'/?auth=expired');
  assert.equal((await worker.fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.example',Cookie:second.cookie}})).status,403);
  const logout=await worker.fetch(origin+'/api/auth/logout',{method:'POST',headers:{Origin:origin,Cookie:second.cookie}});assert.equal(logout.status,200);await until(()=>otherDevice.closed,'logout disconnects socket');
  const offline=await board(second.cookie);assert.equal(offline.total,1,'offline account remains ranked');assert.equal(offline.own,null,'revoked session does not personalize the leaderboard');assert.equal(offline.entries[0].totalMaterials,151);
  const stale=await join({cookie:second.cookie,token:guestToken});assert.notEqual(stale.welcome.id,id);assert.equal(stale.welcome.xProfile,undefined);
  const session=await worker.fetch(origin+'/api/auth/session',{headers:{Cookie:second.cookie}});assert.equal((await session.json()).profile,null);
  console.log('AUTH INTEGRATION PASSED: real Worker OAuth routes and Durable Object storage, guest progress linking, public X identity, revoked guest token, forged identity rejection, cross-device restoration, single controller, state replay rejection, CSRF, logout socket revocation, and X leaderboard eligibility, identity, method validation and offline retention.');
}finally{for(const socket of sockets)try{socket.close();}catch{}await mf.dispose();}
