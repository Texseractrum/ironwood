import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {building} from '../src/simulation';
import {CELL} from '../src/data';
import {CLAIM_RADIUS} from '../src/terrain';
import {MAX_HEALTH,MOB_TYPES,WEAPONS,bestWeapon,combatState,isCombatAction,type CombatEvent,type Mob} from '../src/combat-data';

function battle(){
  const world=new SharedWorld(),alice=world.createProfile('alice','a','Alice'),bob=world.createProfile('bob','b','Bob'),online=new Set(['alice','bob']);
  alice.x=alice.base.x*CELL;alice.z=alice.base.z*CELL;
  bob.x=alice.x+1.8;bob.z=alice.z;
  assert.ok(world.sim.canWalk(alice.x,alice.z)&&world.sim.canWalk(bob.x,bob.z));
  return {world,alice,bob,online,attack:()=>world.combat.action(alice,{type:'attack',target:{kind:'player',id:bob.id}},online)};
}
test('combat commands validate enums and bounded targets without accepting damage from clients',()=>{
  for(const action of [null,{}, {type:'equip',weapon:'laser'},{type:'attack',target:{kind:'base',id:'a'}},{type:'attack',target:{kind:'mob',id:''}},{type:'attack',target:{kind:'player',id:'x'.repeat(101)}}])assert.equal(isCombatAction(action),false);
  assert.ok(isCombatAction({type:'attack',target:{kind:'player',id:'alice'},damage:100000}));
  assert.ok(isCombatAction({type:'equip',weapon:'sword'}));
  assert.ok(isCombatAction({type:'attack'}));
  assert.ok(isCombatAction({type:'attack',angle:Math.PI}));
  for(const action of [{type:'attack',target:null},{type:'attack',angle:NaN},{type:'attack',angle:Infinity},{type:'attack',angle:'east'}])assert.equal(isCombatAction(action),false);
  const {alice,bob,world,online}=battle();world.combat.action(alice,{type:'attack',target:{kind:'player',id:bob.id},damage:100000} as any,online);
  assert.equal(combatState(bob).health,MAX_HEALTH-WEAPONS.fists.damage);
});
test('empty swings broadcast the facing direction without damage or loot, and respect cooldowns',()=>{
  const {world,alice,bob,online}=battle(),events:CombatEvent[]=[],inventory=structuredClone(alice.inventory);
  combatState(alice).protectedUntil=5;world.combat.onHit=event=>events.push(event);
  assert.equal(world.combat.action(alice,{type:'attack',angle:Math.PI/2},online),'');
  assert.equal(events.length,1);assert.equal(events[0].target,undefined);assert.equal(events[0].damage,0);
  assert.ok(Math.abs(events[0].x-alice.x-WEAPONS.fists.range)<1e-9);assert.equal(events[0].z,alice.z);
  assert.equal(combatState(bob).health,100);assert.equal(combatState(alice).kills,0);assert.deepEqual(alice.inventory,inventory);
  assert.equal(combatState(alice).protectedUntil,0);assert.equal(combatState(alice).attackReady,WEAPONS.fists.cooldown);
  for(let i=0;i<20;i++)world.combat.action(alice,{type:'attack'},online);
  assert.equal(events.length,1);
  world.sim.state.time+=WEAPONS.fists.cooldown;world.combat.action(alice,{type:'attack'},online);assert.equal(events.length,2);
  combatState(alice).health=0;assert.match(world.combat.action(alice,{type:'attack'},online),/respawning/);assert.equal(events.length,2);
  combatState(alice).health=100;assert.match(world.combat.action(alice,{type:'attack'},new Set()),/Reconnect/);assert.equal(events.length,2);
});
test('the strongest owned tier equips on crafting, replication, and attacks without downgrading',()=>{
  const {world,alice,bob,online,attack}=battle();
  assert.equal(bestWeapon({}), 'fists');assert.equal(bestWeapon({club:0,sword:-1}),'fists');
  world.action(alice,{type:'craft',recipe:'sword'});world.action(alice,{type:'craft',recipe:'club'});
  assert.equal(combatState(alice).weapon,'sword');
  world.combat.action(alice,{type:'equip',weapon:'club'},online);assert.equal(combatState(alice).weapon,'sword');
  alice.inventory.spear=1;assert.equal(world.snapshot(alice).combat?.weapon,'spear');
  delete alice.inventory.spear;assert.equal(world.publicPlayer(alice).combat?.weapon,'sword');
  combatState(alice).weapon='fists';attack();assert.equal(combatState(alice).weapon,'sword');assert.equal(combatState(bob).health,72);
  delete alice.inventory.sword;assert.equal(world.snapshot(alice).combat?.weapon,'club');
  delete alice.inventory.club;assert.equal(world.snapshot(alice).combat?.weapon,'fists');
});
test('legacy profiles start at full health and crafting equips only successfully paid weapons',()=>{
  const {world,alice}=battle();delete alice.combat;
  assert.equal(world.snapshot(alice).combat?.health,100);
  const timber=alice.inventory.log!;world.action(alice,{type:'craft',recipe:'club'});
  assert.equal(alice.inventory.log,timber-6);assert.equal(alice.inventory.club,1);assert.equal(combatState(alice).weapon,'club');
  world.action(alice,{type:'craft',recipe:'sword'});assert.equal(combatState(alice).weapon,'sword');
  const inventory={...alice.inventory};assert.match(world.action(alice,{type:'craft',recipe:'spear'}),/Not enough/);
  assert.equal(combatState(alice).weapon,'sword');assert.deepEqual(alice.inventory,inventory);
});
test('damage, cooldown, equipment ownership, range, offline targets and self attacks are authoritative',()=>{
  const {world,alice,bob,online,attack}=battle();
  assert.match(world.combat.action(alice,{type:'equip',weapon:'spear'},online),/Craft/);
  world.action(alice,{type:'craft',recipe:'sword'});attack();assert.equal(combatState(bob).health,72);
  for(let i=0;i<20;i++)attack();assert.equal(combatState(bob).health,72);
  world.sim.state.time+=.61;bob.x+=10;assert.match(attack(),/closer/);assert.equal(combatState(bob).health,72);
  bob.x=alice.x+1.8;online.delete(bob.id);assert.match(attack(),/not available/);
  assert.match(world.combat.action(alice,{type:'attack',target:{kind:'player',id:alice.id}},online),/yourself/);
});
test('weapons cannot hit through machines or scenery',()=>{
  const {world,alice,bob,attack}=battle();alice.inventory.spear=1;combatState(alice).weapon='spear';
  const wall=building('storage',alice.base.x+1,alice.base.z,0,1);world.sim.state.buildings.push(wall);world.sim.reindex();bob.x=alice.x+4.7;
  assert.match(attack(),/obstacle/);assert.equal(combatState(bob).health,100);
});
test('death stops actions, counts one kill, preserves supplies and respawns on the victim’s base',()=>{
  const {world,alice,bob,online,attack}=battle();world.action(alice,{type:'craft',recipe:'sword'});
  const supplies=structuredClone(bob.inventory),progress=structuredClone(bob.progress);
  for(let i=0;i<4;i++){attack();world.sim.state.time+=.61;}
  assert.equal(combatState(bob).health,0);assert.equal(combatState(bob).deaths,1);assert.equal(combatState(alice).kills,1);
  assert.match(world.action(bob,{type:'craft',recipe:'club'}),/respawning/);
  assert.match(world.combat.action(bob,{type:'attack',target:{kind:'player',id:alice.id}},online),/respawning/);
  attack();assert.equal(combatState(alice).kills,1);assert.deepEqual(bob.inventory,supplies);
  // Buildings in the original spawn point are avoided without moving the base.
  world.sim.state.buildings.push(building('storage',bob.base.x,bob.base.z,0,1));world.sim.reindex();
  world.sim.state.time=combatState(bob).respawnAt;world.combat.tick(.1,online);
  assert.equal(combatState(bob).health,100);assert.equal(combatState(bob).respawnAt,0);
  assert.ok(Math.hypot(bob.x/CELL-bob.base.x,bob.z/CELL-bob.base.z)<CLAIM_RADIUS);
  assert.ok(world.sim.canWalk(bob.x,bob.z));assert.deepEqual(bob.inventory,supplies);assert.deepEqual(bob.progress,progress);
  assert.equal(combatState(bob).protectedUntil,world.sim.state.time+5);
});
test('respawn protection blocks damage and ends on a successful attack',()=>{
  const {world,alice,bob,online,attack}=battle();combatState(bob).protectedUntil=5;
  assert.match(attack(),/protection/);assert.equal(combatState(bob).health,100);
  assert.equal(world.combat.action(bob,{type:'attack',target:{kind:'player',id:alice.id}},online),'');
  assert.equal(combatState(bob).protectedUntil,0);attack();assert.equal(combatState(bob).health,92);
});
test('clan members share crafted equipment and cannot damage each other',()=>{
  const {world,alice,bob,online,attack}=battle();
  world.clans.action(alice,{type:'team-invite',targetId:bob.id},online);
  world.clans.action(bob,{type:'team-accept',inviteId:[...world.clans.invites.keys()][0]},online);
  world.action(alice,{type:'craft',recipe:'sword'});
  assert.equal(world.snapshot(bob).combat?.weapon,'sword');assert.equal(world.publicPlayer(bob).combat?.weapon,'sword');
  assert.match(world.combat.action(bob,{type:'equip',weapon:'sword'},online),/equipped/);
  assert.match(attack(),/clan/);assert.equal(combatState(bob).health,100);
});
test('saved deaths and cooldowns survive a world restart, including disconnected victims',()=>{
  const {world,alice,bob,attack}=battle();world.action(alice,{type:'craft',recipe:'sword'});
  for(let i=0;i<4;i++){attack();world.sim.state.time+=.61;}
  const restored=new SharedWorld(structuredClone(world.sim.state));
  for(const p of world.profiles.values())restored.profiles.set(p.id,structuredClone(p));
  const victim=restored.profiles.get(bob.id)!;assert.equal(combatState(victim).health,0);
  restored.sim.state.time=combatState(victim).respawnAt;restored.combat.tick(.1,new Set([alice.id]));
  assert.equal(combatState(victim).health,100);assert.equal(victim.x,victim.base.x*CELL);
  assert.equal(restored.publicPlayer(restored.profiles.get(alice.id)!).combat?.kills,1);
});
test('home healing requires time out of combat and the engineer’s own base',()=>{
  const {world,alice,bob,online,attack}=battle();attack();world.sim.state.time=10;
  world.combat.tick(.1,online);assert.equal(combatState(bob).health,92,'someone else’s base does not heal you');
  world.spawnAtBase(bob);world.combat.tick(1,online);assert.equal(combatState(bob).health,97);
  world.combat.tick(1,online);assert.equal(combatState(bob).health,100);
  combatState(alice).health=10;combatState(alice).lastHitAt=world.sim.state.time;
  world.combat.tick(1,online);assert.equal(combatState(alice).health,10);
});
function wilderness(){
  const {world,alice,online}=battle();online.delete('bob');world.combat.tick(.1,online);
  const mob=[...world.combat.mobs.values()].sort((a,b)=>Math.hypot(a.x-alice.x,a.z-alice.z)-Math.hypot(b.x-alice.x,b.z-alice.z)).find(m=>world.sim.canWalk(m.x+1.3,m.z)&&!world.combat.atHome({x:m.x+1.3,z:m.z})&&world.combat.clearPath(m,{x:m.x+1.3,z:m.z}))!;
  assert.ok(mob,'world creates creatures in walkable wilderness');
  alice.x=mob.x+1.3;alice.z=mob.z;mob.homeX=mob.x;mob.homeZ=mob.z;
  world.combat.mobs=new Map([[mob.id,mob]]);
  return {world,alice,online,mob};
}
test('mobs spawn deterministically outside home plots and only replicate nearby living creatures',()=>{
  const a=battle(),b=battle();a.world.combat.tick(.1,a.online);b.world.combat.tick(.1,b.online);
  assert.deepEqual([...a.world.combat.mobs.values()],[...b.world.combat.mobs.values()]);assert.ok(a.world.combat.mobs.size>0);
  for(const mob of a.world.combat.mobs.values()){assert.equal(a.world.combat.atHome(mob),false);assert.ok(a.world.sim.canWalk(mob.x,mob.z));}
  assert.ok(a.world.snapshot(a.alice).mobs!.every(m=>Math.hypot(m.x-a.alice.x,m.z-a.alice.z)<CELL*22));
});
test('mobs chase and damage engineers, respect protection, and do not attack disconnected players',()=>{
  const {world,alice,online,mob}=wilderness();
  combatState(alice).protectedUntil=10;world.combat.tick(.1,online);assert.equal(combatState(alice).health,100);
  combatState(alice).protectedUntil=0;world.combat.tick(.1,online);
  assert.equal(combatState(alice).health,100-MOB_TYPES[mob.kind].damage);assert.equal(mob.targetId,alice.id);
  const health=combatState(alice).health;world.sim.state.time+=3;world.combat.tick(.1,new Set());assert.equal(combatState(alice).health,health);
  world.spawnAtBase(alice);world.combat.tick(.1,online);assert.equal(mob.targetId,undefined);
});
test('creatures close the distance before attacking and cannot damage through cover',()=>{
  const {world,alice,online,mob}=wilderness();
  const approach=Array.from({length:16},(_,i)=>({x:mob.x+Math.cos(i*Math.PI/8)*3,z:mob.z+Math.sin(i*Math.PI/8)*3})).find(p=>world.sim.canWalk(p.x,p.z)&&!world.combat.atHome(p)&&world.combat.clearPath(mob,p));
  assert.ok(approach);alice.x=approach.x;alice.z=approach.z;
  const distance=Math.hypot(alice.x-mob.x,alice.z-mob.z);world.combat.tick(.1,online);
  assert.ok(Math.hypot(alice.x-mob.x,alice.z-mob.z)<distance);assert.equal(combatState(alice).health,100);
  // A tree/rock-sized obstacle at the middle of a strike blocks its path.
  const original=world.sim.canWalk.bind(world.sim),mid={x:(alice.x+mob.x)/2,z:(alice.z+mob.z)/2};
  world.sim.canWalk=(x,z)=>Math.hypot(x-mid.x,z-mid.z)>.5&&original(x,z);
  assert.equal(world.combat.clearPath(mob,alice),false);
});
test('defeated mobs award loot once, disappear and respawn after players leave the spawn',()=>{
  const {world,alice,online,mob}=wilderness();alice.inventory.spear=1;combatState(alice).weapon='spear';
  const before=structuredClone(alice.inventory),loot=MOB_TYPES[mob.kind].loot;
  for(let i=0;i<3;i++){world.combat.action(alice,{type:'attack',target:{kind:'mob',id:mob.id}},online);world.sim.state.time+=1.01;}
  assert.equal(mob.health,0);assert.equal(combatState(alice).mobKills,1);
  for(const [item,amount] of Object.entries(loot))assert.equal(alice.inventory[item as keyof typeof before],(before[item as keyof typeof before]||0)+amount);
  assert.equal(world.snapshot(alice).mobs!.some(m=>m.id===mob.id),false);
  world.combat.action(alice,{type:'attack',target:{kind:'mob',id:mob.id}},online);assert.equal(combatState(alice).mobKills,1);
  world.sim.state.time=mob.respawnAt;world.combat.tick(.1,online);assert.equal(mob.health,0,'no respawn underneath a player');
  world.spawnAtBase(alice);world.combat.tick(.1,online);assert.equal(mob.health,MOB_TYPES[mob.kind].health);
});
test('mob populations remain bounded and inactive creatures expire',()=>{
  const {world,alice,online}=battle();
  for(let i=0;i<20;i++){alice.x+=CELL*CHUNK_SPACING;world.combat.tick(2,online);}
  assert.ok(world.combat.mobs.size<=96);
  const expired:Mob={id:'expired',kind:'wolf',x:1e6,z:1e6,homeX:1e6,homeZ:1e6,health:60,attackReady:0,respawnAt:0,lastActive:0};world.combat.mobs.set(expired.id,expired);
  world.sim.state.time=100;world.combat.tick(.1,online);assert.equal(world.combat.mobs.has(expired.id),false);
});
const CHUNK_SPACING=64;
