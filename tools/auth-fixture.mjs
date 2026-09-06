// Isolated local Worker fixture. No live X requests, production data, or auth bypass routes.
import {build} from 'esbuild';
import {Miniflare,Response,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

export async function authFixture({port=0,assets}={}){
  const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
  const options={
    port,host:'127.0.0.1',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',
    durableObjects:{WORLD:{className:'SharedWorldObject',useSQLite:true},ROOMS:{className:'GameRoom',useSQLite:true}},
    bindings:{X_CLIENT_ID:'fixture-client',X_CLIENT_SECRET:'fixture-secret',X_REDIRECT_URI:''},
    serviceBindings:{ASSETS:async request=>{
      if(!assets)return new Response('Test fixture');
      const root=resolve(assets),pathname=decodeURIComponent(new URL(request.url).pathname),file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+'/'))return new Response('Not found',{status:404});
      try{const body=await readFile(file);return new Response(body,{headers:{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.glb':'model/gltf-binary','.png':'image/png'})[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
    }},
    outboundService:async request=>{
      const url=new URL(request.url);
      if(url.origin!=='https://api.x.com')return new Response('Unexpected provider',{status:500});
      if(url.pathname==='/2/oauth2/token')return Response.json({access_token:'fixture-access-token'});
      if(url.pathname==='/2/users/me')return Response.json({data:{id:'12345',name:'Ada Lovelace',username:'ada_fixture',verified:true,verified_type:'blue',profile_image_url:'https://pbs.twimg.com/profile_images/fixture/avatar.jpg',affiliation:{user_id:'987',description:'Ironwood Guild',badge_url:'https://pbs.twimg.com/profile_images/fixture/org.jpg'}},includes:{users:[{id:'987',name:'Ironwood Guild',username:'guild_fixture'}]}});
      return new Response('Not found',{status:404});
    }
  };
  const mf=new Miniflare(convertV4MiniflareOptions(options)),url=await mf.ready,origin=url.origin;
  options.port=Number(url.port);options.bindings.X_REDIRECT_URI=origin+'/api/auth/x/callback';
  await mf.setOptions(convertV4MiniflareOptions(options));
  return {mf,worker:{fetch:mf.dispatchFetch.bind(mf)},origin};
}
