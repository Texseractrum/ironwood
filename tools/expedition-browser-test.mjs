import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';

const base=process.env.GAME_URL||'http://localhost:8787';
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>!!window.ironwood);
  await page.keyboard.press('KeyM');await expect(page.getByRole('heading',{name:'Beyond the workshop.'})).toBeVisible();
  await page.screenshot({path:'.context/expedition-atlas.png'});
  await page.locator('[data-site="coal-west"]').click();await expect(page.locator('#toast')).toContainText('Waypoint set');
  await page.keyboard.press('KeyC');await expect(page.locator('[data-craft="pickaxe"]')).toBeDisabled();await expect(page.locator('[data-craft="circuit"]')).toBeDisabled();
  await page.getByRole('button',{name:'Close dialog'}).click();
  const solo=await page.evaluate(()=>window.ironwood.snapshot().inventory);
  await page.locator('#coop').click();await page.getByLabel('Your name').fill('Ada');await page.getByRole('button',{name:'Create expedition'}).click();
  await page.waitForFunction(()=>window.ironwood.session().connected,{timeout:20000});
  const room=await page.evaluate(()=>window.ironwood.session().room);
  const friend=await browser.newPage({viewport:{width:1440,height:1000}});friend.on('pageerror',e=>errors.push(e.message));
  await friend.goto(`${base}/?room=${room}`);await friend.waitForFunction(()=>!!window.ironwood);
  await friend.getByLabel('Your name').fill('Grace');await friend.getByRole('button',{name:'Join expedition'}).click();
  await friend.waitForFunction(()=>window.ironwood.session().players.length===2);
  await page.waitForFunction(()=>window.ironwood.session().players.length===2);
  await page.getByRole('tab',{name:'Logistics'}).click();await page.getByRole('button',{name:'Build Storage chest',exact:true}).click();
  const point=await page.evaluate(()=>window.ironwood.project(1,0));await page.mouse.click(point.x,point.y);
  await friend.waitForFunction(()=>window.ironwood.snapshot().buildings.some(b=>b.kind==='storage'&&b.x===1&&b.z===0));
  await page.keyboard.press('Escape');
  await page.keyboard.down('KeyD');await page.waitForTimeout(600);await page.keyboard.up('KeyD');
  await page.screenshot({path:'.context/expedition-coop.png'});
  await page.locator('#coop').click();await page.getByRole('button',{name:'Return to solo'}).click();
  assert.deepEqual(await page.evaluate(()=>window.ironwood.snapshot().inventory),solo);
  await friend.waitForFunction(()=>window.ironwood.session().players.length===1);
  await page.setViewportSize({width:1024,height:768});await page.screenshot({path:'.context/expedition-1024.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('EXPEDITION BROWSER PASSED: atlas, waypoints, locked rare crafting, two browsers, shared placement, movement, solo preservation, responsive layout.');
}catch(error){
  for(const [index,page] of browser.contexts().flatMap(context=>context.pages()).entries()){
    console.log('BROWSER FAILURE STATE',index,await page.evaluate(()=>({session:window.ironwood?.session(),dialog:document.querySelector('dialog')?.open,heading:document.querySelector('#dialog-content h2')?.textContent,buttons:[...document.querySelectorAll('#dialog-content button')].map(b=>b.textContent),toast:document.querySelector('#toast')?.textContent})));
    await page.screenshot({path:`.context/deploy-browser-failure-${index}.png`});
  }
  throw error;
}finally{await browser.close();}
