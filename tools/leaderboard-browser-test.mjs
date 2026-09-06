import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {authFixture} from './auth-fixture.mjs';

// Real local OAuth/Worker for eligibility; clearly labeled response fixtures for large lists.
const {mf,origin}=await authFixture({assets:'dist'});
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('https://x.com/i/oauth2/authorize?**',route=>{
  const state=new URL(route.request().url()).searchParams.get('state');
  return route.fulfill({status:302,headers:{Location:origin+'/api/auth/x/callback?state='+state+'&code=approved'}});
});
await context.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#496851"/><text x="40" y="52" text-anchor="middle" fill="#f4edda" font-size="40" font-family="Georgia">A</text></svg>'}));
const trigger=page.getByRole('button',{name:'Leaderboard',exact:true});
const dialog=page.getByRole('dialog',{name:'Leaderboard',exact:true});
const status=page.locator('#leaderboard-status');
let fail=false,fixture,requests=0,release;
await page.route('**/api/leaderboard?*',async route=>{
  requests++;
  if(release)await new Promise(resolve=>{release=resolve;});
  if(fail)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Fixture outage"}'});
  if(fixture){
    const current=Number(new URL(route.request().url()).searchParams.get('page')||1);
    return route.fulfill({json:{entries:fixture.slice((current-1)*50,current*50),total:fixture.length,page:current,pages:Math.ceil(fixture.length/50),own:fixture.at(-1)}});
  }
  return route.continue();
});
async function ready(){
  await page.waitForFunction(()=>window.ironwood?.session().connected);
  if(await page.locator('#intro-look-around').isVisible())await page.locator('#intro-look-around').click();
}
try{
  await page.clock.install();
  await page.goto(origin);await page.waitForFunction(()=>window.ironwood?.session().connected);
  await page.getByRole('button',{name:'Look around first',exact:true}).click();
  // Initial failure is announced and retry recovers to an honest empty state.
  fail=true;await trigger.focus();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
  await expect(status).toContainText('Couldn’t load');await expect(page.locator('#leaderboard-empty')).toBeHidden();
  await expect(page.getByRole('button',{name:'Close dialog',exact:true})).toBeFocused();
  fail=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(status).toContainText('0 X engineers');
  await expect(page.locator('#leaderboard-empty')).toBeVisible();await expect(page.locator('.leaderboard-table')).toBeHidden();
  await page.screenshot({path:'.context/leaderboard-empty.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.id),'dialog','focus stays in the modal');
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(dialog).toBeHidden();
  // Visible loading feedback while the real response is pending.
  release=true;await trigger.click();await expect(status).toHaveText('Loading leaderboard…');
  const unblock=release;release=undefined;unblock();await expect(status).toContainText('0 X engineers');
  await page.getByRole('button',{name:'Log in with X',exact:true}).click();await page.waitForURL(origin+'/?auth=success');await ready();
  await trigger.click();await expect(status).toContainText('1 X engineer');
  await expect(page.locator('#leaderboard-rows tr')).toHaveCount(1);await expect(page.locator('.leaderboard-own')).toContainText('@ada_fixture · You');
  await expect(page.locator('#leaderboard-membership')).toContainText('Your rank · #1');
  await expect(dialog.getByRole('columnheader',{name:'Materials',exact:true})).toBeVisible();
  await expect(page.locator('#leaderboard-membership')).toContainText('150 materials');
  await expect(page.locator('.leaderboard-own .leaderboard-score')).toHaveText('150');
  await expect(dialog.getByRole('img',{name:'Verified on X',exact:true})).toBeVisible();
  await expect(dialog.getByRole('img',{name:'Affiliated with Ironwood Guild',exact:true})).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveAttribute('href','https://x.com/ada_fixture');
  await expect(page.locator('#leaderboard-login')).toHaveCount(0);
  await page.screenshot({path:'.context/leaderboard-signed-in-fixture.png'});
  const real=await (await context.request.get(origin+'/api/leaderboard')).json(),own=real.own;
  fixture=Array.from({length:51},(_,i)=>({rank:i+1,playerId:'fixture-'+i,profile:{id:String(9000+i),username:'engineer_'+(i+1),name:['Rowan Fielding','Mira Stone','Jules Hart'][i%3],verified:false,verifiedType:'none'},totalMaterials:12500-i*200,clan:i%3===0?'The Foundry':undefined}));
  fixture[1].profile.name='<img src=x onerror=alert(1)> & Engineer';
  fixture[2].profile.name='A very long engineer name that should fit a small phone screen';
  fixture[50]={...own,rank:51,totalMaterials:80};
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(status).toContainText('51 X engineers');
  await expect(page.locator('#leaderboard-rows tr')).toHaveCount(50);
  await expect(page.locator('#leaderboard-membership')).toContainText('Your rank · #51');
  await expect(page.locator('#leaderboard-rows')).toContainText('<img src=x onerror=alert(1)> & Engineer');
  assert.equal(await page.locator('#leaderboard-rows img[src="x"]').count(),0,'profile names render as text');
  await expect(page.getByRole('button',{name:'Previous',exact:true})).toHaveAttribute('aria-disabled','true');
  await page.screenshot({path:'.context/leaderboard-ranked-fixture.png'});
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('#leaderboard-page')).toHaveText('Page 2 of 2');
  await expect(page.locator('#leaderboard-rows tr')).toHaveCount(1);await expect(page.locator('.leaderboard-own')).toContainText('51');
  await expect(page.getByRole('button',{name:'Next',exact:true})).toHaveAttribute('aria-disabled','true');
  fail=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(status).toContainText('Showing the last results');await expect(page.locator('.leaderboard-own')).toContainText('80');
  fail=false;fixture[50].totalMaterials=100;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(status).toContainText('51 X engineers');await expect(page.locator('.leaderboard-own .leaderboard-score')).toHaveText('100');
  await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page.locator('#leaderboard-page')).toHaveText('Page 1 of 2');
  for(const viewport of [{width:1024,height:768},{width:390,height:844},{width:320,height:700}]){
    await page.setViewportSize(viewport);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'leaderboard fits narrow screens');
    await page.screenshot({path:`.context/leaderboard-${viewport.width}-fixture.png`});
  }
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(trigger).toBeVisible();
  assert.equal(await trigger.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,'mobile menu entry point fits at 320px');
  await trigger.click();await expect(dialog).toBeVisible();await expect(status).toContainText('51 X engineers');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await page.setViewportSize({width:1440,height:1000});await trigger.click();await expect(status).toContainText('51 X engineers');
  await page.locator('[data-player-id="fixture-0"] a').focus();fixture[0].totalMaterials++;
  const before=requests;await page.clock.fastForward(15001);
  await expect.poll(()=>requests).toBe(before+1);await expect(page.locator('#leaderboard-results')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('[data-player-id="fixture-0"] a')).toBeFocused();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();const closed=requests;await page.clock.fastForward(30001);assert.equal(requests,closed,'closed leaderboard stops polling');
  // Logout removes personalization but keeps the saved account publicly ranked.
  fixture=undefined;
  await page.getByRole('button',{name:'Account: Ada Lovelace, @ada_fixture',exact:true}).click();
  await page.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.getByRole('button',{name:'Log in with X to save progress',exact:true})).toBeVisible();await page.waitForFunction(()=>window.ironwood?.session().connected);await page.clock.fastForward(300);
  if(await page.locator('#intro-look-around').isVisible())await page.locator('#intro-look-around').click();
  await trigger.click();await expect(status).toContainText('1 X engineer');await expect(page.locator('.leaderboard-own')).toHaveCount(0);await expect(page.locator('#leaderboard-login')).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('LEADERBOARD BROWSER PASSED: real X signup eligibility and offline retention, empty/loading/error/retry states, safe profile rendering, badges, own rank, pagination, refresh, keyboard focus, 1024/390/320px layouts, automatic updates and polling cleanup. Ranked screenshots use labeled fixtures.');
}catch(error){await page.screenshot({path:'.context/leaderboard-failure.png'});console.error('Leaderboard browser failure:',errors);throw error;}
finally{await browser.close();await mf.dispose();}
