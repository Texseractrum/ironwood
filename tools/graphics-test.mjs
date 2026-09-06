import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>!!window.ironwood);
  const graphics=()=>page.evaluate(()=>window.ironwood.diagnostics().graphics);
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');await ready();
  // Repeated buildings are now placed explicitly; a new island has none to batch.
  await page.getByRole('tab',{name:'Logistics',exact:true}).click();
  await page.getByRole('button',{name:'Build Storage chest',exact:true}).click();
  for(const x of [0,1]){const p=await page.evaluate(x=>window.ironwood.project(x,0),x);await page.mouse.click(p.x,p.y);}
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await graphics()).staticBatches).toBeGreaterThan(0);
  assert.equal((await graphics()).pixelRatio,1.25);
  await page.getByRole('button',{name:'Open settings'}).click();
  const select=page.getByLabel('Quality',{exact:true});
  await select.selectOption('performance');
  await expect.poll(async()=>(await graphics()).shadowSize).toBe(1024);
  assert.equal((await graphics()).width,1440);
  await page.getByLabel('Show FPS counter').check();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await expect(page.locator('#fps-counter')).toHaveText(/\d+ FPS/);
  await page.reload();await ready();
  assert.equal((await graphics()).quality,'performance');
  assert.equal((await graphics()).showFps,true);
  await page.getByRole('button',{name:'Open settings'}).click();
  await expect(select).toHaveValue('performance');
  await select.focus();await page.keyboard.press('b');await page.keyboard.press('Tab');
  await expect(select).toHaveValue('balanced');
  await select.selectOption('quality');
  await expect.poll(async()=>(await graphics()).width).toBe(2880);
  assert.equal((await graphics()).shadowSize,2048);
  // Repeated shadow-map replacement must not accumulate GPU resources.
  // Let the arrival camera settle so frustum changes do not add visible geometry.
  await page.evaluate(()=>new Promise(resolve=>{
    let last,stable=0;
    const frame=()=>{const p=window.ironwood.project(0,0);stable=last&&Math.hypot(p.x-last.x,p.y-last.y)<.001?stable+1:0;last=p;if(stable>=3)resolve();else requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
  }));
  const initialGeometries=await page.evaluate(()=>window.ironwood.diagnostics().geometries);
  const initialTextures=await page.evaluate(()=>window.ironwood.diagnostics().textures);
  for(let i=0;i<3;i++){await select.selectOption('performance');await page.waitForTimeout(100);await select.selectOption('quality');await page.waitForTimeout(100);}
  assert.equal(await page.evaluate(()=>window.ironwood.diagnostics().geometries),initialGeometries);
  assert.equal(await page.evaluate(()=>window.ironwood.diagnostics().textures),initialTextures);
  await page.getByLabel('Show FPS counter').uncheck();
  await expect(page.locator('#fps-counter')).toBeHidden();
  await page.screenshot({path:'.context/ironwood-graphics.png'});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Open settings'})).toBeFocused();
  await page.screenshot({path:'.context/ironwood-batched.png'});
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>localStorage.setItem('ironwood-graphics-v1','{"quality":"invalid","showFps":true}'));
  await page.reload();await ready();assert.equal((await graphics()).quality,'balanced');
  console.log('GRAPHICS CHECKS PASSED: static batching, Retina render sizes, shadow sizes, immediate switching, keyboard selection, FPS toggle, persistence, invalid-setting fallback, stable geometry count.');
}finally{await browser.close();}
