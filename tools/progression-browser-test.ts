import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {building} from '../src/simulation';
import {ITEMS,type Stock} from '../src/data';
import {CHAPTERS} from '../src/progression';
import {isAction} from '../src/protocol';

// Disposable server fixture uses the real game simulation/action validation.
// No debug mutation endpoints or edits to the user's local world are needed.
const world=new SharedWorld(),profile=world.createProfile('progression-test','progression-token','Mechanist');
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let socket:WebSocketRoute|undefined;
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;
  ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));
    if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
    else if(isAction(action)){const message=world.action(profile,action);ws.send(JSON.stringify({type:'result',message}));snapshot();}
    // Movement is irrelevant to these UI fixtures and is deliberately ignored.
  });
});
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5181');
  await page.waitForFunction(()=>!!(window as any).ironwood?.session().connected);
  await page.getByRole('button',{name:'Look around first',exact:true}).click();
  await expect(page.locator('#mission-title')).toHaveText('Start with timber');
  await page.locator('#journey').click();
  await expect(page.locator('.chapter-list > li')).toHaveCount(8);
  await expect(page.locator('.chapter-current')).toContainText('A spark of possibility');
  await expect(page.locator('.chest-ladder')).toContainText('4,000');
  await page.screenshot({path:'.context/progression-journey.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();

  profile.progress.unlock=6;profile.progress.campaign.badges=CHAPTERS.slice(0,6).map(ch=>ch.badge);
  profile.inventory=Object.fromEntries(Object.keys(ITEMS).map(k=>[k,k==='pickaxe'?1:1000])) as Stock;
  const chest=building('storage',profile.base.x+4,profile.base.z+2,0,world.sim.state.nextId++);chest.owner=profile.id;chest.input={plank:100};
  world.sim.state.buildings.push(chest);world.sim.reindex();snapshot();
  await expect(page.locator('#mission-title')).toHaveText('The heart of Ironwood');
  // Inspect through the canvas, then use the same upgrade action as a player.
  const at=await page.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[chest.x,chest.z]);
  await page.mouse.click(at.x,at.y);
  await expect(page.locator('#inspector h2')).toHaveText('Timber chest');
  for(const [name,capacity] of [['Ironbound chest',400],['Steel vault',1200],['Aether vault',4000]] as const){
    await page.getByRole('button',{name:`Upgrade · ${name}`,exact:true}).click();
    await expect(page.locator('#inspector h2')).toHaveText(name);
    await expect(page.locator('.upgrade-card strong')).toHaveText(`100 / ${capacity.toLocaleString('en-US')} items`);
  }
  assert.equal(chest.level,3);assert.equal(chest.input.plank,100);
  await page.screenshot({path:'.context/progression-vault.png'});
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  // Check that the last advanced blueprint remains usable in a crowded recipe book.
  await page.getByRole('tab',{name:'Production',exact:true}).hover();
  await expect(page.getByRole('button',{name:'Build Core assembler',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Build Core assembler',exact:true}).click();
  await page.keyboard.press('Escape');

  profile.progress.unlock=7;profile.progress.campaign.badges=CHAPTERS.slice(0,7).map(ch=>ch.badge);
  profile.progress.delivered=100;profile.progress.campaign.mastery=true;profile.inventory.core=11;snapshot();
  await page.keyboard.press('KeyJ');await expect(page.locator('#light-beacon')).toBeDisabled();
  profile.inventory.core=12;snapshot();await expect(page.locator('#light-beacon')).toBeEnabled();
  await page.getByRole('button',{name:'Light the beacon',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Master of Ironwood.',exact:true})).toBeVisible();
  assert.equal(profile.progress.won,true);assert.equal(profile.inventory.core,0);
  await page.screenshot({path:'.context/progression-ending.png'});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save certificate',exact:true}).click();
  const certificate=await download;assert.equal(certificate.suggestedFilename(),'ironwood-master-certificate.svg');await certificate.saveAs('.context/ironwood-master-certificate.svg');
  await page.getByRole('button',{name:'Keep building',exact:true}).click();
  await expect.poll(()=>profile.progress.campaign.completionSeen).toBe(true);
  await expect(page.locator('#journey-count')).toHaveText('Completed');
  await page.reload();await page.waitForFunction(()=>!!(window as any).ironwood?.session().connected);
  await expect(page.locator('#mission-title')).toHaveText('Master of Ironwood');await expect(page.locator('#dialog')).not.toBeVisible();
  await page.keyboard.press('KeyJ');await page.getByRole('button',{name:'View completion badge',exact:true}).click();
  await expect(page.locator('#ending-title')).toBeVisible();
  for(const size of [{width:1024,height:768},{width:800,height:700}]){
    await page.setViewportSize(size);await page.getByRole('button',{name:'Keep building',exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'Keep building',exact:true})).toBeInViewport();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.screenshot({path:'.context/progression-ending-800.png'});
  assert.deepEqual(errors,[]);
  console.log('PROGRESSION BROWSER PASSED: eight chapters, live objectives, all chest upgrades, advanced blueprints, final commission validation, completion, certificate download, persistent badge, reload and responsive controls.');
}catch(error){await page.screenshot({path:'.context/progression-browser-failure.png'});console.error('Browser errors:',errors);throw error;}
finally{await browser.close();}
