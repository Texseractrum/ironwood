import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SharedWorld,type WorldProfile} from '../src/open-world';
import {Simulation,building,ownsBuilding} from '../src/simulation';
import {isClanAction,TEAM_DISTANCE} from '../src/protocol';
import {CELL} from '../src/data';
import {chunkSites} from '../src/terrain';
import {discoveries} from '../src/discoveries';
import {tutorialStep} from '../src/tutorial';

function setup(){
  const world=new SharedWorld(),a=world.createProfile('a','token-a','Alice'),b=world.createProfile('b','token-b','Bob'),c=world.createProfile('c','token-c','Cara');
  b.x=a.x+CELL;b.z=a.z;c.x=a.x-CELL;c.z=a.z;
  return {world,a,b,c,online:new Set([a.id,b.id,c.id])};
}
function invite(w:SharedWorld,a:WorldProfile,b:WorldProfile,online:Set<string>,now=1000){
  assert.match(w.clans.action(a,{type:'team-invite',targetId:b.id},online,now),/sent/);
  return [...w.clans.invites.values()].find(i=>i.fromId===a.id&&i.toId===b.id)!;
}
function team(w:SharedWorld,a:WorldProfile,b:WorldProfile,online:Set<string>){
  const i=invite(w,a,b,online);assert.match(w.clans.action(b,{type:'team-accept',inviteId:i.id},online,1001),/Joined/);
}

test('clans require nearby, online players and explicit recipient consent; replay cannot duplicate inventory',()=>{
  const {world:w,a,b,c,online}=setup(),before=structuredClone(a.inventory);
  b.x=a.x+TEAM_DISTANCE+.01;
  assert.match(w.clans.action(a,{type:'team-invite',targetId:b.id},online,1000),/within 3 tiles/);
  b.x=a.x+CELL;
  assert.match(w.clans.action(a,{type:'team-invite',targetId:b.id},new Set(['a']),1000),/online/);
  assert.match(w.clans.action(a,{type:'team-invite',targetId:a.id},online,1000),/another/);
  const i=invite(w,a,b,online);assert.deepEqual(a.inventory,before);assert.equal(a.clanId,undefined);
  assert.match(w.clans.action(c,{type:'team-accept',inviteId:i.id},online,1001),/another engineer/);
  assert.match(w.clans.action(b,{type:'team-cancel',inviteId:i.id},online,1001),/sender/);
  assert.match(w.clans.action(b,{type:'team-accept',inviteId:i.id},online,1002),/Joined/);
  assert.equal(a.clanId,b.clanId);assert.ok(a.clanId);assert.equal(w.snapshot(a).inventory.log,180);
  assert.deepEqual(a.inventory,{});assert.deepEqual(b.inventory,{});assert.deepEqual(w.snapshot(a).inventory,w.snapshot(b).inventory);
  assert.match(w.clans.action(b,{type:'team-accept',inviteId:i.id},online,1003),/expired/);
  assert.equal(w.snapshot(a).inventory.log,180);assert.deepEqual(c.inventory,before);
});

test('decline, cancellation, distance, disconnect and time expiry never transfer supplies',()=>{
  for(const scenario of ['decline','cancel','move','offline','expire'] as const){
    const {world:w,a,b,online}=setup(),i=invite(w,a,b,online);
    if(scenario==='decline')w.clans.action(b,{type:'team-decline',inviteId:i.id},online,1001);
    if(scenario==='cancel')w.clans.action(a,{type:'team-cancel',inviteId:i.id},online,1001);
    if(scenario==='move')b.x=a.x+TEAM_DISTANCE+.01;
    if(scenario==='offline')online.delete(a.id);
    assert.match(w.clans.action(b,{type:'team-accept',inviteId:i.id},online,scenario==='expire'?61000:1002),/expired/);
    assert.equal(a.clanId,undefined);assert.equal(b.inventory.log,90);assert.equal(w.clans.saved.size,0);
  }
});

test('clan supplies fund crafting, construction, feeding, collecting and refunds with outsider protection',()=>{
  const {world:w,a,b,c,online}=setup();
  a.z+=2*CELL;
  assert.match(w.action(a,{type:'place',kind:'storage',x:a.base.x,z:a.base.z,dir:0}),/Built/);
  const chest=w.sim.state.buildings[0];team(w,a,b,online);
  const pooled=w.snapshot(a).inventory.log!;
  assert.match(w.action(b,{type:'craft',recipe:'plank'}),/Crafted/);assert.equal(w.snapshot(a).inventory.log,pooled-1);
  assert.match(w.action(b,{type:'place',kind:'furnace',x:a.base.x+2,z:a.base.z,dir:0}),/Built/);
  const furnace=w.sim.state.buildings.find(b=>b.kind==='furnace')!;
  assert.equal(furnace.owner,b.id);assert.match(w.action(a,{type:'feed',id:furnace.id}),/Loaded/);
  assert.equal(furnace.input.ore,6);
  chest.input={plank:12};const planks=w.snapshot(b).inventory.plank!;
  assert.match(w.action(b,{type:'collect',id:chest.id}),/Collected 12/);assert.equal(w.snapshot(a).inventory.plank,planks+12);
  for(const type of ['feed','collect','dismantle'] as const)assert.match(w.action(c,{type,id:chest.id}),/owner/);
  assert.match(w.action(c,{type:'place',kind:'storage',x:a.base.x-2,z:a.base.z,dir:0}),/another engineer/);
  const logs=w.snapshot(a).inventory.log!;
  assert.match(w.action(b,{type:'dismantle',id:chest.id}),/Dismantled/);assert.equal(w.snapshot(a).inventory.log,logs+8);
  assert.deepEqual(w.snapshot(a).inventory,w.snapshot(b).inventory);
  w.clans.resources(a).inventory={log:1};
  assert.match(w.action(a,{type:'craft',recipe:'plank'}),/Crafted/);
  assert.match(w.action(b,{type:'craft',recipe:'plank'}),/Not enough/);assert.equal(w.snapshot(a).inventory.log,0);
});

test('mining and tool upgrades are shared while each engineer keeps a separate mining cooldown',()=>{
  const {world:w,a,b,c,online}=setup();a.inventory.pickaxe=1;team(w,a,b,online);
  const coal=chunkSites(1,1).find(s=>s.item==='coal')!;
  a.x=b.x=coal.x*CELL;a.z=b.z=coal.z*CELL+2;
  assert.equal(w.snapshot(b).inventory.pickaxe,1);
  assert.match(w.action(a,{type:'gather',target:coal.id}),/Mined/);
  const first=w.snapshot(b).inventory.coal!;
  assert.match(w.action(b,{type:'gather',target:coal.id}),/Mined/);
  assert.equal(w.snapshot(a).inventory.coal,first*2);assert.equal(c.inventory.coal,undefined);
  const count=w.snapshot(a).inventory.coal;w.action(a,{type:'gather',target:coal.id});assert.equal(w.snapshot(b).inventory.coal,count);
  const homeLog=chunkSites(0,0).find(s=>s.item==='log')!;
  b.x=homeLog.x*CELL;b.z=homeLog.z*CELL+2;w.tick(1);
  assert.doesNotMatch(w.action(b,{type:'gather',target:homeLog.id}),/another engineer/);
});

test('new members contribute once; existing clan balances and combined unlocks persist without duplication',()=>{
  const {world:w,a,b,c,online}=setup();a.progress.produced={ingot:6};b.progress.produced={ingot:4};
  team(w,a,b,online);assert.equal(w.snapshot(b).unlock,1);
  const before=w.snapshot(a).inventory.log!;team(w,c,b,online);
  assert.equal(c.clanId,a.clanId);assert.equal(w.snapshot(c).inventory.log,before+90);
  assert.equal(w.snapshot(a).produced.ingot,10);assert.equal(w.clans.summary(a,online)?.members.length,3);
  const loaded=new SharedWorld(Simulation.restore(w.sim.serialize()).state);
  for(const p of w.profiles.values())loaded.profiles.set(p.id,JSON.parse(JSON.stringify(p)));
  for(const clan of w.clans.saved.values())loaded.clans.saved.set(clan.id,JSON.parse(JSON.stringify(clan)));
  const savedA=loaded.profiles.get(a.id)!,savedB=loaded.profiles.get(b.id)!;
  assert.deepEqual(loaded.snapshot(savedA).inventory,w.snapshot(a).inventory);
  loaded.action(savedA,{type:'craft',recipe:'plank'});assert.deepEqual(loaded.snapshot(savedB).inventory,loaded.snapshot(savedA).inventory);
  const summary=loaded.clans.summary(savedA,new Set([a.id]))!;assert.equal(summary.members.filter(p=>p.online).length,1);assert.equal(JSON.stringify(summary).includes('token'),false);
});

test('joining invalidates conflicting invitations and clans cannot absorb another established clan',()=>{
  const {world:w,a,b,c,online}=setup();const stale=invite(w,c,b,online);team(w,a,b,online);
  assert.match(w.clans.action(b,{type:'team-accept',inviteId:stale.id},online,1002),/expired/);
  const d=w.createProfile('d','d','Drew');d.x=c.x;d.z=c.z;online.add(d.id);team(w,c,d,online);
  assert.match(w.clans.action(a,{type:'team-invite',targetId:c.id},online,1003),/different clans/);
});

test('clan capacity is checked on acceptance, including simultaneous invitations for the last slot',()=>{
  const {world:w,a,b,c,online}=setup();team(w,a,b,online);
  for(let n=3;n<=7;n++){const p=w.createProfile(String(n),String(n),'Member');p.x=a.x;p.z=a.z;online.add(p.id);team(w,a,p,online);}
  const d=w.createProfile('d','d','Drew');d.x=a.x;d.z=a.z;online.add(d.id);
  const pending=invite(w,b,d,online);team(w,a,c,online);
  assert.match(w.clans.action(d,{type:'team-accept',inviteId:pending.id},online,1002),/full/);
  assert.equal(w.clans.summary(a,online)!.members.length,8);assert.equal(d.clanId,undefined);assert.equal(d.inventory.log,90);
});

test('production, progress and building visibility include all clan members without double counting',()=>{
  const {world:w,a,b,c,online}=setup();team(w,a,b,online);
  const furnace=building('furnace',a.base.x,a.base.z,0,1);furnace.owner=a.id;furnace.input={ore:8};
  const wind=building('windmill',a.base.x+3,a.base.z,0,2);wind.owner=b.id;
  w.sim.state.buildings.push(furnace,wind);w.sim.reindex();for(let i=0;i<100;i++)w.tick(.1);
  assert.equal(w.snapshot(a).produced.ingot,furnace.produced);assert.deepEqual(w.snapshot(a).produced,w.snapshot(b).produced);assert.equal(w.snapshot(c).produced.ingot,undefined);
  b.x=2000*CELL;b.z=2000*CELL;const snapshot=w.snapshot(b);
  assert.equal(snapshot.buildings.length,2);assert.ok(ownsBuilding(snapshot,furnace));assert.ok(!ownsBuilding(w.snapshot(c),furnace));
  furnace.output={crystal:1};assert.ok(discoveries(w.snapshot(b)).materials.includes('crystal'));
  const lumber=building('lumber',a.base.x-3,a.base.z,0,3);lumber.owner=a.id;w.sim.state.buildings.push(lumber);w.sim.reindex();
  assert.notEqual(tutorialStep(new Simulation(w.snapshot(b)))?.id,'lumber');
});

test('clan commands reject malformed and oversized identifiers',()=>{
  for(const value of [null,{},[],{type:{toString:7},inviteId:'a'},{type:'team-invite'},{type:'team-invite',targetId:7},{type:'team-accept',inviteId:''},{type:'team-accept',inviteId:'a'.repeat(101)},{type:'team-delete',inviteId:'a'}])assert.equal(isClanAction(value),false);
  assert.equal(isClanAction({type:'team-invite',targetId:'engineer'}),true);assert.equal(isClanAction({type:'team-accept',inviteId:'invite'}),true);
});

test('conveyors join clan factories while unrelated factories cannot siphon goods',()=>{
  const {world:w,a,b,c,online}=setup();
  const source=building('storage',a.base.x,a.base.z,0,1),belt=building('conveyor',a.base.x+1,a.base.z,0,2),sink=building('storage',a.base.x+2,a.base.z,0,3);
  source.owner=a.id;belt.owner=b.id;sink.owner=b.id;source.input={plank:3};
  w.sim.state.buildings.push(source,belt,sink);w.sim.reindex();w.tick(1);
  assert.equal(source.input.plank,3);assert.equal(belt.item,undefined);
  team(w,a,b,online);for(let n=0;n<12;n++)w.tick(1);
  assert.equal(sink.input.plank,3);assert.equal(source.input.plank,0);
  const outsider=building('storage',a.base.x+3,a.base.z,0,4);outsider.owner=c.id;w.sim.state.buildings.push(outsider);w.sim.reindex();
  for(let n=0;n<8;n++)w.tick(1);assert.equal(sink.input.plank,3);assert.equal(outsider.input.plank,undefined);
});
