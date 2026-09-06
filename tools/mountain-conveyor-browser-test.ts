import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {building} from '../src/simulation';
import {isAction,type Action} from '../src/protocol';
import {CELL} from '../src/data';
import {sceneryAround} from '../src/scenery';

// Isolate the mountain factory from saved worlds; construction still uses real UI actions.
const world=new SharedWorld(),profile=world.createProfile('mountain-belts','mountain-belts-token','Engineer');
profile.x=0;profile.z=2*CELL;world.discover(profile);
for(const node of sceneryAround(0,2))world.sim.state.harvested[node.id]=0;
function chest(x:number,z:number,dir:number){const b=building('storage',x,z,dir,world.sim.state.nextId++);b.owner=profile.id;world.sim.state.buildings.push(b);world.sim.reindex();return b;}
const source=chest(0,2,1),sink=chest(2,8,1);source.input={ore:6};
const route=[{x:0,z:2},{x:0,z:3},{x:0,z:4},{x:0,z:5},{x:0,z:6},{x:1,z:6},{x:2,z:6},{x:2,z:7},{x:2,z:8}];
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[],actions:Action[]=[];
page.on('pageerror',error=>errors.push(error.message));let socket:WebSocketRoute;
const snapshot=()=>socket.send(JSON.stringify({type:'world',state:world.snapshot(profile),players:[world.publicPlayer(profile)],bases:world.bases(new Set([profile.id])),explored:profile.explored,revision:world.sim.revision,population:1}));
await page.route('**/api/auth/session',r=>r.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{socket=ws;ws.onMessage(raw=>{
  const action=JSON.parse(String(raw));
  if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();}
  else if(isAction(action)){actions.push(action);const message=world.action(profile,action);ws.send(JSON.stringify({type:'result',message}));snapshot();}
});});
const point=(p:{x:number;z:number})=>page.evaluate(p=>(window as any).ironwood.project(p.x,p.z),p);
async function move(p:{x:number;z:number}){const screen=await point(p);assert.ok(screen.visible);await page.mouse.move(screen.x,screen.y,{steps:4});}
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5182');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  let last=await point(route[0]);await expect.poll(async()=>{const next=await point(route[0]),distance=Math.hypot(next.x-last.x,next.y-last.y);last=next;return distance;}).toBeLessThan(.1);
  await page.getByRole('tab',{name:'Logistics',exact:true}).click();
  await page.getByRole('button',{name:'Build Conveyor',exact:true}).click();
  await move(route[1]);await expect(page.locator('#build-hint')).toContainText('automatic turns and slopes');
  await move(route[0]);await page.mouse.down();
  for(const p of route.slice(1))await move(p);
  await expect(page.locator('#build-hint')).toContainText('7 conveyors · 7 timber');
  await expect(page.locator('#build-hint')).toContainText('Machine input connected');
  assert.equal(actions.length,0);await page.screenshot({path:'.context/mountain-belts-preview.png'});
  await page.mouse.up();await expect.poll(()=>world.sim.state.buildings.filter(b=>b.kind==='conveyor').length).toBe(7);
  assert.equal(profile.inventory.log,83);assert.equal(actions.length,1);
  await page.keyboard.press('Escape');
  for(let i=0;i<55;i++)world.tick(.1);snapshot();
  await expect.poll(()=>page.evaluate(()=>(window as any).ironwood.snapshot().buildings.filter((b:any)=>b.item).length)).toBeGreaterThan(0);
  await page.screenshot({path:'.context/mountain-belts-built.png'});
  await page.reload();await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  assert.equal(await page.evaluate(()=>(window as any).ironwood.snapshot().buildings.filter((b:any)=>b.kind==='conveyor').length),7);
  for(let i=0;i<300;i++)world.tick(.1);snapshot();
  await expect.poll(()=>page.evaluate(id=>(window as any).ironwood.snapshot().buildings.find((b:any)=>b.id===id).input.ore,sink.id)).toBe(6);
  assert.deepEqual(errors,[]);
  console.log('PASS: mountain drag preview, uphill and downhill corners, exact cost, moving cargo, machine connections, reload and delivery.');
}catch(error){await page.screenshot({path:'.context/mountain-belts-failure.png'});console.error(errors,actions,await page.locator('#build-hint').textContent());throw error;}
finally{await browser.close();}
