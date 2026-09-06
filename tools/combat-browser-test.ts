import {chromium,expect,type WebSocketRoute} from '@playwright/test';
import assert from 'node:assert/strict';
import {SharedWorld,type WorldProfile} from '../src/open-world';
import {CELL} from '../src/data';
import {isAction,validMove} from '../src/protocol';
import {combatState,isCombatAction,MOB_TYPES} from '../src/combat-data';
import {sceneryAround} from '../src/scenery';

// Two isolated browsers use the actual combat simulation with disposable profiles.
const world=new SharedWorld(),alice=world.createProfile('combat-alice','alice-token','Alice'),bob=world.createProfile('combat-bob','bob-token','Bob');
alice.progress.built=bob.progress.built=1;
bob.x=alice.x+1.8;bob.z=alice.z;
const online=new Set([alice.id,bob.id]),sockets=new Map<string,WebSocketRoute>();
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const pages=await Promise.all([browser.newPage({viewport:{width:1440,height:1000}}),browser.newPage({viewport:{width:1440,height:1000}})]);
const [a,b]=pages,errors:string[]=[],actions:unknown[]=[];let tickMobs=false;
const snapshot=()=>{for(const p of [alice,bob])sockets.get(p.id)?.send(JSON.stringify({type:'world',state:world.snapshot(p),players:[world.publicPlayer(alice),world.publicPlayer(bob)],bases:world.bases(online),explored:p.explored,revision:world.sim.revision,population:2}));};
world.combat.onHit=event=>{for(const ws of sockets.values())ws.send(JSON.stringify({type:'combat',event}));};
world.combat.onRespawn=p=>sockets.get(p.id)?.send(JSON.stringify({type:'respawn',x:p.x,z:p.z}));
for(const [index,page] of pages.entries()){
  const profile=index?bob:alice;page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/auth/session',route=>route.fulfill({json:{enabled:false}}));
  await page.routeWebSocket('**/api/world',ws=>{
    sockets.set(profile.id,ws);
    ws.onMessage(raw=>{
      const action=JSON.parse(String(raw));let message='';
      if(action.type==='join'){ws.send(JSON.stringify({type:'welcome',id:profile.id,token:profile.token}));snapshot();return;}
      if(action.type==='move'){
        if(combatState(profile).health>0&&validMove(world.sim,profile,action,.1)){profile.x=action.x;profile.z=action.z;}
        else ws.send(JSON.stringify({type:'correction',x:profile.x,z:profile.z}));return;
      }
      if(isCombatAction(action))message=world.combat.action(profile,action,online);
      else if(isAction(action))message=world.action(profile,action);
      if(action.type==='attack')actions.push({by:profile.id,action,message,time:world.sim.state.time,health:combatState(bob).health});
      if(message)ws.send(JSON.stringify({type:'result',message}));snapshot();
    });
  });
}
const timer=setInterval(()=>{world.sim.state.time+=.1;if(tickMobs)world.combat.tick(.1,online);else{for(const p of [alice,bob])if(combatState(p).health===0&&combatState(p).respawnAt<=world.sim.state.time){world.combat.tick(.1,new Set());break;}}snapshot();},100);
const state=(page:typeof a)=>page.evaluate(()=>(window as any).ironwood.snapshot());
const ready=()=>expect.poll(()=>world.sim.state.time>=combatState(alice).attackReady).toBe(true);
async function relocate(profile:WorldProfile,x:number,z:number){profile.x=x;profile.z=z;world.discover(profile);sockets.get(profile.id)!.send(JSON.stringify({type:'respawn',x,z}));snapshot();}
try{
  await Promise.all(pages.map(page=>page.goto(process.env.PLAY_URL||'http://localhost:5195')));
  await Promise.all(pages.map(page=>page.waitForFunction(()=>(window as any).ironwood?.session().connected)));
  await expect(a.getByLabel('Health and weapons')).toBeVisible();await expect(b.locator('#health-value')).toHaveText('100 / 100');
  await a.keyboard.press('KeyC');await expect(a.locator('[data-craft="club"]')).toBeVisible();await expect(a.locator('[data-craft="sword"]')).toBeVisible();
  const ingots=alice.inventory.ingot!;await a.locator('[data-craft="sword"]').click();await expect.poll(()=>combatState(alice).weapon).toBe('sword');assert.equal(alice.inventory.ingot,ingots-4);
  await a.screenshot({path:'.context/combat-crafting.png'});
  await a.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(a.getByLabel('Equipped weapon')).toHaveText('Iron sword');
  await expect(a.locator('.combat-hud select')).toHaveCount(0);await expect(a.locator('#player-health')).toHaveCSS('height','4px');
  await a.locator('#world').focus();await a.keyboard.press('KeyK');await expect(b.locator('#health-value')).toHaveText('72 / 100');
  await expect.poll(async()=>(await state(a)).combat.attackReady<=(await state(a)).time).toBe(true);
  // Targeted canvas input must hit the engineer rather than inspect the ground.
  const point=await a.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[bob.x/CELL,bob.z/CELL]);await a.mouse.click(point.x,point.y-15);
  await expect(b.locator('#health-value')).toHaveText('44 / 100');
  await a.screenshot({path:'.context/combat-duel.png'});
  for(const health of [16,0]){await ready();await a.locator('#world').focus();await a.keyboard.press('KeyK');await expect(b.locator('#health-value')).toHaveText(`${health} / 100`);}
  const supplies=structuredClone(bob.inventory);await expect(b.getByText('You fell in battle.',{exact:true})).toBeVisible();
  await b.screenshot({path:'.context/combat-death.png'});
  const corpse={x:bob.x,z:bob.z};await b.keyboard.down('KeyW');await b.waitForTimeout(250);await b.keyboard.up('KeyW');assert.deepEqual({x:bob.x,z:bob.z},corpse);
  await expect(b.locator('#health-value')).toHaveText('100 / 100',{timeout:6000});await expect(b.locator('.combat-death')).toBeHidden();
  assert.deepEqual(bob.inventory,supplies);assert.equal(combatState(bob).deaths,1);assert.equal(combatState(alice).kills,1);
  await expect.poll(async()=>(await state(b)).player).toEqual({x:bob.base.x*CELL,z:bob.base.z*CELL});await expect(b.locator('#combat-status')).toContainText('Protected');
  await b.screenshot({path:'.context/combat-respawn.png'});
  await b.reload();await b.waitForFunction(()=>(window as any).ironwood?.session().connected);assert.equal((await state(b)).combat.deaths,1);
  // Use an actual generated spawn to exercise creatures, animation, selection and loot.
  for(let i=0;i<21;i++)world.combat.tick(.1,online);
  const mob=[...world.combat.mobs.values()].sort((x,y)=>Math.hypot(x.x-alice.x,x.z-alice.z)-Math.hypot(y.x-alice.x,y.z-alice.z)).find(m=>world.sim.canWalk(m.x+1.5,m.z)&&world.combat.clearPath(m,{x:m.x+1.5,z:m.z})&&!world.combat.atHome({x:m.x+1.5,z:m.z}))!;
  assert.ok(mob);world.combat.mobs=new Map([[mob.id,mob]]);
  await relocate(alice,mob.x+1.5,mob.z);await expect(a.locator(`[data-mob="${mob.id}"]`)).toBeVisible();
  const mobPoint=await a.evaluate(([x,z])=>(window as any).ironwood.project(x,z),[mob.x/CELL,mob.z/CELL]);await a.mouse.click(mobPoint.x,mobPoint.y-12);
  await expect.poll(()=>mob.health).toBe(MOB_TYPES[mob.kind].health-28);
  tickMobs=true;await expect.poll(()=>combatState(alice).health).toBeLessThan(100);
  await a.screenshot({path:'.context/combat-wilderness.png'});
  tickMobs=false;
  for(let i=0;mob.health>0&&i<4;i++){await ready();await a.locator('#world').focus();await a.keyboard.press('KeyK');await a.waitForTimeout(200);}assert.equal(mob.health,0);
  await expect(a.locator(`[data-mob="${mob.id}"]`)).toHaveCount(0);assert.equal(combatState(alice).mobKills,1);
  for(let i=0;i<21;i++)world.combat.tick(.1,online);
  const slime=[...world.combat.mobs.values()].find(m=>m.kind==='slime'&&world.sim.canWalk(m.x+2,m.z)&&!world.combat.atHome({x:m.x+2,z:m.z}));
  assert.ok(slime);await relocate(alice,slime.x+2,slime.z);await expect(a.locator(`[data-mob="${slime.id}"]`)).toBeVisible();await a.screenshot({path:'.context/combat-slime.png'});
  alice.inventory.steel=3;snapshot();await a.keyboard.press('KeyC');await expect(a.locator('[data-craft="spear"]')).toBeEnabled();await a.locator('[data-craft="spear"]').click();await expect.poll(()=>combatState(alice).weapon).toBe('spear');
  await a.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(a.getByLabel('Equipped weapon')).toHaveText('Steel spear');
  await a.keyboard.press('KeyC');await a.locator('[data-craft="club"]').click();await a.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(a.getByLabel('Equipped weapon')).toHaveText('Steel spear');assert.equal(combatState(alice).weapon,'spear');
  // Climb a previously blocked face using ordinary movement; leave scenery out of this slope check.
  world.combat.mobs.clear();for(const node of sceneryAround(0,4,1))world.sim.state.harvested[node.id]=0;
  await relocate(alice,0,2*CELL);await a.locator('#world').focus();await a.keyboard.down('KeyS');
  await expect.poll(()=>alice.z).toBeGreaterThan(4*CELL);await a.keyboard.up('KeyS');
  await expect.poll(async()=>Math.abs((await state(a)).player.z-alice.z)).toBeLessThan(.15);
  await a.screenshot({path:'.context/combat-mountain.png'});
  // Empty swings animate immediately on both clients, including while moving and recovering.
  await relocate(alice,alice.base.x*CELL,alice.base.z*CELL);await relocate(bob,alice.x+10,alice.z);
  combatState(alice).health=100;combatState(alice).protectedUntil=0;snapshot();await ready();
  const healthBefore=combatState(bob).health;
  await a.locator('#world').focus();await a.keyboard.press('KeyK');
  await expect.poll(()=>a.evaluate(()=>(window as any).ironwood.combat().swings)).toContain(alice.id);
  await expect.poll(()=>b.evaluate(()=>(window as any).ironwood.combat().swings)).toContain(alice.id);
  assert.equal(combatState(bob).health,healthBefore);await expect(a.locator('.combat-damage')).toHaveCount(0);
  await expect(a.locator('#combat-attack')).toBeEnabled();
  await expect.poll(()=>a.evaluate(()=>(window as any).ironwood.combat().swings)).not.toContain(alice.id);
  const recoveryUntil=combatState(alice).attackReady;
  await a.locator('#combat-attack').click();
  await expect.poll(()=>a.evaluate(()=>(window as any).ironwood.combat().swings)).toContain(alice.id);
  assert.equal(combatState(alice).attackReady,recoveryUntil);
  await ready();await a.keyboard.down('KeyD');await a.keyboard.press('KeyK');
  await expect.poll(()=>a.evaluate(()=>(window as any).ironwood.combat().swings)).toContain(alice.id);
  await a.keyboard.up('KeyD');
  await expect(a.locator('#combat-status')).toBeHidden();
  await expect.poll(()=>a.evaluate(()=>(window as any).ironwood.combat().healthBars)).not.toContain(alice.id);
  await a.screenshot({path:'.context/combat-subtle-health.png'});
  for(const size of [{width:1024,height:768},{width:800,height:700}]){await a.setViewportSize(size);await expect(a.getByLabel('Health and weapons')).toBeInViewport();await expect(a.getByLabel('Equipped weapon')).toBeVisible();assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const hud=await a.locator('.combat-hud').boundingBox(),mission=await a.locator('.mission').boundingBox();assert.ok(hud&&mission&&mission.y+mission.height<hud.y,'health controls never cover mission controls');await a.screenshot({path:`.context/combat-${size.width}.png`});}
  assert.deepEqual(errors,[]);
  console.log('COMBAT BROWSER PASSED: automatic best weapon, steep mountain climbing, empty/remote/recovery/moving swings, targeted attacks, synchronized health, death, respawn, protection, creatures, loot, subtle responsive HUD.');
}catch(error){await a.screenshot({path:'.context/combat-browser-failure.png'});console.error('Combat browser errors:',errors,'attacks:',actions,'health:',alice.combat,bob.combat,'pages:',await Promise.all(pages.map(page=>page.evaluate(()=>({hidden:document.hidden,focus:document.activeElement?.outerHTML.slice(0,180),dialog:!!document.querySelector('dialog[open]'),health:(window as any).ironwood.snapshot().combat})))));throw error;}
finally{clearInterval(timer);await browser.close();}
