import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readdir} from 'node:fs/promises';
import path from 'node:path';

// Only this disposable world is seeded. All clan actions run through the real UI/server.
const directory=await mkdtemp('.context/clan-world-'),base='http://127.0.0.1:8792';
let server,browser,serverOutput='';const sockets=[],errors=[];
async function until(fn,label,attempts=200){for(let i=0;i<attempts;i++){if(await fn())return;await delay(100);}throw Error('Timed out: '+label);}
async function start(){
  server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','127.0.0.1','--port','8792','--persist-to',directory],{stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>serverOutput+=b);server.stderr.on('data',b=>serverOutput+=b);
  await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{if(server.exitCode!==null)throw Error(serverOutput);return false;}},'worker ready',300);
}
async function stop(){const current=server;server=undefined;if(!current||current.exitCode!==null)return;const exited=new Promise(resolve=>current.once('exit',resolve));current.kill('SIGTERM');await exited;}
async function join(name,token){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/world');sockets.push(ws);
  const client={ws,welcome:null,latest:null};
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.type==='welcome')client.welcome=m;if(m.type==='world')client.latest=m;};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.send(JSON.stringify({type:'join',name,token}));
  await until(()=>client.welcome&&client.latest,'engineer join');return client;
}
async function files(root){const entries=await readdir(root,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
async function pageFor(token){
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'ironwood-world-identity-v1',value:token}]}]}});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.ironwood?.session().connected,null,{timeout:45000});return page;
}
const state=page=>page.evaluate(()=>window.ironwood.snapshot());
const session=page=>page.evaluate(()=>window.ironwood.session());
async function clickTile(page,x,z){await page.waitForFunction(()=>window.ironwood?.session().connected);const point=await page.evaluate(({x,z})=>window.ironwood.project(x,z),{x,z});assert.ok(point.visible);await page.locator('#world').click({position:{x:point.x,y:point.y}});}

try{
  await start();const alice=await join('Alice'),bob=await join('Bob'),cara=await join('Cara');
  const home=alice.latest.state.base,position=alice.latest.state.player;
  for(const ws of sockets)ws.close();await delay(300);await stop();
  const databases=(await files(directory)).filter(f=>f.endsWith('.sqlite'));
  const database=databases.find(file=>execFileSync('sqlite3',[file,"SELECT name FROM sqlite_master WHERE name='profiles';"],{encoding:'utf8'}).trim()==='profiles');
  assert.ok(database,'isolated world database exists');
  // Place the fixture engineers beside one another without adding a teleport API.
  execFileSync('sqlite3',[database,`UPDATE profiles SET data=json_set(data,'$.x',${position.x+2.3},'$.z',${position.z}) WHERE id='${bob.welcome.id}';`]);
  await start();browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
  const a=await pageFor(alice.welcome.token),b=await pageFor(bob.welcome.token),c=await join('Cara',cara.welcome.token);
  console.log('Two browsers connected. Testing nearby invitations.');
  await expect(a.getByRole('button',{name:'Team up with Bob',exact:true})).toBeVisible();
  await expect(a.getByRole('button',{name:'Team up with Cara',exact:true})).toHaveCount(0);
  const before=await state(a);assert.equal(before.inventory.log,90);
  await a.screenshot({path:'.context/clan-nearby.png'});
  await a.getByRole('button',{name:'Team up with Bob',exact:true}).click();
  await expect(b.getByRole('button',{name:'Accept & share',exact:true})).toBeVisible();
  assert.equal((await state(a)).inventory.log,90);assert.equal((await state(b)).inventory.log,90);
  await b.getByRole('button',{name:'Decline',exact:true}).click();
  await expect(a.getByRole('button',{name:'Team up with Bob',exact:true})).toBeVisible();
  await a.getByRole('button',{name:'Team up with Bob',exact:true}).click();
  await expect(a.getByRole('button',{name:'Cancel invite',exact:true})).toBeVisible();
  await a.getByRole('button',{name:'Cancel invite',exact:true}).click();
  await expect(b.getByRole('button',{name:'Accept & share',exact:true})).toHaveCount(0);
  await a.getByRole('button',{name:'Team up with Bob',exact:true}).click();
  await expect(b.getByRole('button',{name:'Accept & share',exact:true})).toBeVisible();
  await b.screenshot({path:'.context/clan-invitation.png'});
  // Space activates consent without moving the player or pausing the game.
  const accept=b.getByRole('button',{name:'Accept & share',exact:true});await accept.focus();await accept.press('Space');
  await a.waitForFunction(()=>window.ironwood.session().clan?.members.length===2);
  await b.waitForFunction(()=>window.ironwood.session().clan?.members.length===2);
  assert.equal((await state(a)).inventory.log,180);assert.deepEqual((await state(a)).inventory,(await state(b)).inventory);
  assert.equal(c.latest.state.inventory.log,90);
  await expect(a.getByRole('region',{name:'Shared clan inventory',exact:true})).toBeVisible();
  await b.getByRole('button',{name:'Open handcrafting',exact:true}).click();
  await expect(b.getByRole('heading',{name:'A little handiwork.',exact:true})).toBeVisible();
  await b.locator('[data-craft="plank"]').click();await a.waitForFunction(()=>window.ironwood.snapshot().inventory.log===179);
  await b.getByRole('button',{name:'Close dialog',exact:true}).click();
  await b.getByRole('tab',{name:'Logistics',exact:true}).click();
  await b.getByRole('button',{name:'Build Storage chest',exact:true}).click();await clickTile(b,home.x+3,home.z);
  await a.waitForFunction(()=>window.ironwood.snapshot().buildings.some(b=>b.kind==='storage'));
  assert.equal((await state(a)).inventory.log,171);
  await clickTile(a,home.x+3,home.z);await expect(a.getByRole('button',{name:'Collect',exact:true})).toBeVisible();
  await a.getByRole('button',{name:'Close inspector',exact:true}).click();
  await a.getByRole('button',{name:'Dismantle mode',exact:true}).click();await clickTile(a,home.x+3,home.z);
  await b.waitForFunction(()=>window.ironwood.snapshot().buildings.length===0);
  console.log('Shared crafting, teammate building and dismantling passed. Testing persistence.');
  assert.equal((await state(b)).inventory.log,179);
  await a.getByRole('button',{name:'Clan · 2',exact:true}).click();
  await expect(a.locator('.clan-roster')).toContainText('Bob');await a.screenshot({path:'.context/clan-shared.png'});
  await b.close();await expect(a.locator('.clan-roster')).toContainText('Offline');
  const saved=await state(a),clanId=(await session(a)).clan.id;
  await a.reload();await a.waitForFunction(()=>window.ironwood?.session().connected);
  assert.equal((await session(a)).clan.id,clanId);assert.deepEqual((await state(a)).inventory,saved.inventory);
  await a.close();c.ws.close();await delay(300);await stop();await start();
  const restoredA=await pageFor(alice.welcome.token),restoredB=await pageFor(bob.welcome.token);
  assert.equal((await session(restoredA)).clan.id,clanId);
  assert.deepEqual((await state(restoredA)).inventory,saved.inventory);assert.deepEqual((await state(restoredB)).inventory,saved.inventory);
  await restoredA.setViewportSize({width:1024,height:768});await restoredA.getByRole('button',{name:'Clan · 2',exact:true}).click();
  await expect(restoredA.locator('.clan-roster')).toContainText('Bob');await restoredA.screenshot({path:'.context/clan-1024.png'});
  assert.equal(await restoredA.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('CLANS PASSED: nearby discovery, consent/decline/cancel, keyboard acceptance, shared crafting and construction, teammate inspection/refunds, outsider inventory, offline roster, reload and SQLite restart, responsive UI, no application errors.');
}catch(error){
  console.error('Verification failed:',error,'Application errors:',errors,'Worker:',serverOutput.slice(-6000));
  if(browser)for(const [i,page] of browser.contexts().flatMap(c=>c.pages()).entries()){console.error('Page',i,await page.evaluate(()=>({status:window.ironwood?.session().status,connected:window.ironwood?.session().connected,toast:document.querySelector('#toast')?.textContent})).catch(()=>''));await page.screenshot({path:'.context/clan-failure-'+i+'.png',timeout:5000}).catch(()=>{});}
  throw error;
}finally{for(const ws of sockets)ws.close();await browser?.close();await stop();}
