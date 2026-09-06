import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';

const base=process.env.GAME_URL||'http://localhost:8787';
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>window.ironwood?.session().connected,null,{timeout:45000});
  const first=await page.evaluate(()=>({state:window.ironwood.snapshot(),session:window.ironwood.session()}));
  const friend=await browser.newPage({viewport:{width:1280,height:900}});friend.on('pageerror',e=>errors.push(e.message));
  await friend.goto(base);await friend.waitForFunction(()=>window.ironwood?.session().connected,null,{timeout:45000});
  await page.waitForFunction(()=>window.ironwood.session().players.length>=2);
  const other=await friend.evaluate(()=>window.ironwood.snapshot());assert.notDeepEqual(first.state.base,other.base);
  await page.locator('#coop').click();await expect(page.getByRole('heading',{name:'Your place on the frontier.'})).toBeVisible();
  await page.getByLabel('Your engineer’s name').fill('Atlas tester');await page.getByRole('button',{name:'Save name',exact:true}).click();
  await friend.waitForFunction(()=>window.ironwood.session().players.some(p=>p.name==='Atlas tester'));
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('#atlas').click();await expect(page.getByRole('heading',{name:'Find your next frontier.'})).toBeVisible();
  await page.getByRole('button',{name:'My base',exact:true}).click();await expect(page.locator('#map-waypoint')).toContainText('My base');
  const center=await page.locator('#map-position').textContent();await page.locator('#atlas-canvas').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('#map-position').textContent(),center);
  await page.keyboard.press('Enter');await expect(page.locator('#map-waypoint')).toContainText('Map destination');
  await page.getByRole('button',{name:'Locate me'}).click();await page.getByLabel('Find a resource').selectOption('crystal');
  const matches=page.locator('#map-resources [data-site]');
  if(await matches.count())for(const button of await matches.all())await expect(button).toContainText('Aether spires');
  else await expect(page.locator('#map-resources')).toContainText('No matching deposits');
  await page.getByLabel('Find a resource').selectOption('all');
  await page.screenshot({path:'.context/shared-world-atlas.png'});
  await page.getByRole('button',{name:'Close dialog'}).click();await page.waitForTimeout(1000);await page.screenshot({path:'.context/shared-world-game.png'});
  const before=await page.evaluate(()=>({id:window.ironwood.session().id,base:window.ironwood.snapshot().base,inventory:window.ironwood.snapshot().inventory}));
  await page.reload();await page.waitForFunction(()=>window.ironwood?.session().connected,null,{timeout:45000});
  const after=await page.evaluate(()=>({id:window.ironwood.session().id,base:window.ironwood.snapshot().base,inventory:window.ironwood.snapshot().inventory}));assert.deepEqual(after,before);
  await page.setViewportSize({width:1024,height:768});await page.keyboard.press('KeyM');await page.screenshot({path:'.context/shared-world-atlas-1024.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('SHARED WORLD BROWSER PASSED: automatic entry, two identities, live name/presence, persistent reload, atlas keyboard/pan/waypoints/filter, responsive layout, no JS errors.');
}catch(error){console.log('BROWSER ERRORS',errors);for(const [i,p] of browser.contexts().flatMap(c=>c.pages()).entries()){console.log('STATE',i,await p.evaluate(()=>({session:window.ironwood?.session(),loading:document.querySelector('#loading')?.textContent,toast:document.querySelector('#toast')?.textContent})));await p.screenshot({path:'.context/shared-world-failure-'+i+'.png'});}throw error;}
finally{await browser.close();}
