import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAuth,digest,type AuthFlow,type AuthSession,type AuthStore} from '../worker/auth';
import {parseXProfile,profileImage,type XProfile} from '../src/identity';
import {SharedWorld} from '../src/open-world';

const origin='https://game.example';
const config={X_CLIENT_ID:'client',X_CLIENT_SECRET:'secret',X_REDIRECT_URI:origin+'/api/auth/x/callback'};
const rawUser={id:'12345',username:'engineer',name:'Engineer 🌲',profile_image_url:'https://pbs.twimg.com/profile_images/1/avatar_normal.jpg',verified:false,verified_type:'blue'};
const profile=parseXProfile({data:rawUser});
class MemoryAuth implements AuthStore {
  flows=new Map<string,AuthFlow>();sessions=new Map<string,AuthSession>();world=new SharedWorld();
  async putAuthFlow(state:string,flow:AuthFlow){this.flows.set(state,flow);}
  async consumeAuthFlow(state:string){const flow=this.flows.get(state);this.flows.delete(state);return flow;}
  async createAuthSession(token:string,profile:XProfile,guestToken:string,expires:number){this.world.accountProfile(profile,guestToken);this.sessions.set(token,{profile,expires});}
  async getAuthSession(token:string){const s=this.sessions.get(token);return s&&s.expires>Date.now()?s:undefined;}
  async deleteAuthSession(token:string){this.sessions.delete(token);}
}
function request(path:string,body?:unknown,headers:Record<string,string>={}){return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
async function begin(store:MemoryAuth,guestToken=''){
  const response=await handleAuth(request('/api/auth/x/start',{guestToken}),config,store);
  assert.equal(response.status,200);
  const url=new URL((await response.json() as {url:string}).url),state=url.searchParams.get('state')!;
  return {response,url,state,cookie:response.headers.get('Set-Cookie')!.split(';')[0]};
}
const callback=(state:string,cookie:string,extra='code=approved')=>request(`/api/auth/x/callback?state=${state}&${extra}`,undefined,{Cookie:cookie});
const mockX=(fn:(url:URL,init?:RequestInit)=>Response|Promise<Response>)=>(async(input:RequestInfo|URL,init?:RequestInit)=>fn(new URL(String(input)),init)) as typeof fetch;

test('X identity uses real verification type and optional expanded affiliation',()=>{
  const p=parseXProfile({data:{...rawUser,affiliation:{user_id:'987',description:'Ironwood'}},includes:{users:[{id:'987',name:'Ironwood',username:'ironwood',profile_image_url:'https://pbs.twimg.com/profile_images/2/org.jpg'}]}});
  assert.equal(p.name,'Engineer 🌲');assert.equal(p.verified,true);assert.equal(p.verifiedType,'blue');assert.equal(p.affiliation?.name,'Ironwood');assert.equal(p.affiliation?.username,'ironwood');
  const guest=parseXProfile({data:{id:'1',name:'Unverified',username:'plain',verified:false}});assert.equal(guest.verified,false);assert.equal(guest.affiliation,undefined);assert.equal(guest.avatarUrl,undefined);
});

test('profile data cannot introduce arbitrary image origins, invalid IDs, or markup URLs',()=>{
  for(const url of ['javascript:alert(1)','http://pbs.twimg.com/a','https://pbs.twimg.com.attacker.example/a','https://attacker.example/a','data:image/svg+xml,a'])assert.equal(profileImage(url),undefined);
  assert.throws(()=>parseXProfile({data:{...rawUser,id:12345}}));assert.throws(()=>parseXProfile({data:{...rawUser,username:'<script>'}}));
  assert.equal(parseXProfile({data:{...rawUser,affiliation:{badge_url:'javascript:alert(1)'}}}).affiliation,undefined);
});

test('first X login preserves the guest inventory, base, ownership, and exploration and revokes its token',()=>{
  const world=new SharedWorld(),guest=world.createProfile('guest-id','guest-secret','Guest');
  guest.inventory={log:71,plank:9};guest.discovered.push('found-site');guest.progress.gathered=10;
  const before=structuredClone(guest),slots=world.nextSlot;
  const linked=world.accountProfile(profile,guest.token);
  assert.equal(linked.id,before.id);assert.deepEqual(linked.base,before.base);assert.deepEqual(linked.inventory,before.inventory);assert.deepEqual(linked.progress,before.progress);assert.deepEqual(linked.discovered,before.discovered);assert.equal(world.nextSlot,slots);
  assert.equal(world.guestProfile('guest-secret'),undefined);assert.equal(world.guestProfile(''),undefined);assert.equal(linked.token,'');
  assert.equal('token' in world.publicPlayer(linked),false);
});

test('returning account wins over a new guest; another account cannot claim a linked base',()=>{
  const world=new SharedWorld(),owner=world.accountProfile(profile);owner.inventory={log:99};
  const guest=world.createProfile('guest','new-guest','Other Guest');
  const returned=world.accountProfile({...profile,username:'new_handle',name:'New name'},guest.token);
  assert.equal(returned.id,owner.id);assert.equal(returned.inventory.log,99);assert.equal(returned.name,'New name');assert.equal(guest.xProfile,undefined);
  const stranger=world.accountProfile({...profile,id:'555'});assert.notEqual(stranger.id,owner.id);
  assert.notEqual(world.guestProfile(guest.token)?.id,owner.id);
});

test('login rejects cross-origin requests, missing config, and mismatched callback origins',async()=>{
  const store=new MemoryAuth();
  assert.equal((await handleAuth(request('/api/auth/x/start',{}, {Origin:'https://evil.example'}),config,store)).status,403);
  assert.equal((await handleAuth(request('/api/auth/x/start',{}),{},store)).status,503);
  assert.equal((await handleAuth(request('/api/auth/x/start',{}),{...config,X_REDIRECT_URI:'https://elsewhere.example/api/auth/x/callback'},store)).status,503);
  assert.equal(store.flows.size,0);
});

test('OAuth uses independent random state, S256 PKCE, HttpOnly cookies, and read-only scopes',async()=>{
  const store=new MemoryAuth(),a=await begin(store,'guest-token'),b=await begin(store);
  assert.notEqual(a.state,b.state);assert.equal(a.url.origin,'https://x.com');assert.equal(a.url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(a.url.searchParams.get('code_challenge'),await digest(store.flows.get(a.state)!.verifier));
  assert.equal(a.url.searchParams.get('scope'),'tweet.read users.read');assert.equal(a.url.searchParams.get('client_secret'),null);
  assert.match(a.response.headers.get('Set-Cookie')!,/__Host-ironwood-oauth=.*HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(a.response.headers.get('Cache-Control'),'no-store');assert.equal(store.flows.get(a.state)?.guestToken,'guest-token');
});

test('OAuth callback validates state and cookie before consuming a one-time login flow',async()=>{
  const store=new MemoryAuth(),a=await begin(store);
  const never=mockX(()=>{throw new Error('Must not contact X');});
  const wrong=await handleAuth(callback(a.state,'__Host-ironwood-oauth='+'z'.repeat(43)),config,store,never);
  assert.equal(wrong.headers.get('Location'),'/?auth=expired');assert.ok(store.flows.has(a.state));
  const cancelled=await handleAuth(callback(a.state,a.cookie,'error=access_denied'),config,store,never);
  assert.equal(cancelled.headers.get('Location'),'/?auth=cancelled');assert.equal(store.flows.size,0);assert.equal(store.sessions.size,0);
  assert.equal((await handleAuth(callback(a.state,a.cookie),config,store,never)).headers.get('Location'),'/?auth=expired');
});

test('expired OAuth state never creates an account',async()=>{
  const store=new MemoryAuth(),a=await begin(store);store.flows.get(a.state)!.expires=Date.now()-1;
  const response=await handleAuth(callback(a.state,a.cookie),config,store,mockX(()=>{throw new Error('Must not fetch');}));
  assert.equal(response.headers.get('Location'),'/?auth=expired');assert.equal(store.sessions.size,0);
});

test('successful code exchange links progress and only returns an opaque session cookie',async()=>{
  const store=new MemoryAuth(),guest=store.world.createProfile('existing-guest','guest-secret','Guest'),a=await begin(store,guest.token);guest.inventory.log=62;
  const verifier=store.flows.get(a.state)!.verifier,paths:string[]=[];
  const response=await handleAuth(callback(a.state,a.cookie),config,store,mockX((url,init)=>{
    paths.push(url.pathname);
    if(url.pathname==='/2/oauth2/token'){
      const body=new URLSearchParams(init!.body as URLSearchParams);assert.equal(body.get('code_verifier'),verifier);assert.equal(body.get('redirect_uri'),config.X_REDIRECT_URI);assert.equal(init?.method,'POST');
      return Response.json({access_token:'PRIVATE_X_ACCESS_TOKEN'});
    }
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer PRIVATE_X_ACCESS_TOKEN');assert.equal(url.searchParams.get('expansions'),'affiliation.user_id');
    return Response.json({data:rawUser});
  }));
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/?auth=success');assert.deepEqual(paths,['/2/oauth2/token','/2/users/me']);
  assert.equal(guest.xProfile?.id,profile.id);assert.equal(guest.inventory.log,62);assert.equal(guest.token,'');
  assert.equal(store.sessions.size,1);assert.equal(JSON.stringify([...response.headers]).includes('PRIVATE_X_ACCESS_TOKEN'),false);
  assert.match(response.headers.get('Set-Cookie')!,/__Host-ironwood-session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  const replay=await handleAuth(callback(a.state,a.cookie),config,store);assert.equal(replay.headers.get('Location'),'/?auth=expired');
});

test('affiliation entitlements can fall back without breaking login; rate limits do not create sessions',async()=>{
  const store=new MemoryAuth(),a=await begin(store);let calls=0;
  const result=await handleAuth(callback(a.state,a.cookie),config,store,mockX(url=>{
    if(url.pathname==='/2/oauth2/token')return Response.json({access_token:'x'});
    calls++;return url.searchParams.has('expansions')?new Response('',{status:403}):Response.json({data:rawUser});
  }));
  assert.equal(result.headers.get('Location'),'/?auth=success');assert.equal(calls,2);
  const limited=new MemoryAuth(),b=await begin(limited);
  const failure=await handleAuth(callback(b.state,b.cookie),config,limited,mockX(url=>url.pathname==='/2/oauth2/token'?Response.json({access_token:'x'}):new Response('',{status:429})));
  assert.equal(failure.headers.get('Location'),'/?auth=failed');assert.equal(limited.sessions.size,0);
});

test('session reads are private, expired sessions are guests, and logout requires same origin',async()=>{
  const store=new MemoryAuth(),token='a'.repeat(43),cookie='__Host-ironwood-session='+token;
  await store.createAuthSession(token,profile,'',Date.now()+10000);
  const current=await handleAuth(request('/api/auth/session',undefined,{Cookie:cookie}),config,store);
  assert.equal((await current.json() as {profile:XProfile}).profile.id,profile.id);assert.equal(current.headers.get('Cache-Control'),'no-store');
  assert.equal((await handleAuth(request('/api/auth/logout',{}, {Cookie:cookie,Origin:'https://evil.example'}),config,store)).status,403);assert.equal(store.sessions.size,1);
  store.sessions.get(token)!.expires=Date.now()-1;
  assert.equal((await (await handleAuth(request('/api/auth/session',undefined,{Cookie:cookie}),config,store)).json() as {profile:unknown}).profile,null);
  const logout=await handleAuth(request('/api/auth/logout',{}, {Cookie:cookie}),config,store);assert.equal(logout.status,200);assert.equal(store.sessions.size,0);assert.match(logout.headers.get('Set-Cookie')!,/Max-Age=0/);
});
