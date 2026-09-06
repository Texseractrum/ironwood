import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {authFixture} from './auth-fixture.mjs';

const {mf,origin}=await authFixture({assets:'.context/x-auth-assets'});
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const page=await context.newPage(),errors=[];let cancel=true;
async function configure(ctx){
  await ctx.route('https://x.com/i/oauth2/authorize?**',route=>{
    const url=new URL(route.request().url());assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    return route.fulfill({status:302,headers:{Location:origin+'/api/auth/x/callback?state='+url.searchParams.get('state')+(cancel?'&error=access_denied':'&code=approved')}});
  });
  await ctx.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#496851"/><text x="40" y="52" text-anchor="middle" fill="#f4edda" font-size="40" font-family="Georgia">A</text></svg>'}));
}
async function ready(p){await p.waitForFunction(()=>window.ironwood?.session().connected||document.getElementById('loading')?.textContent?.includes('could not be loaded'),{timeout:30000});assert.ok(await p.evaluate(()=>window.ironwood?.session().connected),'Game must load and connect');}
try{
  await configure(context);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error('Browser console:',m.text());});
  await page.goto(origin);await ready(page);
  const prompt=page.getByRole('button',{name:'Log in with X to save progress',exact:true});await expect(prompt).toBeVisible();
  const guest=await page.evaluate(()=>({session:window.ironwood.session(),state:window.ironwood.snapshot()}));
  await expect(page.locator('#save-state')).toContainText('Guest');
  await page.screenshot({path:'.context/x-auth-guest.png'});
  const position=await page.locator('.nameplate-own').getAttribute('style');
  await page.keyboard.down('KeyD');await page.waitForTimeout(500);await page.keyboard.up('KeyD');
  await expect.poll(()=>page.locator('.nameplate-own').getAttribute('style')).not.toBe(position);
  // Cancel consent and verify the same guest survives the round trip.
  await prompt.click();await page.waitForURL(origin+'/?auth=cancelled');await ready(page);
  await expect(page.locator('#toast')).toContainText('Login cancelled');assert.equal(await page.evaluate(()=>window.ironwood.session().id),guest.session.id);
  cancel=false;
  await prompt.focus();await page.keyboard.press('Enter');await page.waitForURL(origin+'/?auth=success');await ready(page);
  const account=page.getByRole('button',{name:'Account: Ada Lovelace, @ada_fixture',exact:true});await expect(account).toBeVisible();
  assert.equal(await page.evaluate(()=>window.ironwood.session().id),guest.session.id);
  assert.deepEqual(await page.evaluate(()=>window.ironwood.snapshot().inventory),guest.state.inventory);
  await expect(account.getByRole('img',{name:'Verified on X',exact:true})).toBeVisible();
  await expect(account.getByRole('img',{name:'Affiliated with Ironwood Guild',exact:true})).toBeVisible();
  const cookies=await context.cookies();const sessionCookie=cookies.find(c=>c.name==='ironwood-session');assert.ok(sessionCookie?.httpOnly);assert.equal(sessionCookie.sameSite,'Lax');
  assert.equal(await page.evaluate(()=>localStorage.getItem('ironwood-world-identity-v1')),null);
  await expect(page.locator('#save-state')).toContainText('@ada_fixture');
  await page.screenshot({path:'.context/x-auth-signed-in-fixture.png'});
  await account.click();await expect(page.getByRole('dialog',{name:'X account'})).toBeVisible();
  await expect(page.getByRole('link',{name:'View X profile'})).toHaveAttribute('href','https://x.com/ada_fixture');
  await page.getByRole('button',{name:'Log out',exact:true}).click();await expect(prompt).toBeVisible();await expect(prompt).toBeEnabled();await ready(page);
  await expect.poll(()=>page.evaluate(()=>window.ironwood.session().id)).not.toBe(guest.session.id);
  // A separate browser with no guest token restores the same X-owned base.
  const otherContext=await browser.newContext({viewport:{width:1024,height:768}});await configure(otherContext);const other=await otherContext.newPage();other.on('pageerror',e=>errors.push(e.message));
  await other.goto(origin);await ready(other);await other.getByRole('button',{name:'Log in with X to save progress',exact:true}).click();await other.waitForURL(origin+'/?auth=success');await ready(other);
  assert.equal(await other.evaluate(()=>window.ironwood.session().id),guest.session.id);
  assert.deepEqual(await other.evaluate(()=>window.ironwood.snapshot().inventory),guest.state.inventory);
  await expect(other.getByRole('button',{name:'Account: Ada Lovelace, @ada_fixture',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.ironwood.session().players.some(p=>p.xProfile?.username==='ada_fixture'))).toBe(true);
  await other.screenshot({path:'.context/x-auth-1024-fixture.png'});
  await other.setViewportSize({width:768,height:900});await expect(other.getByRole('button',{name:'Account: Ada Lovelace, @ada_fixture',exact:true})).toBeVisible();
  assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // An unavailable provider leaves the guest in the world and explains the failure.
  await page.route('**/api/auth/x/start',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'X login is not available yet. You can keep playing as a guest.'})}));
  await prompt.click();await expect(page.locator('#toast')).toContainText('X login is not available yet');await expect(prompt).toBeEnabled();
  assert.deepEqual(errors,[]);
  console.log('AUTH BROWSER PASSED: moving prompt, keyboard login, cancelled consent, X profile and badges, HttpOnly cookie, guest migration, logout, cross-browser recovery, multiplayer profile broadcast, 1024/768 layouts, unavailable provider and no page errors. Provider responses use local fixtures.');
}catch(error){console.error('Browser diagnostics:',errors,await page.evaluate(()=>({loading:document.getElementById('loading')?.textContent,session:window.ironwood?.session()})));await page.screenshot({path:'.context/x-auth-failure.png'});throw error;}
finally{await browser.close();await mf.dispose();}
