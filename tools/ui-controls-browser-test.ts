import {chromium,expect,type Locator,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {isAction} from '../src/protocol';

// All game actions use a disposable world. No real account or chat is modified.
const world=new SharedWorld(),profile=world.createProfile('controls-test','controls-token','Engineer');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(12000);
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
let socket:WebSocketRoute|undefined;
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.route('**/api/leaderboard?*',route=>route.fulfill({json:{entries:[],total:0,page:1,pages:1}}));
let releaseLogin!:()=>void;
const loginReply=new Promise<void>(resolve=>{releaseLogin=resolve;});
await page.route('**/api/auth/x/start',async route=>{await loginReply;await route.fulfill({status:503,json:{error:'Login temporarily unavailable'}});});
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));
    if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
    else if(isAction(action)){const message=world.action(profile,action);if(message)ws.send(JSON.stringify({type:'result',message}));snapshot();}
  });
});
const dialog=page.locator('#dialog');
async function reachable(locator:Locator){
  await expect(locator).toBeInViewport({ratio:1});
  const hit=await locator.evaluate(node=>{
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {reachable:hit===node||node.contains(hit),hit:hit?.outerHTML.slice(0,250),rect:r.toJSON(),viewport:[innerWidth,innerHeight]};
  });
  assert.equal(hit.reachable,true,`${await locator.getAttribute('id')} is not covered by another panel: ${JSON.stringify(hit)}`);
}
async function close(){await page.locator('#close-dialog').click();await expect(dialog).toBeHidden();}
try{
  await page.goto(process.env.PLAY_URL||'http://127.0.0.1:5173');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await page.locator('#intro-look-around').click();
  await expect(page.locator('#pause')).toBeHidden();
  // Space must activate a toolbar button without pausing or moving the game.
  await page.locator('#settings').focus();await page.keyboard.press('Space');
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
  await expect(page.locator('#close-dialog')).toBeFocused();
  const position=await page.evaluate(()=>(window as any).ironwood.snapshot().player);
  await page.getByLabel('Quality',{exact:true}).selectOption('performance');
  await expect(page.locator('#graphics-description')).toContainText('Smoother play');
  await page.getByLabel('Show FPS counter',{exact:true}).check();
  await page.getByLabel('Sound effects',{exact:true}).uncheck();
  await expect(page.locator('#audio-preview')).toBeDisabled();
  await expect(page.locator('#audio-status')).toContainText('Sound is off');
  await page.getByLabel('Sound effects',{exact:true}).check();
  await page.getByLabel('Volume',{exact:true}).fill('0');
  await expect(page.locator('#audio-status')).toContainText('0%');
  await expect(page.locator('#audio-preview')).toBeDisabled();
  await page.getByLabel('Volume',{exact:true}).fill('35');
  await expect(page.locator('#audio-volume-value')).toHaveText('35%');
  await page.locator('#audio-preview').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.audio().lastEffect)).toBe('wood');
  await page.getByLabel('Show contextual hints',{exact:true}).uncheck();
  await page.locator('#reset-hints').click();
  await expect(page.getByLabel('Show contextual hints',{exact:true})).toBeChecked();
  await expect(page.locator('#hints-feedback')).toContainText('Hints will appear again');
  await page.locator('#manual-save').click();
  await expect(page.locator('#settings-save-feedback')).not.toBeEmpty();
  await expect(page.locator('#settings-save-feedback')).toBeInViewport();
  await reachable(page.locator('#close-dialog'));
  const download=page.waitForEvent('download');await page.locator('#export-save').click();
  assert.equal((await download).suggestedFilename(),'ironwood-snapshot.json');
  await expect(page.locator('#settings-save-feedback')).toContainText('Snapshot downloaded');
  await page.locator('#settings-account').click();
  await expect(page.getByRole('dialog',{name:'X account',exact:true})).toBeVisible();
  const loginResponse=page.waitForResponse('**/api/auth/x/start');
  await page.locator('#account-action').click();
  await expect(page.locator('#account-action')).toBeDisabled();
  await page.getByRole('button',{name:'← Back',exact:true}).click();
  releaseLogin();await loginResponse;
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
  await expect(page.getByLabel('Volume',{exact:true})).toHaveValue('35');
  await page.locator('#settings-done').click();
  await expect(page.locator('#settings')).toBeFocused();
  assert.deepEqual(await page.evaluate(()=>(window as any).ironwood.snapshot().player),position,'settings keyboard input does not move the player');
  // Category tabs have one tab stop and support arrow/Home/End navigation.
  await page.getByRole('tab',{name:'Production',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Logistics',exact:true})).toBeFocused();
  await expect(page.locator('#build-items')).toHaveAttribute('aria-labelledby','category-Logistics');
  await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'Power',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'Production',exact:true})).toBeFocused();
  assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(),1);
  await page.locator('#build-toggle').click();await expect(page.locator('#build-toggle')).toHaveAttribute('aria-pressed','true');
  await page.locator('#world').focus();await page.mouse.move(700,400);
  await reachable(page.locator('[data-build]').first());
  await page.locator('#dismantle').click();await expect(page.locator('#dismantle')).toHaveAttribute('aria-pressed','true');
  await page.locator('#inspect-tool').click();await expect(page.locator('#dismantle')).toHaveAttribute('aria-pressed','false');
  await page.locator('#build-toggle').click();
  await page.locator('#world').focus();await page.keyboard.press('KeyL');
  await expect(page.getByRole('dialog',{name:'Leaderboard',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#leaderboard')).toBeFocused();
  await page.locator('#clan-toggle').click();await expect(page.locator('#clan-panel')).toBeVisible();
  await reachable(page.locator('.clan-close'));await page.locator('.clan-close').click();await expect(page.locator('#clan-panel')).toBeHidden();
  // Desktop rail checks; mobile-browser-test.ts covers the touch navigation.
  for(const [width,height] of [[1440,1000],[1024,768]]){
    await page.setViewportSize({width,height});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#world').focus();await page.mouse.move(width/2,height/2);
    for(const id of ['leaderboard','atlas','coop','journey','clan-toggle','sound','customize-character','settings','inventory-craft','build-toggle','inspect-tool','dismantle','craft','chat-toggle','mission-toggle'])await reachable(page.locator('#'+id));
    const rail=await page.locator('.expedition-bar button').evaluateAll(buttons=>buttons.map(button=>{const box=button.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width};}));
    assert.equal(rail.length,5);assert.ok(rail.every((button,index)=>button.x===rail[0].x&&button.width===rail[0].width&&(index===0||button.y>rail[index-1].y)),`navigation is a vertical right rail at ${width}px`);
    assert.equal(await page.locator('.topbar').evaluate(el=>el.scrollWidth>el.clientWidth),false,`header fits ${width}px`);
    if(width<=600)await expect(page.locator('#mission-details')).toBeHidden();
    await page.screenshot({path:`.context/controls-${width}.png`});
    await page.locator('#clan-toggle').click();await expect(page.locator('#clan-panel')).toBeVisible();
    assert.equal(await page.locator('#clan-panel').evaluate(el=>el.scrollWidth>el.clientWidth),false,`clan panel fits ${width}px`);
    await reachable(page.locator('.clan-close'));await page.screenshot({path:`.context/clans-rail-${width}.png`});
    await page.locator('.clan-close').click();await expect(page.locator('#clan-panel')).toBeHidden();
    for(const id of ['settings','leaderboard','atlas','coop','journey','customize-character','craft','help']){
      await page.locator('#'+id).click();await expect(dialog).toBeVisible();
      assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,`${id} fits ${width}px`);
      assert.ok(await dialog.getAttribute('aria-labelledby')||await dialog.getAttribute('aria-label'),`${id} has a dialog name`);
      await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);
      await reachable(page.locator('#close-dialog'));
      if(id==='settings')await page.screenshot({path:`.context/settings-bottom-${width}.png`});
      await close();await expect(page.locator('#'+id)).toBeFocused();
    }
  }
  await page.locator('#settings').click();
  await page.locator('#close-dialog').focus();await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#settings-done')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#close-dialog')).toBeFocused();
  await close();await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await page.locator('#settings').click();
  await expect(page.getByLabel('Quality',{exact:true})).toHaveValue('performance');
  await expect(page.getByLabel('Show FPS counter',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Volume',{exact:true})).toHaveValue('35');
  assert.deepEqual(errors,[]);
  console.log('UI CONTROLS PASSED: desktop navigation and clan panel at 1440/1024px, accessible leaderboard and shortcut, settings persistence, sound preview/mute, inline save/export feedback, account back navigation, native Space activation, category keys, pinned builds, all eight dialogs and HUD hit targets, scrollable close controls, focus trapping/restoration.');
}catch(error){await page.screenshot({path:'.context/controls-failure.png'});throw error;}
finally{await browser.close();}
