import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {building} from '../src/simulation';
import {CELL,type Kind} from '../src/data';
import {sitesAround} from '../src/terrain';
import {isAction} from '../src/protocol';

// Local fixture: real server actions and rendering, no changes to a saved world.
const world=new SharedWorld(),profile=world.createProfile('power-test','power-token','Engineer');
const coal=sitesAround(profile.base.x,profile.base.z).filter(s=>s.item==='coal').sort((a,b)=>Math.hypot(a.x-profile.base.x,a.z-profile.base.z)-Math.hypot(b.x-profile.base.x,b.z-profile.base.z))[0];
const {x:sx,z:sz}=coal;profile.x=(sx+2)*CELL;profile.z=(sz+3)*CELL;
Object.assign(profile.inventory,{log:150,plank:60,ingot:30,copper:12,coal:3});
function put(kind:Kind,x:number,z:number){const b=building(kind,sx+x,sz+z,0,world.sim.state.nextId++);b.owner=profile.id;world.sim.state.buildings.push(b);world.sim.reindex();return b;}
put('windmill',4,5);const post=put('post',4,0);
const furnace=put('furnace',7,0);furnace.input={ore:8};
put('sawmill',6,2);put('assembler',8,2);put('foundry',7,-2);
world.sim.state.deposits[coal.id]=3;
world.discover(profile);world.tick(.1);
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(10000);
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let socket:WebSocketRoute;
const snapshot=()=>socket.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{
  socket=ws;ws.onMessage(raw=>{
    const action=JSON.parse(String(raw));
    if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
    else if(isAction(action)){const message=world.action(profile,action);ws.send(JSON.stringify({type:'result',message}));snapshot();}
  });
});
const point=(x:number,z:number)=>page.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[sx+x,sz+z]);
async function hover(x:number,z:number){const p=await point(x,z);await page.mouse.move(p.x,p.y);}
async function click(x:number,z:number){const p=await point(x,z);await page.mouse.click(p.x,p.y);}
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5173');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  let last=await point(0,0);
  await expect.poll(async()=>{const next=await point(0,0),delta=Math.hypot(next.x-last.x,next.y-last.y);last=next;return delta;}).toBeLessThan(.1);
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.diagnostics().power.wires)).toBe(5);
  assert.equal(await page.evaluate(()=>(window as any).ironwood.diagnostics().power.wiresVisible),true);
  assert.equal(await page.evaluate(()=>(window as any).ironwood.diagnostics().power.highlighted),false);
  assert.ok(furnace.power<1);
  await page.getByRole('tab',{name:'Power',exact:true}).click();
  await expect(page.getByRole('button',{name:'Build Windmill',exact:true})).toContainText('12 power');
  await page.getByRole('button',{name:'Build Windmill',exact:true}).click();await hover(3,4);
  await expect(page.locator('#build-hint')).toContainText('at least 4 tiles');
  await page.getByRole('button',{name:'Build Coal power plant',exact:true}).click();await hover(1,1);
  await expect(page.locator('#build-hint')).toContainText('directly on a coal deposit');
  await hover(0,0);await expect(page.locator('#build-hint')).toContainText('Click to place');
  await page.screenshot({path:'.context/power-coal-placement.png'});
  await click(0,0);await expect.poll(()=>world.sim.at(sx,sz)?.kind).toBe('steam');
  world.tick(.1);snapshot();
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.diagnostics().power.supply)).toBe(84);
  assert.equal(furnace.power,1);
  await page.keyboard.press('Escape');await click(0,0);
  await expect(page.locator('#inspector')).toContainText('Coal power plant');
  await expect(page.locator('#inspector')).toContainText('Generating 72 power');
  await expect(page.locator('#inspector')).toContainText('Coal in seam');
  await page.screenshot({path:'.context/power-coal-running.png'});
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.getByRole('button',{name:'Highlight power network',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.diagnostics().power.highlighted)).toBe(true);
  await page.screenshot({path:'.context/power-wires-highlighted.png'});
  await page.getByRole('button',{name:'Highlight power network',exact:true}).click();
  const connected=await page.evaluate(()=>(window as any).ironwood.diagnostics().power.wires);
  for(let i=0;i<601;i++)world.tick(.1);snapshot();
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.diagnostics().power.supply)).toBe(12);
  assert.equal(await page.evaluate(()=>(window as any).ironwood.diagnostics().power.wires),connected);
  await click(0,0);await expect(page.locator('#inspector')).toContainText('Deposit exhausted');
  await page.getByRole('button',{name:'Load inputs',exact:true}).click();world.tick(.1);snapshot();
  await expect(page.locator('#inspector')).toContainText('Generating 72 power');
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.getByRole('button',{name:'Dismantle mode',exact:true}).click();
  await click(4,0);await expect.poll(()=>world.sim.byId.has(post.id)).toBe(false);
  assert.equal(furnace.power,0);await page.keyboard.press('Escape');
  for(const width of [1024,768]){
    await page.setViewportSize({width,height:800});await page.getByRole('tab',{name:'Power',exact:true}).click();
    await expect(page.getByRole('button',{name:'Build Coal power plant',exact:true})).toBeInViewport();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`.context/power-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('POWER BROWSER PASSED: visible wires without overlay, wind spacing, coal-only placement, autonomous generation, depletion, imported fuel, disconnected loads, responsive power cards, and no page errors.');
}catch(error){
  await page.screenshot({path:'.context/power-browser-failure.png'});
  console.log('Power browser failure',error,errors);throw error;
}finally{await browser.close();}
