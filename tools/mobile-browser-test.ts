import {chromium,expect,type Locator,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {isAction} from '../src/protocol';
import {Simulation} from '../src/simulation';
import {CELL} from '../src/data';

// Disposable transport: checks cannot send chat or change a real workshop.
const world=new SharedWorld(),profile=world.createProfile('mobile-test','mobile-token','Mobile engineer');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
const page=await context.newPage(),errors:string[]=[],actions:any[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{(window as any).touchEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,event=>{const e=event as PointerEvent;(window as any).touchEvents.push([type,(e.target as HTMLElement).id,e.pointerId,e.pointerType]);},true);});
let socket:WebSocketRoute|undefined;
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',r=>r.fulfill({json:{enabled:false}}));
await page.route('**/api/leaderboard?*',r=>r.fulfill({json:{entries:[],total:0,page:1,pages:1}}));
await page.routeWebSocket('**/api/world',ws=>{socket=ws;ws.onMessage(raw=>{
  const action=JSON.parse(String(raw));actions.push(action);
  if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
  else if(action.type==='move'){profile.x=action.x;profile.z=action.z;world.discover(profile);}
  else if(isAction(action)){const message=world.action(profile,action);if(message)ws.send(JSON.stringify({type:'result',message}));snapshot();}
});});
const timer=setInterval(()=>{world.tick(.1);snapshot();},100);
const state=()=>page.evaluate(()=>(window as any).ironwood.snapshot());
async function reachable(locator:Locator){
  await expect(locator).toBeInViewport({ratio:1});
  const result=await locator.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:node===hit||node.contains(hit),width:r.width,height:r.height,id:node.id};});
  assert.ok(result.hit,`${result.id} is not covered`);
  assert.ok(result.width>=44&&result.height>=44,`${result.id} has a 44px touch target: ${JSON.stringify(result)}`);
}
const cdp=await context.newCDPSession(page);
const point=async(selector:string)=>{const r=await page.locator(selector).boundingBox();assert.ok(r);return {x:r.x+r.width/2,y:r.y+r.height/2};};
async function touch(type:string,touchPoints:{x:number;y:number;id:number}[]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints});}
async function closeDialog(){await page.locator('#close-dialog').tap();await expect(page.locator('#dialog')).toBeHidden();}
try{
  await page.goto(process.env.PLAY_URL||'http://127.0.0.1:5173');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await expect(page.locator('.intro-controls')).toContainText('thumb stick');
  await page.locator('#intro-look-around').tap();
  await expect(page.locator('#dialog')).toBeHidden();
  assert.equal(await page.evaluate(()=>(window as any).ironwood.diagnostics().graphics.quality),'performance');
  await expect(page.locator('#mission-details')).toBeHidden();
  await page.screenshot({path:'.context/mobile-portrait.png'});
  const start=(await state()).player,pad=await point('#mobile-joystick');
  await touch('touchStart',[{...pad,id:1}]);
  await touch('touchMove',[{x:pad.x+44,y:pad.y,id:1}]);
  await expect.poll(async()=>Math.hypot((await state()).player.x-start.x,(await state()).player.z-start.z)).toBeGreaterThan(.3);
  const gather=await point('#mobile-gather');
  await touch('touchStart',[{x:pad.x+44,y:pad.y,id:1},{...gather,id:2}]);
  await touch('touchEnd',[{...gather,id:2}]);
  await expect.poll(()=>actions.filter(a=>a.type==='gather').length).toBe(1);
  const attack=await point('#combat-attack');
  await touch('touchStart',[{x:pad.x+44,y:pad.y,id:1},{...attack,id:2}]);
  await touch('touchEnd',[{...attack,id:2}]);
  await expect.poll(()=>actions.filter(a=>a.type==='attack').length).toBe(1);
  await touch('touchCancel',[]);
  const stopped=(await state()).player;
  await page.waitForTimeout(200);assert.deepEqual((await state()).player,stopped,'cancelled touch stops movement');
  await page.locator('#combat-attack').tap();await expect.poll(()=>actions.some(a=>a.type==='attack')).toBe(true);

  for(const [width,height] of [[320,568],[390,844],[844,390],[1024,768]]){
    await page.setViewportSize({width,height});
    for(const selector of ['#mobile-build','#mobile-menu-toggle','#mobile-chat','#mobile-joystick','#mobile-gather','#combat-attack'])await reachable(page.locator(selector));
    assert.equal(await page.locator('.topbar').evaluate(n=>n.scrollWidth>n.clientWidth),false,`header fits ${width}`);
    await page.locator('#mobile-build').tap();await expect(page.locator('.build-dock')).toBeVisible();
    await expect(page.locator('#mobile-joystick')).toBeHidden();
    await page.getByRole('button',{name:'Build Lumber camp',exact:true}).tap();
    await expect(page.locator('.build-dock')).toBeHidden();
    await reachable(page.locator('#mobile-rotate'));await reachable(page.locator('#mobile-cancel'));
    await page.locator('#mobile-rotate').tap();await page.locator('#mobile-cancel').tap();
    await expect(page.locator('#mobile-build-actions')).toBeHidden();
    await page.locator('#mobile-chat').tap();await reachable(page.locator('#chat-input'));await reachable(page.locator('#chat-close'));
    assert.equal(await page.locator('#chat-input').evaluate(n=>getComputedStyle(n).fontSize),'16px');
    await page.locator('#chat-close').tap();
    for(const id of ['settings','atlas','journey','leaderboard','coop','customize-character','craft','help']){
      const control=page.locator(`[data-mobile-control="${id}"]`);
      if(!await control.isVisible())await page.locator('#mobile-menu-toggle').tap();
      await control.tap();await expect(page.locator('#dialog')).toBeVisible();
      assert.equal(await page.locator('#dialog').evaluate(n=>n.scrollWidth>n.clientWidth),false,`${id} fits ${width}`);
      await page.locator('#dialog').evaluate(n=>n.scrollTop=n.scrollHeight);
      await reachable(page.locator('#close-dialog'));await closeDialog();
    }
    await page.locator('#mobile-menu-toggle').tap();await page.locator('[data-mobile-control="clan-toggle"]').tap();
    await reachable(page.locator('.clan-close'));await page.locator('.clan-close').tap();
    await page.screenshot({path:`.context/mobile-${width}.png`});
  }
  // A resize during a drag cannot leave movement held down.
  const pad2=await point('#mobile-joystick');
  await touch('touchStart',[{...pad2,id:1}]);await touch('touchMove',[{x:pad2.x-40,y:pad2.y,id:1}]);
  await page.setViewportSize({width:390,height:844});await touch('touchCancel',[]);
  const afterResize=(await state()).player;await page.waitForTimeout(200);assert.deepEqual((await state()).player,afterResize);

  // Find valid, exposed ground using the real simulation, then place through touch UI.
  const sim=new Simulation(world.snapshot(profile)),cx=Math.round(profile.x/CELL),cz=Math.round(profile.z/CELL);
  const candidates:{x:number;z:number}[]=[];
  for(let x=cx-4;x<=cx+4;x++)for(let z=cz-4;z<=cz+4;z++)if(!sim.placementError('storage',x,z))candidates.push({x,z});
  await page.locator('#mobile-build').tap();await page.getByRole('tab',{name:'Logistics',exact:true}).tap();
  await page.getByRole('button',{name:'Build Storage chest',exact:true}).tap();
  await page.locator('#mobile-rotate').tap();
  const visible=await page.evaluate(tiles=>tiles.map(tile=>({...tile,point:(window as any).ironwood.project(tile.x,tile.z)})).filter(tile=>document.elementFromPoint(tile.point.x,tile.point.y)?.id==='world'),candidates);
  assert.ok(visible.length,'valid ground is visible');const tile=visible[Math.floor(visible.length/2)];
  await page.touchscreen.tap(tile.point.x,tile.point.y);
  await expect.poll(()=>world.sim.at(tile.x,tile.z)?.kind).toBe('storage');
  const placed=actions.filter(a=>a.type==='place').at(-1);assert.equal(world.sim.at(tile.x,tile.z)?.dir,placed.dir);
  assert.equal(placed.dir,1,'rotation changes the placed output direction');
  await page.locator('#mobile-cancel').tap();
  await page.touchscreen.tap(tile.point.x,tile.point.y);await expect(page.locator('#inspector')).toContainText('chest');
  await reachable(page.locator('#close-inspector'));await page.locator('#close-inspector').tap();
  await page.locator('#mobile-build').tap();await page.locator('#dismantle').tap();
  await page.touchscreen.tap(tile.point.x,tile.point.y);await expect.poll(()=>world.sim.at(tile.x,tile.z)).toBeUndefined();
  await page.locator('#mobile-cancel').tap();

  // A held touch draws a complete conveyor route and cancels without spending.
  const beltSim=new Simulation(world.snapshot(profile));
  const starts=candidates.filter(tile=>[0,1,2].every(dx=>!beltSim.placementError('conveyor',tile.x+dx,tile.z)));
  await page.locator('#mobile-build').tap();await page.getByRole('button',{name:'Build Conveyor',exact:true}).tap();
  const routes=await page.evaluate(tiles=>tiles.map(tile=>[0,1,2].map(dx=>(window as any).ironwood.project(tile.x+dx,tile.z))).filter(points=>points.every(point=>document.elementFromPoint(point.x,point.y)?.id==='world')),starts);
  assert.ok(routes.length,'a short route is visible');const route=routes[0],beforeBelts=actions.filter(a=>a.type==='conveyors').length;
  await touch('touchStart',[{...route[0],id:1}]);await touch('touchMove',[{...route[2],id:1}]);
  await touch('touchCancel',[]);assert.equal(actions.filter(a=>a.type==='conveyors').length,beforeBelts);
  await touch('touchStart',[{...route[0],id:1}]);await touch('touchMove',[{...route[2],id:1}]);await touch('touchEnd',[]);
  await expect.poll(()=>actions.filter(a=>a.type==='conveyors').length).toBe(beforeBelts+1);
  assert.equal(world.sim.state.buildings.filter(b=>b.kind==='conveyor').length,3);
  await page.locator('#mobile-cancel').tap();

  await page.locator('[data-mobile-control="atlas"]').tap();
  const map=await point('#atlas-canvas'),mapBefore=await page.locator('#map-position').textContent();
  await touch('touchStart',[{...map,id:1}]);await touch('touchMove',[{x:map.x+30,y:map.y,id:1}]);await touch('touchEnd',[]);
  await expect(page.locator('#map-position')).not.toHaveText(mapBefore!);await closeDialog();
  await page.screenshot({path:'.context/mobile-portrait.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: multi-touch movement + gather/attack, cancellation, touch targets, placement/rotation/inspection/dismantling, conveyor drags/cancellation, map panning, chat, menus, eight dialogs, and portrait/landscape/tablet layouts.');
}catch(error){await page.screenshot({path:'.context/mobile-failure.png'});console.error({errors,events:await page.evaluate(()=>(window as any).touchEvents.slice(-25))});throw error;}
finally{clearInterval(timer);await browser.close();}
