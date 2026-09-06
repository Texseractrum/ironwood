import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {validMove} from '../src/protocol';
import {CELL} from '../src/data';

const world=new SharedWorld();world.nextSlot=13;
const profile=world.createProfile('movement-test','movement-token','Mountain engineer');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
let socket:WebSocketRoute|undefined,lastMove=Date.now();
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',r=>r.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{socket=ws;ws.onMessage(raw=>{
  const action=JSON.parse(String(raw));
  if(action.type==='join'){
    world.spawnAtBase(profile);lastMove=Date.now();
    ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();
  }else if(action.type==='move'){
    const now=Date.now();
    if(validMove(world.sim,profile,action,Math.max(.1,(now-lastMove)/1000))){profile.x=action.x;profile.z=action.z;world.discover(profile);}
    else ws.send(JSON.stringify({type:'correction',x:profile.x,z:profile.z}));
    lastMove=now;
  }
});});
const timer=setInterval(()=>{world.tick(.1);snapshot();},100);
const state=()=>page.evaluate(()=>(window as any).ironwood.snapshot());
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=> (window as any).ironwood?.session().connected);
  assert.deepEqual((await state()).player,{x:profile.base.x*CELL,z:profile.base.z*CELL});
  const projected=await page.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[profile.base.x,profile.base.z]);
  assert.ok(projected.visible&&Math.abs(projected.x-720)<100&&Math.abs(projected.y-500)<100,'camera is already at the assigned base');
  await page.locator('#intro-look-around').click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.screenshot({path:'.context/spawn-at-home.png'});
  // Deliver a server correction to a known gentle foothill, then use normal input.
  profile.x=0;profile.z=2*CELL;world.discover(profile);
  socket!.send(JSON.stringify({type:'correction',x:profile.x,z:profile.z}));snapshot();
  await expect.poll(async()=>(await state()).player.z).toBe(2*CELL);
  await page.locator('#world').focus();await page.keyboard.down('KeyA');await page.keyboard.down('KeyS');
  await expect.poll(async()=>(await state()).player.z).toBeGreaterThan(2*CELL+.5);
  // Enough walking time to cross this face if collision were missing.
  await page.waitForTimeout(1000);await page.keyboard.up('KeyA');await page.keyboard.up('KeyS');
  const stopped=(await state()).player;
  assert.ok(stopped.z<3.5*CELL,`mountain blocks walking: ${JSON.stringify(stopped)}`);
  assert.equal(world.sim.canWalk(stopped.x,stopped.z),true);
  await page.screenshot({path:'.context/mountain-collision.png'});
  await page.reload();await page.waitForFunction(()=> (window as any).ironwood?.session().connected);
  assert.deepEqual((await state()).player,{x:profile.base.x*CELL,z:profile.base.z*CELL});
  assert.deepEqual(errors,[]);
  console.log('PASS: assigned-base spawn and camera, walking up a textured foothill, blocked mountain face, and return home on reload.');
}finally{clearInterval(timer);await browser.close();}
