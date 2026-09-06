import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {building} from '../src/simulation';
import {isAction,type Action} from '../src/protocol';
import type {Kind} from '../src/data';

// An isolated connection exercises real multiplayer actions without changing a saved world.
const world=new SharedWorld(),profile=world.createProfile('conveyor-test','conveyor-token','Engineer');
const {x:bx,z:bz}=profile.base;
function put(kind:Kind,x:number,z:number,dir=0){const b=building(kind,bx+x,bz+z,dir,world.sim.state.nextId++);b.owner=profile.id;world.sim.state.buildings.push(b);world.sim.reindex();return b;}
const source=put('storage',-3,0),sink=put('storage',2,2);source.input={log:3};
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors:string[]=[],actions:Action[]=[];page.on('pageerror',e=>errors.push(e.message));
let socket:WebSocketRoute;
const snapshot=()=>socket.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));
    if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
    else if(isAction(action)){actions.push(action);const message=world.action(profile,action);ws.send(JSON.stringify({type:'result',message}));snapshot();}
  });
});
const point=(x:number,z:number)=>page.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[bx+x,bz+z]);
async function move(x:number,z:number){const p=await point(x,z);await page.mouse.move(p.x,p.y);}
async function start(x:number,z:number){await move(x,z);await page.mouse.down();}
const belts=()=>world.sim.state.buildings.filter(b=>b.kind==='conveyor');
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5182');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  let last=await point(0,0);
  await expect.poll(async()=>{const next=await point(0,0),delta=Math.hypot(next.x-last.x,next.y-last.y);last=next;return delta;}).toBeLessThan(.1);
  await page.getByRole('tab',{name:'Logistics',exact:true}).click();
  await page.getByRole('button',{name:'Build Conveyor',exact:true}).click();
  await expect(page.locator('#build-hint')).toContainText('automatic turns');
  await expect(page.getByRole('button',{name:'Log in with X to save progress',exact:true})).toBeHidden();
  await start(-3,0);await move(0,0);await move(0,2);await move(2,2);
  await expect(page.locator('#build-hint')).toContainText('6 conveyors · 6 timber');
  assert.equal(actions.length,0);assert.equal(belts().length,0);assert.equal(profile.inventory.log,90);
  await page.screenshot({path:'.context/conveyor-route-preview.png'});
  await page.mouse.up();
  await expect.poll(()=>belts().length).toBe(6);
  assert.equal(actions.length,1);assert.equal(actions[0].type,'conveyors');assert.equal(profile.inventory.log,84);
  assert.equal(world.sim.at(bx,bz)!.dir,1);assert.equal(world.sim.at(bx,bz+2)!.dir,0);
  for(let i=0;i<250;i++)world.tick(.1);snapshot();assert.equal(sink.input.log,3);
  await page.screenshot({path:'.context/conveyor-turns-built.png'});

  // Backtracking edits the preview and only the remaining route is charged.
  await start(-2,3);await move(2,3);await move(0,3);
  await expect(page.locator('#build-hint')).toContainText('3 conveyors · 3 timber');
  await page.mouse.up();await expect.poll(()=>belts().length).toBe(9);assert.equal(profile.inventory.log,81);
  // An existing belt can become the first turn of an extended route.
  await start(0,3);await move(0,4);await move(-2,4);
  await expect(page.locator('#build-hint')).toContainText('4 conveyors · 3 timber');
  await page.mouse.up();await expect.poll(()=>belts().length).toBe(12);assert.equal(profile.inventory.log,78);
  assert.equal(world.sim.at(bx,bz+3)!.dir,1);assert.equal(world.sim.at(bx,bz+4)!.dir,2);
  const before=JSON.stringify(belts()),money=profile.inventory.log,count=actions.length;
  await start(1,3);await move(3,3);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(actions.length,count);assert.equal(JSON.stringify(belts()),before);assert.equal(profile.inventory.log,money);
  await expect(page.locator('#build-hint')).toBeHidden();
  await expect(page.getByRole('button',{name:'Log in with X to save progress',exact:true})).toBeVisible();

  // R turns an existing conveyor under the pointer, without rebuilding it.
  // Use the extended belt clear of the engineer's floating login button.
  await move(0,4);await page.keyboard.press('KeyR');
  await expect.poll(()=>world.sim.at(bx,bz+4)!.dir).toBe(3);assert.equal(profile.inventory.log,money);
  await page.keyboard.press('KeyR');await expect.poll(()=>world.sim.at(bx,bz+4)!.dir).toBe(0);
  await page.keyboard.press('KeyR');await expect.poll(()=>world.sim.at(bx,bz+4)!.dir).toBe(1);
  await page.keyboard.press('KeyR');await expect.poll(()=>world.sim.at(bx,bz+4)!.dir).toBe(2);

  await page.getByRole('tab',{name:'Logistics',exact:true}).hover();
  await page.getByRole('button',{name:'Build Conveyor',exact:true}).click();
  put('windmill',3,3);snapshot();
  await start(1,3);await move(4,3);
  await expect(page.locator('#build-hint')).toContainText('A machine blocks this route');
  const blockedCount=actions.length;await page.screenshot({path:'.context/conveyor-blocked-preview.png'});
  await page.mouse.up();assert.equal(actions.length,blockedCount);assert.equal(profile.inventory.log,money);
  assert.equal(world.sim.at(bx+1,bz+3),undefined);

  // An interrupted pointer never leaves a stroke armed for the next movement.
  await start(1,4);await move(3,4);
  await page.locator('#world').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  await move(4,4);assert.equal(actions.length,blockedCount);
  await expect(page.locator('#build-hint')).toContainText('automatic turns');
  // A single click still builds a single conveyor with the chosen orientation.
  await page.mouse.click((await point(1,4)).x,(await point(1,4)).y);
  await expect.poll(()=>belts().length).toBe(13);
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  assert.equal(await page.evaluate(()=>(window as any).ironwood.snapshot().buildings.filter((b:any)=>b.kind==='conveyor').length),13);
  await page.setViewportSize({width:1024,height:768});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('CONVEYOR BROWSER PASSED: machine endpoints, live cost/turn preview, no spend before release, one atomic action, transported goods, retracing, extending existing belts, R rotation, Escape/cancel, obstacles, single placement, reload, responsive layout.');
}catch(error){await page.screenshot({path:'.context/conveyor-browser-failure.png'});console.error('BROWSER FAILURE',errors,await page.locator('#build-hint').textContent(),actions);throw error;}
finally{await browser.close();}
