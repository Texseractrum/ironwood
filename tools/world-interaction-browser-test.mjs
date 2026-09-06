import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {CELL} from '../src/data.ts';
import {chunkAt} from '../src/terrain.ts';
import {chunkScenery,PLAYER_RADIUS} from '../src/scenery.ts';

const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const snapshot=()=>page.evaluate(()=>window.ironwood.snapshot());
const keys=new Set();
async function release(){for(const key of keys)await page.keyboard.up(key);keys.clear();}
async function moveTo(x,z,tolerance=.2){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const p=(await snapshot()).player,dx=x-p.x,dz=z-p.z;
    if(Math.hypot(dx,dz)<tolerance){await release();return;}
    const sx=dx-dz,sy=dx+dz,wanted=new Set();
    if(Math.abs(sx)>Math.abs(sy)*.414)wanted.add(sx>0?'KeyD':'KeyA');
    if(Math.abs(sy)>Math.abs(sx)*.414)wanted.add(sy>0?'KeyS':'KeyW');
    for(const key of keys)if(!wanted.has(key)){await page.keyboard.up(key);keys.delete(key);}
    for(const key of wanted)if(!keys.has(key)){await page.keyboard.down(key);keys.add(key);}
    await page.waitForTimeout(40);
  }
  await release();throw new Error(`Could not reach ${x},${z}: ${JSON.stringify((await snapshot()).player)}`);
}
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>window.ironwood?.session().connected,null,{timeout:30000});
  const initial=await snapshot(),chunk=chunkAt(initial.player.x/CELL,initial.player.z/CELL);
  assert.equal(initial.openWorld,true);assert.ok(initial.explored.length>0);
  const miniFog=await page.locator('#minimap').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(15,15,1,1).data));
  assert.deepEqual(miniFog,[41,60,54,255]);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#atlas-canvas')).toBeVisible();
  const fog=await page.locator('#atlas-canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(15,15,1,1).data));
  assert.deepEqual(fog,[41,60,54,255]);
  const listed=await page.locator('[data-site]').evaluateAll(nodes=>nodes.map(n=>n.dataset.site));
  assert.ok(listed.every(id=>initial.discovered.includes(id)),'unexplored deposits are hidden');
  assert.ok(!listed.includes(`p:${chunk.x}:${chunk.z}:2`),'distant coal stays hidden');
  await expect(page.locator('#map-bases .map-destination')).toHaveCount(1);
  await page.screenshot({path:'.context/world-fog-atlas.png'});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await page.locator('#world').focus();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

  // The east tree of the local timber grove is approachable from the clear home.
  const tree=chunkScenery(chunk.x,chunk.z).find(n=>n.kind==='tree'&&n.siteId&&n.rotation===0);
  assert.ok(tree);
  await moveTo(tree.x+2,tree.z);
  await page.keyboard.down('KeyA');await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);await page.keyboard.up('KeyA');await page.keyboard.up('KeyW');
  const stopped=await snapshot();
  assert.ok(stopped.player.x>=tree.x+tree.radius+PLAYER_RADIUS-.04,'player stops at the trunk');
  assert.ok(stopped.player.x<tree.x+1,'player reached the trunk');
  assert.ok(stopped.explored.length>initial.explored.length,'walking reveals more map');
  const logs=stopped.inventory.log;
  await page.keyboard.press('KeyE');
  await expect.poll(async()=>(await snapshot()).inventory.log).toBe(logs+5);
  await expect.poll(async()=>{const s=await snapshot();return s.time>=s.miningReady;}).toBe(true);
  // Clicking the trunk exercises picking of instanced resources as well as E.
  const point=await page.evaluate(([x,z])=>window.ironwood.project(x,z),[tree.x/CELL,tree.z/CELL]);
  await page.mouse.click(point.x,point.y);
  await expect.poll(async()=>(await snapshot()).harvested[tree.id]).toBe(0);
  assert.equal((await snapshot()).inventory.log,logs+10);
  await moveTo(tree.x-.15,tree.z,.2);
  const cleared=await snapshot();assert.ok(cleared.player.x<tree.x,'cleared trunk no longer blocks movement');
  await page.screenshot({path:'.context/world-chopped-tree.png'});
  await page.reload();await page.waitForFunction(()=>window.ironwood?.session().connected);
  const restored=await snapshot();assert.equal(restored.owner,initial.owner);assert.equal(restored.harvested[tree.id],0);assert.equal(restored.inventory.log,logs+10);
  assert.ok(cleared.explored.every(cell=>restored.explored.includes(cell)));
  await page.keyboard.press('KeyM');await expect(page.locator(`[data-site="${tree.siteId}"]`)).toBeVisible();
  await page.screenshot({path:'.context/world-fog-explored.png'});
  await page.setViewportSize({width:1024,height:768});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('WORLD INTERACTIONS PASSED: atlas fog, hidden deposits, movement collision, E harvesting, targeted click, inventory, cleared passage, reload persistence, discovery, responsive layout.');
}catch(error){await page.screenshot({path:'.context/world-interaction-failure.png'});console.log('FAILURE',await page.evaluate(()=>({session:window.ironwood?.session(),player:window.ironwood?.snapshot().player,toast:document.querySelector('#toast')?.textContent})),errors);throw error;}
finally{await release();await browser.close();}
