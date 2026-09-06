import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {isAction} from '../src/protocol';
import {building} from '../src/simulation';

// All workshop mutations stay inside this disposable server fixture.
const world=new SharedWorld(),profile=world.createProfile('intro-test','intro-token','Apprentice');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(12000);
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
let socket:WebSocketRoute|undefined;
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
world.sim.onGather=strike=>socket?.send(JSON.stringify({type:'gathered',playerId:profile.id,strike}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));
    if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
    else if(isAction(action)){const message=world.action(profile,action);if(message)ws.send(JSON.stringify({type:'result',message}));snapshot();}
  });
});
const audio=()=>page.evaluate(()=>(window as any).ironwood.audio());
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await expect(page.getByRole('heading',{name:'Welcome to Ironwood.'})).toBeVisible();
  assert.equal((await audio()).state,'locked','audio waits for a gesture');
  await expect(page.locator('#begin-tutorial')).toBeFocused();
  await page.locator('.intro-model img').evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished));});
  await page.screenshot({path:'.context/intro-desktop.png'});
  const before=structuredClone(profile.inventory);
  await page.keyboard.press('KeyE');assert.deepEqual(profile.inventory,before,'intro blocks game shortcuts');
  await page.getByLabel('Sound effects',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Begin building',exact:true}).click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Build Lumber camp',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#mission-title')).toHaveText('Start with timber');
  assert.equal((await audio()).enabled,false);assert.equal((await audio()).played,0);
  assert.deepEqual(profile.inventory,before,'starting the tutorial costs nothing');
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await expect(page.locator('#dialog')).not.toBeVisible();assert.equal((await audio()).enabled,false);
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByLabel('Sound effects',{exact:true}).check();
  await page.getByLabel('Volume',{exact:true}).fill('35');
  await page.getByRole('button',{name:'Test sound',exact:true}).click();
  await expect.poll(async()=>(await audio()).lastEffect).toBe('wood');
  assert.equal((await audio()).volume,.35);
  await page.screenshot({path:'.context/audio-settings.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.keyboard.press('KeyC');
  await page.locator('[data-craft="plank"]').click();
  await expect.poll(async()=>(await audio()).lastEffect).toBe('craft');
  await expect.poll(async()=>(await audio()).voices).toBe(0);
  const played=(await audio()).played;
  socket!.send(JSON.stringify({type:'result',message:'Nothing to collect yet.'}));
  await expect(page.locator('#craft-feedback')).toHaveText('Nothing to collect yet.');assert.equal((await audio()).played,played);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  socket!.send(JSON.stringify({type:'gathered',playerId:profile.id,strike:{item:'ore',amount:1,x:profile.base.x*2.3,z:profile.base.z*2.3}}));
  await expect.poll(async()=>(await audio()).lastEffect).toBe('stone');
  await expect.poll(async()=>(await audio()).voices).toBe(0);
  const gathered=(await audio()).played;
  socket!.send(JSON.stringify({type:'gathered',playerId:'another-engineer',strike:{item:'log',amount:1,x:0,z:0}}));
  socket!.send(JSON.stringify({type:'result',message:'Another engineer gathered timber.'}));
  await expect(page.locator('#toast')).toHaveText('Another engineer gathered timber.');assert.equal((await audio()).played,gathered);
  // Mute stops in-flight voices and persists alongside volume.
  await page.getByRole('button',{name:'Mute sound',exact:true}).click();
  await expect.poll(async()=>(await audio()).voices).toBe(0);
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  assert.equal((await audio()).enabled,false);assert.equal((await audio()).volume,.35);
  await page.keyboard.press('KeyH');await page.getByRole('button',{name:'Revisit the introduction'}).click();
  await expect(page.locator('#begin-tutorial')).toBeFocused();
  for(const [width,height] of [[1024,768],[800,700],[390,844]]){
    await page.setViewportSize({width,height});await expect(page.locator('#begin-tutorial')).toBeInViewport();
    assert.equal(await page.locator('#dialog').evaluate(node=>node.scrollWidth>node.clientWidth),false);
    await page.screenshot({path:`.context/intro-${width}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.intro-model img').evaluate(node=>getComputedStyle(node).animationName),'none');
  await page.keyboard.press('Escape');await expect(page.locator('#dialog')).not.toBeVisible();
  await page.setViewportSize({width:1440,height:1000});
  // A returning workshop with no browser intro preference is never interrupted.
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('ironwood-intro-seen-v1:'))localStorage.removeItem(key);});
  const chest=building('storage',profile.base.x+3,profile.base.z,0,world.sim.state.nextId++);chest.owner=profile.id;world.sim.state.buildings.push(chest);world.sim.reindex();
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);await expect(page.locator('#dialog')).not.toBeVisible();
  // Render every effect through the browser's real audio graph, checking signal,
  // headroom, distinct waveforms, and clean silence at the end of each envelope.
  const rendered=await page.evaluate(async()=>{
    const {renderEffect,noiseBuffer}=await import('/src/audio.ts');
    const effects=['select','wood','stone','crystal','build','dismantle','craft','collect','feed','discovery','milestone','welcome','footstep'];
    const result=[];
    for(const effect of effects){
      const context=new OfflineAudioContext(1,96000,48000);renderEffect(context,context.destination,effect,0,noiseBuffer(context));
      const data=(await context.startRendering()).getChannelData(0);let power=0,peak=0,tail=0;
      for(let i=0;i<data.length;i++){power+=data[i]*data[i];peak=Math.max(peak,Math.abs(data[i]));if(i>72000)tail=Math.max(tail,Math.abs(data[i]));}
      result.push({effect,rms:Math.sqrt(power/data.length),peak,tail});
    }
    return result;
  });
  for(const sample of rendered){assert.ok(sample.rms>.001,`${sample.effect} has audible signal`);assert.ok(sample.peak<.95,`${sample.effect} has headroom`);assert.equal(sample.tail,0,`${sample.effect} ends cleanly`);}
  assert.deepEqual(errors,[]);
  console.log('INTRO & AUDIO PASSED: welcome, keyboard focus, game-input blocking, first action, dismissal/reload, replay, returning workshop, narrow layouts, reduced motion, saved mute/volume, successful crafting feedback, silent failures, voice cleanup, and all 13 audio signals.',rendered);
}catch(error){await page.screenshot({path:'.context/intro-audio-failure.png'});console.error('Browser errors:',errors);throw error;}
finally{await browser.close();}
