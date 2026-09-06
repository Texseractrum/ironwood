import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {ITEMS,CRAFTS,type Item} from '../src/data';
import {isAction} from '../src/protocol';
import {combatState,isCombatAction} from '../src/combat-data';
import {itemIcon,itemIconUrl} from '../src/item-icons';

// Disposable simulation and socket: verification never changes the live world.
const world=new SharedWorld(),profile=world.createProfile('item-art-test','item-art-token','Art check');
profile.progress.built=1;profile.progress.unlock=7;
for(const item of Object.keys(ITEMS) as Item[])profile.inventory[item]=1000;
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
let socket:WebSocketRoute;
const snapshot=()=>socket.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:[],explored:profile.explored,revision:world.sim.revision,population:1}));
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;
  ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));let message='';
    if(action.type==='join')ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));
    else if(isCombatAction(action))message=world.combat.action(profile,action,new Set([profile.id]));
    else if(isAction(action))message=world.action(profile,action);
    if(message)ws.send(JSON.stringify({type:'result',message}));
    snapshot();
  });
});

async function imagesLoaded(){
  await expect.poll(()=>page.locator('img.item-icon').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth===192))).toBe(true);
}

try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await expect(page.locator('#inventory-items .item-icon')).toHaveCount(Object.keys(ITEMS).length);
  await expect(page.locator('.building-cost .item-icon').first()).toHaveCSS('width','16px');
  await imagesLoaded();
  for(const item of Object.keys(ITEMS) as Item[]){
    const slot=page.locator(`[data-material="${item}"]`);
    await expect(slot).toHaveAttribute('aria-label',new RegExp(ITEMS[item].name));
    await expect(slot.locator('img')).toHaveAttribute('src',itemIconUrl(item));
  }
  await page.getByRole('button',{name:'Craft with your supplies'}).click();
  await expect(page.locator('.craft-icon .item-icon')).toHaveCount(Object.keys(CRAFTS).length);
  await expect(page.locator('.craft-cost .item-icon')).toHaveCount(Object.values(CRAFTS).reduce((n,craft)=>n+Object.keys(craft.cost).length,0));
  await imagesLoaded();
  await page.screenshot({path:'.context/item-icons-crafting.png'});
  await page.locator('[data-craft="sword"]').click();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect.poll(()=>combatState(profile).weapon).toBe('spear');
  await expect(page.locator('.combat-weapon-art img')).toHaveAttribute('src',itemIconUrl('spear'));
  delete profile.inventory.spear;snapshot();
  await expect(page.locator('.combat-weapon-art img')).toHaveAttribute('src',itemIconUrl('sword'));
  delete profile.inventory.sword;delete profile.inventory.club;snapshot();
  await expect(page.locator('.combat-weapon-art')).toBeHidden();
  profile.inventory.sword=1;snapshot();
  await page.locator('#world').focus();await page.keyboard.press('KeyM');
  await expect(page.locator('.atlas-legend .item-icon')).toHaveCount(5);
  await imagesLoaded();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.locator('[data-material="log"]').focus();
  await page.screenshot({path:'.context/item-icons-game.png'});
  for(const viewport of [{width:1440,height:1000},{width:1024,height:768},{width:768,height:800}]){
    await page.setViewportSize(viewport);
    const inventory=await page.locator('.resources').boundingBox();
    assert.ok(inventory&&inventory.x>=0&&inventory.x+inventory.width<=viewport.width&&inventory.height<=44,JSON.stringify(inventory));
    await page.locator('[data-material="spear"]').focus();
    await expect(page.locator('[data-material="spear"]')).toBeInViewport();
    await page.getByRole('button',{name:'Craft with your supplies'}).click();
    assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await imagesLoaded();
    await page.screenshot({path:`.context/item-icons-${viewport.width}.png`});
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  }
  assert.deepEqual(errors,[]);
  // Contact sheet uses the exact shipped PNGs, shown on both game surfaces.
  const gallery=await browser.newPage({viewport:{width:1100,height:920},deviceScaleFactor:1});
  await gallery.setContent(`<base href="${process.env.PLAY_URL||'http://localhost:5173'}"><style>body{margin:0;padding:32px;background:#eeecdf;font:13px system-ui;color:#354c3e}h1{font:36px Georgia;margin:0 0 8px}p{color:#64715e;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.card{background:#f7f3e9;border-radius:10px;overflow:hidden;text-align:center}.art{display:flex;justify-content:center;height:112px}.art span{width:50%;display:grid;place-items:center}.art span+span{background:#293e32}.item-icon{width:98px;height:98px;object-fit:contain}.card p{margin:12px 0;font-weight:600}</style><h1>Ironwood · Item portraits</h1><p>19 models. One consistent set. Inventory, crafting, recipes & equipment.</p><div class="grid">${(Object.keys(ITEMS) as Item[]).map(item=>`<div class="card"><div class="art"><span>${itemIcon(item)}</span><span>${itemIcon(item)}</span></div><p>${ITEMS[item].name}</p></div>`).join('')}</div>`);
  await gallery.locator('img').evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
  await gallery.screenshot({path:'.context/item-icons-contact-sheet.png'});
  console.log('ITEM ICONS PASSED: all 19 portraits load, 13 crafting recipes and their costs, equipped sword/spear/fists, atlas, accessible inventory names, and layouts at 1440/1024/768px.');
}catch(error){await page.screenshot({path:'.context/item-icons-failure.png'});throw error;}
finally{await browser.close();}
