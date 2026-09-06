import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {isAction,validMove} from '../src/protocol';
import {CELL} from '../src/data';
import {chunkScenery} from '../src/scenery';

// Use the actual shared-world simulation in an isolated transport fixture.
const world=new SharedWorld(),profile=world.createProfile('gather-test','gather-test-token','Field engineer');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
let socket:WebSocketRoute,lastMove=Date.now();
const snapshot=()=>socket.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
world.sim.onGather=strike=>socket.send(JSON.stringify({type:'gathered',playerId:profile.id,strike}));
await page.route('**/api/auth/session',r=>r.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{socket=ws;ws.onMessage(raw=>{
  const a=JSON.parse(String(raw));
  if(a.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
  else if(a.type==='move'){
    const now=Date.now();
    if(validMove(world.sim,{x:profile.x,z:profile.z},a,Math.max(.1,(now-lastMove)/1000))){profile.x=a.x;profile.z=a.z;world.discover(profile);}
    else ws.send(JSON.stringify({type:'correction',x:profile.x,z:profile.z}));
    lastMove=now;
  }else if(isAction(a)){ws.send(JSON.stringify({type:'result',message:world.action(profile,a)}));snapshot();}
});});
const timer=setInterval(()=>{world.tick(.1);if(socket)snapshot();},100);
const state=()=>page.evaluate(()=>(window as any).ironwood.snapshot());
const animation=()=>page.evaluate(()=>(window as any).ironwood.gathering());
const held=new Set<string>();
async function release(){for(const key of held)await page.keyboard.up(key);held.clear();}
async function moveTo(x:number,z:number){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const p=(await state()).player,dx=x-p.x,dz=z-p.z;if(Math.hypot(dx,dz)<.2){await release();return;}
    const sx=dx-dz,sy=dx+dz,wanted=new Set<string>();
    if(Math.abs(sx)>Math.abs(sy)*.414)wanted.add(sx>0?'KeyD':'KeyA');
    if(Math.abs(sy)>Math.abs(sx)*.414)wanted.add(sy>0?'KeyS':'KeyW');
    for(const key of held)if(!wanted.has(key)){await page.keyboard.up(key);held.delete(key);}
    for(const key of wanted)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
    await page.waitForTimeout(35);
  }
  throw new Error(`Could not reach ${x},${z}; player=${JSON.stringify((await state()).player)}`);
}
async function clickTile(x:number,z:number){
  const p=await page.evaluate(([x,z])=>{
    for(const [dx,dz] of [[0,0],[.35,-.35],[-.35,.35],[.35,.35],[-.35,-.35]]){
      const p=(window as any).ironwood.project(x+dx,z+dz);
      if(document.elementFromPoint(p.x,p.y)?.id==='world')return p;
    }
  },[x,z]);assert.ok(p,'a visible part of the target tile must be clickable');await page.mouse.click(p.x,p.y);
}
async function ready(){await expect.poll(async()=>{const s=await state();return s.time>=s.miningReady;}).toBe(true);}
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await page.locator('#intro-look-around').click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.screenshot({path:'.context/resources-relief-overview.png'});
  await page.locator('#world').focus();
  await moveTo(14*CELL,20*CELL);
  const logs=(await state()).inventory.log;
  await page.keyboard.press('KeyE');
  await expect.poll(async()=>(await animation()).tool,{intervals:[20]}).toBe('axe');
  await page.waitForFunction(()=>{const a=(window as any).ironwood.gathering();return a.phase>=.2&&a.active;});
  await expect.poll(async()=>(await state()).inventory.log).toBe(logs+5);
  await Promise.all([page.screenshot({path:'.context/gather-axe.png'}),expect.poll(async()=>(await animation()).chips,{intervals:[20]}).toBe(14)]);
  await expect.poll(async()=>(await animation()).active).toBe(false);
  await moveTo(16*CELL,18*CELL);await moveTo(19*CELL,15*CELL);await moveTo(21*CELL,13*CELL);
  await ready();await page.keyboard.press('KeyE');
  await expect.poll(async()=>(await animation()).tool,{intervals:[20]}).toBe('pickaxe');
  await page.waitForFunction(()=>{const a=(window as any).ironwood.gathering();return a.phase>=.2&&a.active;});
  await expect.poll(async()=>(await state()).inventory.copper).toBe(5);
  await page.screenshot({path:'.context/gather-pickaxe.png'});
  await ready();await clickTile(21,11);
  await expect.poll(async()=>(await state()).inventory.copper).toBe(10);
  await expect.poll(async()=>(await animation()).active).toBe(false);
  // A real blueprint click and ground pick must place the drill through its outcrops.
  await page.locator('.build-dock').hover();
  await page.getByRole('tab',{name:'Production',exact:true}).click();
  await page.getByRole('button',{name:'Build Mineral drill',exact:true}).click();
  await clickTile(21,11);
  await expect.poll(()=>world.sim.at(21,11)?.kind).toBe('quarry');
  assert.equal(world.sim.remaining(world.sim.siteAt(21,11)!),690);
  for(const n of chunkScenery(0,0).filter(n=>n.siteId==='p:0:0:8'))assert.equal(world.sim.sceneryVisible(n),false);
  await page.keyboard.press('Escape');await clickTile(21,11);
  await expect(page.locator('#inspector')).toContainText('Mineral drill');
  await page.screenshot({path:'.context/copper-drill-on-deposit.png'});
  const before=(await state()).inventory.copper;await page.keyboard.press('KeyE');await page.waitForTimeout(250);
  assert.equal((await state()).inventory.copper,before,'no hand-mining through a machine');
  await page.keyboard.press('KeyX');await clickTile(21,11);
  await expect.poll(()=>world.sim.at(21,11)).toBeUndefined();await page.keyboard.press('Escape');await ready();
  const returned=(await state()).inventory.copper;await clickTile(21,11);
  await expect.poll(async()=>(await state()).inventory.copper).toBe(returned+5);
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  assert.equal((await state()).deposits['p:0:0:8'],685);
  assert.deepEqual(errors,[]);
  console.log('PASS: terrain render, movement, axe and pickaxe animations, impact chips, E and click gathering, copper discovery, drill placement over outcrops, building inspection, dismantling, continued mining and reload.');
}catch(error){await page.screenshot({path:'.context/terrain-gather-failure.png'});console.error({errors,player:(await state()).player,toast:await page.locator('#toast').textContent(),animation:await animation()});throw error;}
finally{clearInterval(timer);await release();await browser.close();}
