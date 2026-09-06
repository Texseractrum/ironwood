import {parseXProfile,type XProfile} from '../src/identity';

export interface AuthConfig {X_CLIENT_ID?:string;X_CLIENT_SECRET?:string;X_REDIRECT_URI?:string}
export interface AuthFlow {verifier:string;guestToken:string;redirectUri:string;expires:number}
export interface AuthSession {profile:XProfile;expires:number}
export interface AuthStore {
  putAuthFlow(state:string,flow:AuthFlow):Promise<void>;
  consumeAuthFlow(state:string):Promise<AuthFlow|undefined>;
  createAuthSession(token:string,profile:XProfile,guestToken:string,expires:number):Promise<void>;
  getAuthSession(token:string):Promise<AuthSession|undefined>;
  deleteAuthSession(token:string):Promise<void>;
}
export const SESSION_SECONDS=30*24*60*60;
const FLOW_SECONDS=10*60;
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function digest(value:string){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function cookieName(request:Request,kind:string){return `${new URL(request.url).protocol==='https:'?'__Host-':''}ironwood-${kind}`;}
export function readAuthCookie(request:Request,kind='session'){
  const name=cookieName(request,kind)+'=';
  const value=request.headers.get('Cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(name))?.slice(name.length);
  return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:'';
}
function cookie(request:Request,kind:string,value:string,seconds:number){return `${cookieName(request,kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function json(body:unknown,status=200){return Response.json(body,{status,headers});}
function configured(request:Request,env:AuthConfig){
  if(!env.X_CLIENT_ID||!env.X_CLIENT_SECRET||!env.X_REDIRECT_URI)return false;
  try{const redirect=new URL(env.X_REDIRECT_URI);return redirect.origin===new URL(request.url).origin&&redirect.pathname==='/api/auth/x/callback'&&!redirect.search&&!redirect.hash;}catch{return false;}
}
function completed(request:Request,result:string,session?:string){
  const response=new Response(null,{status:303,headers:{...headers,Location:`/?auth=${result}`}});
  response.headers.append('Set-Cookie',cookie(request,'oauth','',0));
  if(session)response.headers.append('Set-Cookie',cookie(request,'session',session,SESSION_SECONDS));
  return response;
}

/** OAuth runs entirely on the Worker. X tokens never reach browser storage or game messages. */
export async function handleAuth(request:Request,env:AuthConfig,store:AuthStore,fetchX:typeof fetch=fetch):Promise<Response> {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/auth/session'&&request.method==='GET'){
    const token=readAuthCookie(request),session=token?await store.getAuthSession(token):undefined;
    return json({enabled:configured(request,env),profile:session?.profile??null});
  }
  if(path==='/api/auth/logout'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin)return json({error:'Please sign out from the game.'},403);
    const token=readAuthCookie(request);if(token)await store.deleteAuthSession(token);
    const response=json({ok:true});response.headers.append('Set-Cookie',cookie(request,'session','',0));return response;
  }
  if(path==='/api/auth/x/start'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin)return json({error:'Please start login from the game.'},403);
    if(!configured(request,env))return json({error:'X login is not available yet. You can keep playing as a guest.'},503);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Invalid login request.'},415);
    const raw=await request.text();if(raw.length>1024)return json({error:'Invalid login request.'},413);
    let guestToken='';
    try{const body=JSON.parse(raw);if(typeof body?.guestToken==='string'&&body.guestToken.length<=128)guestToken=body.guestToken;}catch{return json({error:'Invalid login request.'},400);}
    const state=random(),verifier=random(),redirectUri=env.X_REDIRECT_URI!;
    await store.putAuthFlow(state,{verifier,guestToken,redirectUri,expires:Date.now()+FLOW_SECONDS*1000});
    const authorize=new URL('https://x.com/i/oauth2/authorize');
    authorize.search=new URLSearchParams({response_type:'code',client_id:env.X_CLIENT_ID!,redirect_uri:redirectUri,scope:'tweet.read users.read',state,code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
    const response=json({url:authorize.href});response.headers.append('Set-Cookie',cookie(request,'oauth',state,FLOW_SECONDS));return response;
  }
  if(path==='/api/auth/x/callback'&&request.method==='GET'){
    const state=url.searchParams.get('state');
    if(!state||state!==readAuthCookie(request,'oauth'))return completed(request,'expired');
    const flow=await store.consumeAuthFlow(state);
    if(!flow||flow.expires<=Date.now()||flow.redirectUri!==env.X_REDIRECT_URI)return completed(request,'expired');
    if(url.searchParams.has('error'))return completed(request,'cancelled');
    const code=url.searchParams.get('code');if(!code||code.length>2048||!configured(request,env))return completed(request,'failed');
    try{
      const tokenResponse=await fetchX('https://api.x.com/2/oauth2/token',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${btoa(`${encodeURIComponent(env.X_CLIENT_ID!)}:${encodeURIComponent(env.X_CLIENT_SECRET!)}`)}`},
        body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:flow.redirectUri,code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)
      });
      if(!tokenResponse.ok)return completed(request,'failed');
      const token=await tokenResponse.json() as {access_token?:unknown};if(typeof token.access_token!=='string')return completed(request,'failed');
      const userUrl=new URL('https://api.x.com/2/users/me');
      userUrl.search=new URLSearchParams({'user.fields':'profile_image_url,verified,verified_type,affiliation',expansions:'affiliation.user_id'}).toString();
      const init={headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)};
      let userResponse=await fetchX(userUrl,init);
      // Some app entitlements omit affiliation. The core profile can still authenticate.
      if(userResponse.status===400||userResponse.status===403){userUrl.search=new URLSearchParams({'user.fields':'profile_image_url,verified,verified_type'}).toString();userResponse=await fetchX(userUrl,{...init,signal:AbortSignal.timeout(15000)});}
      if(!userResponse.ok)return completed(request,'failed');
      const profile=parseXProfile(await userResponse.json()),session=random();
      await store.createAuthSession(session,profile,flow.guestToken,Date.now()+SESSION_SECONDS*1000);
      return completed(request,'success',session);
    }catch{return completed(request,'failed');}
  }
  return json({error:'Not found.'},404);
}
