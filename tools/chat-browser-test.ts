import {chromium,expect,type Page} from '@playwright/test';

const base=process.env.PLAY_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const peer=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
for(const tab of [page,peer])tab.on('pageerror',error=>errors.push(error.message));
const state=(tab:Page)=>tab.evaluate(()=>(window as any).ironwood.session());
const packets:any[]=[];
page.on('websocket',socket=>socket.on('framesent',frame=>packets.push(JSON.parse(String(frame.payload)))));
async function load(tab:Page){
  await tab.goto(base);await tab.waitForFunction(()=>(window as any).ironwood?.session().connected,{timeout:30000});
  const intro=tab.getByRole('button',{name:'Look around first'});
  await expect(intro).toBeVisible({timeout:15000});await intro.click();
  await expect(tab.locator('dialog[open]')).toHaveCount(0);
}
try{
  await load(peer);await load(page);
  const senderId=(await state(page)).id;
  const chatTab=page.getByRole('button',{name:'World chat',exact:true});
  const composer=page.getByLabel('Live message above your engineer');
  const hints=page.locator('#dock-hints'),hint=page.getByLabel('Player hint',{exact:true}),dock=page.locator('.build-dock');
  await page.getByRole('button',{name:'Open settings',exact:true}).hover();
  await expect(hint).toBeVisible({timeout:20000});
  const hintBox=await hint.boundingBox(),dockBox=await dock.boundingBox();
  expect(hintBox!.y).toBeGreaterThan(700);
  expect(dockBox!.y-(hintBox!.y+hintBox!.height)).toBeCloseTo(8,0);
  await expect(page.locator('.nameplate-button')).toHaveCSS('min-height','30px');
  await page.screenshot({path:'.context/player-hints.png'});
  await dock.hover();await expect(hints).toBeHidden();
  await page.getByRole('button',{name:'Open settings',exact:true}).hover();await expect(hint).toBeVisible();
  await page.getByRole('tab',{name:'Production',exact:true}).focus();await expect(hints).toBeHidden();
  await page.locator('#build-toggle').click();
  await page.locator('#world').focus();await page.getByRole('button',{name:'Open settings',exact:true}).hover();await expect(hints).toBeHidden();
  await page.screenshot({path:'.context/hints-dock-expanded.png'});
  await page.locator('#build-toggle').click();
  await page.locator('#world').focus();await page.getByRole('button',{name:'Open settings',exact:true}).hover();await expect(hints).toBeVisible();
  await hint.getByRole('button',{name:'Hide hints'}).click();await expect(hint).toBeHidden();
  // Contextual hover labels and placement guidance share the bottom hint area.
  await page.locator('#world').focus();await page.keyboard.press('KeyB');await page.mouse.move(720,400);
  await expect(page.locator('#build-hint')).toBeVisible();
  expect((await page.locator('#build-hint').boundingBox())!.y).toBeGreaterThan(750);
  await page.keyboard.press('Escape');

  await peer.getByRole('button',{name:'World chat',exact:true}).click();
  const before=await page.evaluate(()=>(window as any).ironwood.snapshot().player);
  await page.keyboard.press('Slash');await expect(composer).toBeFocused();
  // Overhead speech still broadcasts each letter, without appearing in world chat.
  for(const draft of ['w','wa','was','wasd']){
    await page.keyboard.insertText(draft.at(-1)!);
    await expect.poll(async()=>(await state(peer)).players.find((p:any)=>p.id===senderId)?.speech?.text).toBe(draft);
    await expect(peer.locator('#chat-live')).toHaveCount(0);
    await expect(peer.locator('#chat-messages').getByText(draft,{exact:true})).toHaveCount(0);
  }
  expect(await page.evaluate(()=>(window as any).ironwood.snapshot().player)).toEqual(before);
  await composer.press('Backspace');
  await expect.poll(async()=>(await state(peer)).players.find((p:any)=>p.id===senderId)?.speech?.text).toBe('was');
  await composer.fill('');
  await expect.poll(async()=>(await state(peer)).players.find((p:any)=>p.id===senderId)?.speech).toBeFalsy();
  const message='Hello from the ridge '+Date.now();
  await composer.fill(message);
  await expect.poll(async()=>(await state(peer)).players.find((p:any)=>p.id===senderId)?.speech?.text).toBe(message);
  await page.screenshot({path:'.context/live-chat-composer.png'});
  await composer.press('Escape');const overheadSentAt=Date.now();await expect(composer).toBeHidden();
  await expect(peer.locator('#chat-messages').getByText(message,{exact:true})).toBeVisible();
  expect((await state(peer)).chat.filter((m:any)=>m.text===message)).toHaveLength(1);

  await chatTab.click();
  const input=page.getByRole('textbox',{name:'Message the world',exact:true});
  await expect(input).toBeFocused();
  const panelMessage='Private draft '+Date.now();
  await input.fill(panelMessage);await input.press('Escape');
  await expect(page.locator('#chat-panel')).toBeHidden();
  await expect(peer.locator('#chat-messages').getByText(panelMessage,{exact:true})).toHaveCount(0);
  expect((await state(peer)).players.find((p:any)=>p.id===senderId)?.speech?.text).not.toBe(panelMessage);
  expect(packets.filter(packet=>packet.text===panelMessage)).toHaveLength(0);
  await chatTab.click();await expect(input).toHaveValue(panelMessage);
  await expect.poll(()=>Date.now()-overheadSentAt).toBeGreaterThanOrEqual(750);
  await input.press('Enter');const lastSentAt=Date.now();await expect(input).toHaveValue('');
  await expect(peer.locator('#chat-messages').getByText(panelMessage,{exact:true})).toBeVisible();
  expect((await state(peer)).chat.filter((m:any)=>m.text===panelMessage)).toHaveLength(1);
  // The server allows one completed world-chat message every 750 ms.
  await expect.poll(()=>Date.now()-lastSentAt).toBeGreaterThanOrEqual(750);
  await input.fill('<img src=x onerror=alert(1)> 🪵');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(peer.locator('#chat-messages').getByText('<img src=x onerror=alert(1)> 🪵',{exact:true})).toBeVisible();
  await expect(peer.locator('#chat-messages p img')).toHaveCount(0);
  await peer.screenshot({path:'.context/world-chat-completed.png'});

  await page.setViewportSize({width:768,height:900});
  const panel=page.locator('#chat-panel'),bounds=await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(768);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(900);
  await page.screenshot({path:'.context/world-chat-mobile.png'});
  await page.getByRole('button',{name:'Collapse world chat'}).click();
  await page.setViewportSize({width:1024,height:768});
  await page.locator('#world').focus();await page.mouse.move(510,350);
  await page.keyboard.press('KeyB');await page.mouse.move(510,350);
  await expect(page.locator('#build-hint')).toBeVisible();
  const smallHint=await page.locator('#build-hint').boundingBox();
  expect(smallHint!.y).toBeGreaterThan(560);expect(smallHint!.y+smallHint!.height).toBeLessThan(768);
  await page.screenshot({path:'.context/hints-1024.png'});
  expect(errors).toEqual([]);
  console.log('CHAT / HUD PASSED: lower hints; hover, focus, and pinned hiding; compact tags; overhead letters only; private panel drafts; explicit sends; safe text; responsive bounds.');
}finally{await browser.close();}
