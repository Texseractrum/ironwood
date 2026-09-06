import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
let page;
try{
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>!!window.ironwood);
  const snap=()=>page.evaluate(()=>window.ironwood.snapshot());
  const title=name=>expect(page.locator('#mission-title')).toHaveText(name);
  const choose=name=>page.getByRole('button',{name:`Choose ${name}`,exact:true}).click();
  const settleCamera=()=>page.evaluate(()=>new Promise(resolve=>{
    let last,stable=0;const frame=()=>{const p=window.ironwood.project(0,0);stable=last&&Math.hypot(p.x-last.x,p.y-last.y)<.001?stable+1:0;last=p;if(stable>=3)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);
  }));
  const place=async(x,z)=>{
    const p=await page.evaluate(([x,z])=>window.ironwood.project(x,z),[x,z]);
    await page.mouse.click(p.x,p.y);
    await expect.poll(async()=>(await snap()).buildings.some(b=>b.x===x&&b.z===z)).toBe(true);
  };
  if((await snap()).openWorld){
    await page.waitForFunction(()=>window.ironwood.session().connected,{timeout:30000});
    await page.getByRole('button',{name:'Look around first',exact:true}).click();
    const initial=await snap(),owner=initial.owner,{x,z}=initial.base;
    const own=s=>s.buildings.filter(b=>b.owner===owner);
    assert.equal(own(initial).length,0);await title('Start with timber');
    // Walk to the grove as instructed, clearing the camp's outgoing path if needed.
    await page.keyboard.down('KeyW');await page.keyboard.down('KeyA');
    await expect.poll(async()=>(await snap()).player.x,{timeout:12000}).toBeLessThan((x-6.3)*2.3);
    await page.keyboard.up('KeyW');await page.keyboard.up('KeyA');await settleCamera();
    for(let i=0;i<2;i++){
      await page.waitForFunction(()=>{const s=window.ironwood.snapshot();return s.time>=s.miningReady;});
      const gathered=(await snap()).gathered;await page.keyboard.press('KeyE');
      await expect.poll(async()=>(await snap()).gathered).toBeGreaterThan(gathered);
    }
    await page.screenshot({path:'.context/ironwood-empty-start.png'});
    await choose('lumber camp');await place(x-8,z+2);await title('Power your lumber camp');
    await choose('windmill');await place(x-4,z);await title('Turn timber into planks');
    await choose('sawmill');await place(x-4,z+2);await title('Give timber a path');
    await page.reload();await page.waitForFunction(()=>window.ironwood?.session().connected);
    await settleCamera();
    assert.equal((await snap()).owner,owner);assert.equal(own(await snap()).length,3);await title('Give timber a path');
    await choose('conveyor');for(const offset of [-7,-6,-5])await place(x+offset,z+2);
    await title('Make room for planks');await choose('storage chest');await place(x-2,z+2);
    await title('Store your first planks');await choose('conveyor');await place(x-3,z+2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#mission-title')).toHaveText('Next, unearth iron',{timeout:35000});
    await page.screenshot({path:'.context/ironwood-first-production.png'});
    await page.setViewportSize({width:1024,height:768});await expect(page.locator('#mission-action')).toBeInViewport();
    assert.deepEqual(errors,[]);
    console.log('TUTORIAL PASSED: empty personal workshop, guided construction, reload, wood automation, and next iron lesson in the shared world.');
  }else{
  assert.deepEqual((await snap()).buildings,[]);await title('Start with timber');
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.screenshot({path:'.context/ironwood-empty-start.png'});
  for(const size of [{width:1024,height:768},{width:1440,height:1000}]){
    await page.setViewportSize(size);
    await expect(page.locator('#mission-action')).toBeInViewport();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await choose('lumber camp');await place(-6,2);await title('Power your lumber camp');
  await choose('windmill');await expect(page.getByRole('tab',{name:'Power',exact:true})).toHaveAttribute('aria-selected','true');
  await place(-4,-1);await title('Turn timber into planks');
  await choose('sawmill');await place(-2,2);await title('Give timber a path');
  // Saving halfway through setup must resume this lesson, without adding buildings.
  await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('button',{name:'Save workshop',exact:true}).click();
  await page.reload();await page.waitForFunction(()=>!!window.ironwood);await title('Give timber a path');
  assert.equal((await snap()).buildings.length,3);
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await choose('conveyor');for(const x of [-5,-4,-3])await place(x,2);
  await title('Make room for planks');await choose('storage chest');await place(1,2);
  await title('Store your first planks');await choose('conveyor');for(const x of [-1,0])await place(x,2);
  await title('Your first wood production');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await expect(page.locator('#mission-title')).toHaveText('Next, unearth iron',{timeout:35000});
  await page.screenshot({path:'.context/ironwood-first-production.png'});
  // Move closer to the iron site using the normal movement controls.
  await page.keyboard.down('KeyW');
  await expect.poll(async()=>{const {player}=await snap();return Math.hypot(player.x+6*2.3,player.z+3*2.3);}).toBeLessThan(5*2.3);
  await page.keyboard.up('KeyW');
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await choose('iron mine');await place(-6,-3);await title('Build a stone furnace');
  await choose('stone furnace');await place(-2,-3);await title('Bring ore to the furnace');
  await choose('conveyor');for(const x of [-5,-4,-3])await place(x,-3);
  await title('From ore to opportunity');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await expect(page.locator('#mission-title')).toHaveText('The wheels of progress',{timeout:65000});
  assert.equal((await snap()).unlock,1);
  await page.getByRole('button',{name:'Open field guide'}).click();
  await expect(page.getByRole('heading',{name:'Install wood production',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();
  // Reset only this disposable test browser's save through the normal confirmation.
  await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('button',{name:'New expedition',exact:true}).click();
  await page.getByRole('button',{name:'Start new expedition',exact:true}).click();
  await page.waitForFunction(()=>!!window.ironwood&&window.ironwood.snapshot().buildings.length===0);
  await title('Start with timber');assert.equal((await snap()).unlock,0);
  assert.deepEqual(errors,[]);
  console.log('TUTORIAL PASSED: empty start, responsive objective, construction actions, wood automation, iron automation, chapter unlock, resume, guide, and confirmed new expedition.');
  }
}catch(error){
  if(page){await page.screenshot({path:'.context/ironwood-tutorial-failure.png'});console.error(await page.locator('#mission-title').textContent(),await page.locator('#toast').textContent());}
  throw error;
}finally{await browser.close();}
