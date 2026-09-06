import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {CELL} from '../src/data';

// Local, disposable presence fixture; never joins or changes the running world.
const world=new SharedWorld();
const own=world.createProfile('map-own','map-own-token','You');
const ada=world.createProfile('map-ada','map-ada-token','Ada');
const miles=world.createProfile('map-miles','map-miles-token','Miles');
const far=world.createProfile('map-far','map-far-token','Distant engineer');
ada.x=own.x+12*CELL;ada.z=own.z-3*CELL;
miles.x=own.x-14*CELL;miles.z=own.z+5*CELL;
far.x=own.x+100*CELL;far.z=own.z;
const online=new Set([own.id]);
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
let socket:WebSocketRoute|undefined;
const snapshot=()=>socket?.send(JSON.stringify({type:'world',state:world.snapshot(own),players:[...online].map(id=>world.publicPlayer(world.profiles.get(id)!)),bases:world.bases(online),explored:own.explored,revision:world.sim.revision,population:world.profiles.size}));
await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
await page.routeWebSocket('**/api/world',ws=>{socket=ws;ws.onMessage(raw=>{if(JSON.parse(String(raw)).type==='join'){ws.send(JSON.stringify({type:'welcome',id:own.id,token:own.token}));snapshot();}});});
async function colorPixels(id:string,target:typeof ada,center=own,span=id==='minimap'?40:64){
  return page.locator('#'+id).evaluate((element,{target,center,span,cell})=>{
    const canvas=element as HTMLCanvasElement,c=canvas.getContext('2d')!;
    const x=Math.round(canvas.width/2+(target.x-center.x)/cell*canvas.width/span),z=Math.round(canvas.height/2+(target.z-center.z)/cell*canvas.width/span);
    const data=c.getImageData(x-15,z-15,30,30).data,rgb=target.color.match(/[a-f\d]{2}/gi)!.map(s=>parseInt(s,16));
    let count=0;for(let i=0;i<data.length;i+=4)if(data[i]===rgb[0]&&data[i+1]===rgb[1]&&data[i+2]===rgb[2])count++;return count;
  },{target:{x:target.x,z:target.z,color:target.color},center:{x:center.x,z:center.z},span,cell:CELL});
}
try{
  await page.goto(process.env.PLAY_URL||'http://localhost:5194');
  await page.waitForFunction(()=>(window as any).ironwood?.session().connected);
  await page.getByRole('button',{name:'Look around first',exact:true}).click();
  await expect(page.locator('#map-nearby')).toHaveText('0 engineers nearby');
  await page.locator('#map-nearby').click();
  await expect(page.locator('#map-people')).toContainText('No other engineers within 92 m');
  const before=await page.evaluate(()=>(window as any).ironwood.snapshot().explored);
  assert.ok(!before.includes(`${Math.round(ada.x/CELL)},${Math.round(ada.z/CELL)}`));
  online.add(ada.id);online.add(miles.id);online.add(far.id);snapshot();
  await expect(page.locator('#map-people button')).toHaveCount(2);
  await expect(page.locator('#map-people b')).toHaveText(['Ada','Miles']);
  await expect(page.locator('#map-nearby')).toHaveText('2 engineers nearby');
  for(const id of ['minimap','atlas-canvas'])await expect.poll(()=>colorPixels(id,ada)).toBeGreaterThan(20);
  assert.deepEqual(await page.evaluate(()=>(window as any).ironwood.snapshot().explored),before,'presence must not reveal terrain');
  await page.screenshot({path:'.context/map-nearby-atlas.png'});
  const row=page.locator('[data-player-id="map-ada"]');
  // Live movement updates distances without replacing focused controls.
  await row.focus();ada.x=own.x+6*CELL;ada.z=own.z+3*CELL;snapshot();
  await expect(row.locator('span')).toHaveText('15 m away');await expect(row).toBeFocused();
  await row.press('Enter');await expect(page.locator('#map-waypoint')).toContainText('Ada’s location · 15 m away');
  await expect.poll(()=>colorPixels('atlas-canvas',ada,ada)).toBeGreaterThan(20);
  await page.locator('#map-clear').click();await page.locator('#map-me').click();
  const bounds=await page.locator('#atlas-canvas').boundingBox();assert.ok(bounds);
  await page.mouse.click(bounds.x+bounds.width/2+6*bounds.width/64,bounds.y+bounds.height/2+3*bounds.height/(64*440/840));
  await expect(page.locator('#map-waypoint')).toContainText('Ada’s location');
  // Stationary profile changes must invalidate the minimap too; names stay text.
  ada.name='<img src=x onerror=alert(1)>';ada.color='#ec9e82';snapshot();
  await expect(row.locator('b')).toHaveText(ada.name);await expect(row.locator('img')).toHaveCount(0);
  await expect.poll(()=>colorPixels('minimap',ada)).toBeGreaterThan(20);
  ada.name='Ada';snapshot();await expect(row.locator('b')).toHaveText('Ada');
  await page.locator('#map-clear').click();await page.locator('#map-me').click();
  for(const width of [1024,390]){
    await page.setViewportSize({width,height:800});await row.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('#dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await expect(row).toBeInViewport();await page.screenshot({path:`.context/map-nearby-${width}.png`});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.screenshot({path:'.context/map-nearby-minimap.png'});
  ada.x=own.x+100*CELL;snapshot();await expect(page.locator('#map-nearby')).toHaveText('1 engineer nearby');
  online.delete(miles.id);snapshot();await expect(page.locator('#map-nearby')).toHaveText('0 engineers nearby');
  await page.locator('#map-nearby').click();await expect(page.locator('#map-people')).toContainText('No other engineers');
  ada.x=own.x+6*CELL;snapshot();await expect(page.locator('#map-people button')).toHaveCount(1);
  await socket!.close({code:1008,reason:'Test disconnect'});
  await expect(page.locator('#map-people')).toContainText('Reconnecting…');
  await expect(page.locator('#map-people button')).toHaveCount(0);
  await expect.poll(()=>colorPixels('minimap',ada)).toBe(0);
  assert.deepEqual(errors,[]);
  console.log('MAP PLAYERS PASSED: empty state, nearby presence through fog on both canvases, distance ordering, live movement, stable keyboard focus, list and marker waypoints, safe names, stationary color updates, responsive layouts, range exit, departures and disconnection.');
}catch(error){await page.screenshot({path:'.context/map-nearby-failure.png'});console.error('Browser errors:',errors);throw error;}
finally{await browser.close();}
