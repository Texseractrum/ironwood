import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SharedWorld,freshProgress} from '../src/open-world';
import {leaderboard,LEADERBOARD_PAGE_SIZE} from '../src/leaderboard';
import {Simulation,building} from '../src/simulation';
import type {XProfile} from '../src/identity';
import {ITEMS,type Stock} from '../src/data';

const identity=(id:string):XProfile=>({id,name:'Engineer '+id,username:'engineer_'+id,verified:false,verifiedType:'none'});
function account(world:SharedWorld,id:string,materials=0){
  const p=world.accountProfile(identity(id));p.inventory={log:materials};return p;
}

test('only X-linked accounts qualify, including zero scores, unpaid verification and offline accounts',()=>{
  const world=new SharedWorld(),guest=world.createProfile('guest','private-token','Guest');guest.inventory={log:1000};
  assert.deepEqual(leaderboard(world),{entries:[],total:0,page:1,pages:1,own:null});
  const zero=account(world,'1'),leader=account(world,'2',12);
  const board=leaderboard(world,'1');
  assert.equal(board.total,2);assert.deepEqual(board.entries.map(p=>[p.playerId,p.rank,p.totalMaterials]),[[leader.id,1,12],[zero.id,2,0]]);
  assert.equal(board.own?.playerId,zero.id);
  assert.equal(leaderboard(world,'unknown').own,null);
  for(const entry of board.entries){
    assert.deepEqual(Object.keys(entry).sort(),['clan','playerId','profile','rank','totalMaterials']);
    for(const field of ['token','inventory','base','explored','progress'])assert.equal(field in entry,false);
  }
  assert.equal(JSON.stringify(board).includes('private-token'),false);
});

test('scores sum current inventory across every item type, independently of lifetime progress',()=>{
  const world=new SharedWorld(),a=account(world,'1'),b=account(world,'2',19),empty=account(world,'3');
  a.inventory=Object.fromEntries(Object.keys(ITEMS).map(item=>[item,2])) as Stock;
  b.progress.delivered=1000;b.progress.gathered=2000;b.progress.produced={mechanism:3000};empty.inventory={};
  const board=leaderboard(world,'1');
  assert.deepEqual(board.entries.map(p=>[p.playerId,p.rank,p.totalMaterials]),[[a.id,1,38],[b.id,2,19],[empty.id,3,0]]);
  assert.equal(board.own?.totalMaterials,38);
});

test('crafting and collecting recalculate current inventory totals and ranks',()=>{
  const world=new SharedWorld(),a=account(world,'1'),b=account(world,'2',3);
  a.inventory={ore:4};
  assert.equal(leaderboard(world,'1').own?.rank,1);
  assert.match(world.action(a,{type:'craft',recipe:'ingot'}),/Crafted/);
  assert.equal(leaderboard(world,'1').own?.totalMaterials,3);
  assert.equal(leaderboard(world,'2').own?.rank,1,'crafting can create a tie');
  assert.match(world.action(a,{type:'craft',recipe:'ingot'}),/Crafted/);
  assert.equal(leaderboard(world,'1').own?.totalMaterials,2);
  assert.equal(leaderboard(world,'1').own?.rank,2,'spending lowers the score');
  const chest=building('storage',a.base.x,a.base.z,0,100);chest.owner=a.id;chest.input={plank:3,gear:2};
  world.sim.state.buildings.push(chest);world.sim.reindex();
  assert.match(world.action(a,{type:'collect',id:chest.id}),/Collected 5/);
  assert.equal(leaderboard(world,'1').own?.totalMaterials,7);
  assert.equal(leaderboard(world,'1').own?.rank,1);
  assert.equal(leaderboard(world,'2').own?.totalMaterials,3,'another account keeps its own total');
});

test('equal scores share competition rank with stable account ordering, even after a handle change',()=>{
  const world=new SharedWorld();account(world,'20',15);account(world,'10',15);account(world,'30',7);account(world,'40',0);
  assert.deepEqual(leaderboard(world).entries.map(p=>[p.profile.id,p.rank]),[['10',1],['20',1],['30',3],['40',4]]);
  world.accountProfile({...identity('20'),name:'AAA renamed',username:'new_handle'});
  assert.deepEqual(leaderboard(world).entries.map(p=>[p.profile.id,p.rank]),[['10',1],['20',1],['30',3],['40',4]]);
});

test('pagination keeps global ranks and returns your position outside the current page',()=>{
  const world=new SharedWorld();
  for(let i=1;i<=LEADERBOARD_PAGE_SIZE+2;i++)account(world,String(i),100-i);
  const first=leaderboard(world,'52');assert.equal(first.entries.length,50);assert.equal(first.pages,2);assert.equal(first.own?.rank,52);
  const second=leaderboard(world,undefined,2);assert.deepEqual(second.entries.map(p=>p.rank),[51,52]);
  for(const page of [0,-1,NaN,Infinity,1.5])assert.equal(leaderboard(world,undefined,page).page,1);
  assert.equal(leaderboard(world,undefined,999).page,2);
  world.profiles.get(first.entries[49].playerId)!.inventory={log:second.entries[0].totalMaterials};
  assert.equal(leaderboard(world,undefined,2).entries[0].rank,50,'ties cross the page boundary');
});

test('linking a guest preserves score and returning login keeps a single account entry',()=>{
  const world=new SharedWorld(),guest=world.createProfile('guest','guest-token','Guest');guest.inventory={log:20,ore:8};
  world.accountProfile(identity('1'),'guest-token');
  assert.equal(leaderboard(world,'1').own?.totalMaterials,28);
  const other=world.createProfile('other','other-token','Other');other.inventory={log:99};
  world.accountProfile(identity('1'),'other-token');
  assert.equal(leaderboard(world).total,1);assert.equal(leaderboard(world,'1').own?.playerId,guest.id);assert.equal(leaderboard(world,'1').own?.totalMaterials,28);
});

test('clan members use pooled inventories and shared spending updates both ranks',()=>{
  const world=new SharedWorld(),a=account(world,'1',3),b=account(world,'2',5),solo=account(world,'3',7);
  b.x=a.x;b.z=a.z;const online=new Set([a.id,b.id]);
  world.clans.action(a,{type:'team-invite',targetId:b.id},online,1000);
  const invite=[...world.clans.invites.values()][0];assert.ok(invite);
  assert.match(world.clans.action(b,{type:'team-accept',inviteId:invite.id},online,1001),/Joined/);
  let board=leaderboard(world);assert.deepEqual(board.entries.map(p=>[p.rank,p.totalMaterials]),[[1,8],[1,8],[3,7]]);
  assert.ok(board.entries[0].clan);assert.deepEqual(a.inventory,{});assert.deepEqual(b.inventory,{});
  const dispatch=building('depot',a.base.x,a.base.z,0,100);dispatch.owner=a.id;
  const belt=building('conveyor',a.base.x-1,a.base.z,1,101);belt.owner=a.id;
  assert.ok(world.sim.canReceive(dispatch,'mechanism',belt));world.sim.receive(dispatch,'mechanism',belt);
  board=leaderboard(world);assert.deepEqual(board.entries.map(p=>p.totalMaterials),[8,8,7],'dispatch progress does not add inventory');
  assert.equal(board.entries[2].playerId,solo.id);
  assert.match(world.action(b,{type:'craft',recipe:'club'}),/Crafted/);
  board=leaderboard(world);assert.deepEqual(board.entries.map(p=>[p.playerId,p.rank,p.totalMaterials]),[[solo.id,1,7],[a.id,2,3],[b.id,2,3]]);
});

test('ranks survive restoring persisted personal and clan inventories, without requiring online connections',()=>{
  const world=new SharedWorld(),a=account(world,'1'),b=account(world,'2',10);
  a.clanId='clan';world.clans.saved.set('clan',{id:'clan',name:'The Foundry',inventory:{ore:30,coal:12},progress:freshProgress()});
  const expected=leaderboard(world,'1');
  assert.equal(expected.own?.totalMaterials,42);
  const restored=new SharedWorld(Simulation.restore(world.sim.serialize()).state);
  for(const p of world.profiles.values())restored.profiles.set(p.id,JSON.parse(JSON.stringify(p)));
  for(const c of world.clans.saved.values())restored.clans.saved.set(c.id,JSON.parse(JSON.stringify(c)));
  assert.deepEqual(JSON.parse(JSON.stringify(leaderboard(restored,'1'))),JSON.parse(JSON.stringify(expected)));
  assert.equal(leaderboard(restored).entries[1].playerId,b.id);
});
