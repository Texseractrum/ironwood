import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const base=process.env.GAME_URL||'http://127.0.0.1:8787',sockets=[];
async function until(predicate,label){for(let i=0;i<120;i++){const value=predicate();if(value)return value;await delay(50);}throw new Error(`Timed out: ${label}`);}
async function join(){
  const url=new URL('/api/world',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(url),client={ws,welcome:null,world:null,chats:[],speeches:[],results:[]};sockets.push(ws);
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.type==='welcome')client.welcome=message;if(message.type==='world')client.world=message;if(message.type==='chat')client.chats.push(message.message);if(message.type==='speech')client.speeches.push(message);if(message.type==='result')client.results.push(message.message);});
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.send(JSON.stringify({type:'join',token:''}));await until(()=>client.welcome&&client.world,'world join');return client;
}

try{
  const a=await join(),b=await join(),text=`Hello frontier ${crypto.randomUUID().slice(0,8)}`;
  for(const draft of ['H','He','Hel','He','']){
    const count=b.speeches.length;
    a.ws.send(JSON.stringify({type:'speech',text:draft,done:false,playerId:b.welcome.id}));
    const update=await until(()=>b.speeches.slice(count).find(event=>event.playerId===a.welcome.id),'live typing broadcast');
    assert.equal(update.speech?.text??'',draft);
    if(draft)assert.equal(update.speech.typing,true);
    assert.equal(a.chats.length,0,'keystrokes do not create history entries');
  }
  a.ws.send(JSON.stringify({type:'speech',text:'First live message',done:false}));
  a.ws.send(JSON.stringify({type:'speech',text:'First live message',done:true}));
  await until(()=>b.chats.some(m=>m.text==='First live message'),'finished live message');
  assert.equal(b.chats.filter(m=>m.text==='First live message').length,1);
  await until(()=>b.speeches.some(e=>e.speech?.text==='First live message'&&!e.speech.typing),'finished bubble');
  a.ws.send(JSON.stringify({type:'speech',text:'A quick second message',done:true}));
  await until(()=>b.chats.some(m=>m.text==='A quick second message'),'rapid finish keeps the next history entry');
  await delay(800);
  a.ws.send(JSON.stringify({type:'chat',text:`  ${text}\n  `}));
  const message=await until(()=>a.chats.find(item=>item.text===text),'sender chat broadcast');
  await until(()=>b.chats.some(item=>item.id===message.id),'peer chat broadcast');
  await until(()=>b.world.players.some(player=>player.id===a.welcome.id&&player.speech?.text===text),'overhead speech');
  a.ws.send(JSON.stringify({type:'chat',text:'too soon'}));
  await until(()=>a.results.some(result=>result.includes('moment')),'chat rate limit');
  const returning=await join();assert.ok(returning.welcome.chat.some(item=>item.id===message.id),'recent chat is restored from Durable Object storage');
  const count=b.speeches.length;
  a.ws.send(JSON.stringify({type:'speech',text:'Disconnect clears this',done:false}));
  await until(()=>b.speeches.length>count,'last live draft');a.ws.close();
  await until(()=>!b.world.players.some(p=>p.id===a.welcome.id),'disconnected speech removed');
  console.log('WORLD CHAT PASSED: immediate letters and deletions, author validation, one history entry per message, disconnect cleanup, rate limiting, and persisted history.');
}finally{for(const ws of sockets)ws.close();}
