import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {authFixture} from './auth-fixture.mjs';
import {DEFAULT_APPEARANCE} from '../src/appearance';

// Runs real Worker persistence and WebSocket handling with two disposable engineers.
const {mf,origin}=await authFixture({assets:'dist'});
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1024,height:768}})]);
const [page,other]=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
let clientSocket:WebSocketRoute|undefined;
await page.routeWebSocket('**/api/world',ws=>{clientSocket=ws;ws.connectToServer();});
for(const p of [page,other])p.on('pageerror',e=>errors.push(e.message));
const characters=(p:typeof page)=>p.evaluate(()=>(window as any).ironwood.characters());
async function ready(p:typeof page){
  await p.waitForFunction(()=>(window as any).ironwood?.session().connected);
  if(await p.locator('#intro-look-around').isVisible())await p.locator('#intro-look-around').click();
  else {await expect.poll(async()=>await p.locator('#intro-look-around').isVisible()||await p.evaluate(()=>!document.querySelector<HTMLDialogElement>('#dialog')!.open)).toBe(true);if(await p.locator('#intro-look-around').isVisible())await p.locator('#intro-look-around').click();}
}
try{
  await page.goto(origin);await ready(page);await other.goto(origin);await ready(other);
  const id=await page.evaluate(()=>(window as any).ironwood.session().id);
  const before=await page.evaluate(()=>(window as any).ironwood.snapshot());
  const trigger=page.getByRole('button',{name:'Customize character',exact:true});
  await trigger.click();await expect(page.getByRole('dialog',{name:'Make your mark.'})).toBeVisible();
  await expect(page.getByRole('radio',{name:'Moss',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'Ocean',exact:true}).check();
  await page.getByRole('radio',{name:'Umber',exact:true}).check();
  await page.getByRole('radio',{name:'Canvas',exact:true}).check();
  await page.getByRole('radio',{name:'Silver',exact:true}).check();
  await page.getByRole('radio',{name:'Work cap',exact:true}).check();
  await page.getByRole('checkbox',{name:'Brass goggles'}).check();
  const chosen={skin:'umber',jacket:'ocean',apron:'canvas',hair:'silver',hat:'cap',goggles:true};
  await expect(page.locator('#character-jacket-value')).toHaveText('Ocean');
  assert.deepEqual((await characters(page)).own,DEFAULT_APPEARANCE,'draft leaves world appearance untouched');
  await page.screenshot({path:'.context/character-customization.png'});
  await page.getByRole('button',{name:'Save look',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect.poll(async()=>(await characters(page)).own).toEqual(chosen);
  await expect.poll(async()=>(await characters(other)).crew[id]).toEqual(chosen);
  assert.deepEqual((await characters(other)).own,DEFAULT_APPEARANCE);
  assert.deepEqual(await page.evaluate(()=>(window as any).ironwood.snapshot().inventory),before.inventory);
  await trigger.click();await page.getByRole('button',{name:'Reset look',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual((await characters(page)).own,chosen);
  await page.keyboard.press('KeyV');await expect(page.getByRole('radio',{name:'Ocean',exact:true})).toBeChecked();
  // Native radios support arrows; Escape discards the changed selection and restores focus.
  await page.getByRole('radio',{name:'Ocean',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio',{name:'Rust',exact:true})).toBeChecked();await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();assert.deepEqual((await characters(page)).own,chosen);
  await page.reload();await ready(page);await expect.poll(async()=>(await characters(page)).own).toEqual(chosen);
  await trigger.click();await expect(page.getByRole('radio',{name:'Work cap',exact:true})).toBeChecked();
  // Closing and reopening releases the preview's graphics resources without harming the game.
  for(let i=0;i<3;i++){await page.getByRole('button',{name:'Close dialog',exact:true}).click();await trigger.click();}
  await page.getByRole('button',{name:'Surprise me',exact:true}).click();
  await page.getByRole('button',{name:'Reset look',exact:true}).click();await expect(page.getByRole('radio',{name:'Field hat',exact:true})).toBeChecked();
  for(const viewport of [{width:1024,height:768},{width:390,height:844},{width:320,height:700}]){
    await page.setViewportSize(viewport);
    await page.getByRole('button',{name:'Save look',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Save look',exact:true})).toBeInViewport();
    assert.equal(await page.locator('#dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false,'editor must fit narrow screens');
    await page.screenshot({path:`.context/character-${viewport.width}.png`});
  }
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});await trigger.click();
  // A severed connection keeps the draft and offers a retry, without claiming success.
  await contexts[0].setOffline(true);await clientSocket!.close({code:1012,reason:'Test reconnect recovery'});await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.session().connected)).toBe(false);
  await page.getByRole('button',{name:'Save look',exact:true}).click();await expect(page.locator('#character-feedback')).toContainText('Reconnect');
  await expect(page.getByRole('button',{name:'Save look',exact:true})).toBeEnabled();
  await contexts[0].setOffline(false);await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.session().connected),{timeout:20000}).toBe(true);
  await page.getByRole('button',{name:'Save look',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('CHARACTER BROWSER PASSED: live 3D preview, isolated palettes, all options, real server save, multiplayer rendering, reload, cancel/reset/randomize, keyboard, focus restoration, preview cleanup, responsive layouts and reconnect recovery.');
}catch(error){await page.screenshot({path:'.context/character-failure.png'});console.error(errors);throw error;}
finally{await browser.close();await mf.dispose();}
