import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,building} from '../src/simulation';
import {CELL,SITES} from '../src/data';
import {SCENERY,SCENERY_BY_ID,PLAYER_RADIUS,chunkScenery,sceneryAround,sceneryById} from '../src/scenery';
import {applyAction,isAction,validMove} from '../src/protocol';
import {SharedWorld} from '../src/open-world';
import {newState} from '../src/simulation';

test('the ruined watchtower blocks walking',()=>{
  assert.equal(new Simulation().canWalk(13,-15),false);
});

test('the ruined watchtower can be mined into inventory',()=>{
  const sim=new Simulation();sim.state.player={x:13,z:-17.5};
  assert.match(sim.gather(),/stone/);
  assert.ok(Object.entries(sim.state.inventory).some(([item,count])=>item==='stone'&&count!>0));
});

test('a new expedition records explored terrain for map fog',()=>{
  const state=JSON.parse(new Simulation().serialize());
  assert.ok(Array.isArray(state.explored)&&state.explored.length>0);
  assert.ok(state.explored.length<300);
});

test('every scenery object blocks the player and its material reaches inventory',()=>{
  for(const node of SCENERY){
    const sim=new Simulation();sim.state.inventory={pickaxe:1};
    assert.equal(sim.canWalk(node.x,node.z),false,`${node.id} must collide`);
    sim.state.player={x:node.x+node.radius+PLAYER_RADIUS+.05,z:node.z};
    const reserve=node.siteId?sim.state.deposits[node.siteId]:undefined;
    const result=applyAction(sim,{type:'gather',target:node.id});
    const amount=node.tier?2:5;
    assert.match(result,/^(Mined|Chopped)/,`${node.id}: ${result}`);
    assert.equal(sim.state.inventory[node.item],amount,node.id);
    assert.equal(sim.state.harvested[node.id],node.amount-amount,node.id);
    if(node.siteId)assert.equal(sim.state.deposits[node.siteId],reserve!-amount);
    assert.match(sim.gather(node.id),/Mining/);assert.equal(sim.state.inventory[node.item],amount);
  }
});

test('clearing resources removes collisions, preserves reserves and survives reload',()=>{
  const sim=new Simulation(),tower=SCENERY_BY_ID.get('scenery:watchtower')!;
  sim.state.player={x:13,z:-17.5};
  for(let i=0;i<8;i++){sim.state.time=i;sim.gather(tower.id);}
  assert.equal(sim.state.inventory.stone,40);assert.equal(sim.sceneryVisible(tower),false);
  assert.equal(sim.canWalk(tower.x,tower.z),true);
  const restored=Simulation.restore(sim.serialize());assert.equal(restored.canWalk(tower.x,tower.z),true);
  const before=JSON.stringify(restored.state.inventory);restored.gather(tower.id);assert.equal(JSON.stringify(restored.state.inventory),before);
});

test('resource targeting checks reach, crystal tools and command types',()=>{
  const sim=new Simulation(),crystal=SCENERY.find(n=>n.item==='crystal')!;
  assert.match(sim.gather(crystal.id),/Walk near/);assert.deepEqual(sim.state.harvested,{});
  sim.state.player={x:crystal.x+2,z:crystal.z};
  assert.match(sim.gather(crystal.id),/steel pickaxe/);assert.equal(sim.state.inventory.crystal,undefined);
  for(const target of [null,3,{},'', 'x'.repeat(101)])assert.equal(isAction({type:'gather',target}),false);
  assert.equal(isAction({type:'gather',target:crystal.id}),true);
  assert.match(sim.gather('unknown-node'),/Walk near/);
});

test('walking and server validation cannot tunnel through a tree or transmission post',()=>{
  const sim=new Simulation();
  const node=SCENERY.find(n=>n.kind==='tree'&&!n.siteId&&sim.canWalk(n.x-1,n.z)&&sim.canWalk(n.x+1,n.z))!;
  const from={x:node.x-1,z:node.z},to={x:node.x+1,z:node.z};
  assert.equal(validMove(sim,from,to,.5),false);
  sim.state.player={...from};sim.movePlayer(2,0);
  assert.ok(sim.state.player.x<node.x-node.radius-PLAYER_RADIUS);
  sim.state.buildings.push(building('post',0,0,0,sim.state.nextId++));sim.reindex();
  assert.equal(sim.canWalk(0,0),false);assert.equal(validMove(sim,{x:-1,z:0},{x:1,z:0},.5),false);
  sim.state.buildings=[building('conveyor',0,0,0,sim.state.nextId++)];sim.reindex();assert.equal(sim.canWalk(0,0),true);
});

test('building requires clearing scenery and does not strand existing factories',()=>{
  const sim=new Simulation();sim.state.inventory.log=1000;
  const node=SCENERY.find(n=>!n.siteId&&n.kind==='tree')!,x=Math.round(node.x/CELL),z=Math.round(node.z/CELL);
  sim.state.player={x:x*CELL,z:(z+2)*CELL};
  assert.match(sim.placementError('storage',x,z)!,/Chop or mine/);
  for(const n of SCENERY)if(sim.overlapsScenery(n,x,z))sim.state.harvested[n.id]=0;
  assert.equal(sim.placementError('storage',x,z),null);
  const legacy=new Simulation();legacy.state.buildings.push(building('storage',x,z,0,legacy.state.nextId++));legacy.reindex();
  assert.equal(legacy.sceneryVisible(node),false);
});

test('fog reveals only surveyed terrain, persists, and migrates older saves',()=>{
  const sim=new Simulation();const spawn={...sim.state.player};
  assert.equal(sim.isExplored(spawn.x/CELL,spawn.z/CELL),true);assert.equal(sim.isExplored(1,-16),false);
  assert.equal(sim.state.discovered.includes('crystal-north'),false);
  const site=SITES.find(s=>s.id==='coal-west')!;
  sim.state.player={x:site.x*CELL,z:(site.z+1)*CELL};sim.discover();
  assert.equal(sim.isExplored(site.x,site.z),true);assert.ok(sim.state.discovered.includes(site.id));
  sim.state.player=spawn;sim.discover();const count=sim.state.explored.length;sim.discover();assert.equal(sim.state.explored.length,count);
  const restored=Simulation.restore(sim.serialize());assert.equal(restored.isExplored(site.x,site.z),true);assert.equal(restored.isExplored(1,-16),false);
  const legacy=JSON.parse(sim.serialize());delete legacy.explored;delete legacy.harvested;
  const migrated=Simulation.restore(JSON.stringify(legacy));assert.equal(migrated.isExplored(0,2.5),true);assert.equal(migrated.isExplored(1,-16),false);
  for(const patch of [{harvested:{'scenery:watchtower':41}},{harvested:{bad:0}},{explored:['NaN,0']},{explored:['9999,9999']}])assert.throws(()=>Simulation.restore(JSON.stringify({...legacy,...patch})));
});

test('older players saved inside former decoration return to nearby clear ground',()=>{
  const legacy=JSON.parse(new Simulation().serialize());delete legacy.harvested;
  legacy.player={x:13,z:-15};
  const restored=Simulation.restore(JSON.stringify(legacy)),p=restored.state.player;
  assert.equal(restored.canWalk(p.x,p.z),true);assert.ok(Math.hypot(p.x-13,p.z+15)<3);
  assert.deepEqual(restored.state.inventory,legacy.inventory);
});

test('procedural scenery stays fixed across chunk crossings and is harvestable',()=>{
  const before=chunkScenery(-1,0),overlap=sceneryAround(1,1).filter(n=>before.some(b=>b.id===n.id));
  assert.deepEqual(overlap,before);
  const sim=new Simulation({...newState(),openWorld:true,deposits:{},discovered:[]});
  for(const node of chunkScenery(0,0)){
    assert.deepEqual(sceneryById(node.id),node);assert.equal(sim.canWalk(node.x,node.z),false);
    sim.state.player={x:node.x+node.radius+.5,z:node.z};sim.state.inventory={pickaxe:1};sim.state.time+=1.1;
    assert.match(sim.gather(node.id),/^(Mined|Chopped)/,node.id);
    assert.equal(sim.state.inventory[node.item],node.tier?2:5);
  }
  const loaded=Simulation.restore(sim.serialize());assert.deepEqual(loaded.state.harvested,sim.state.harvested);
  assert.equal(sceneryById('scenery:p:999999999999999:0:0'),undefined);
});

test('shared-world harvesting credits only the miner and fog stays personal',()=>{
  const world=new SharedWorld(),ada=world.createProfile('ada','token-a','Ada'),grace=world.createProfile('grace','token-b','Grace');
  const first=world.snapshot(ada),second=world.snapshot(grace);
  assert.ok(first.explored.includes('16,18'));assert.ok(!second.explored.includes('16,18'));
  const node=chunkScenery(0,0).find(n=>n.kind==='tree')!;
  ada.x=node.x+node.radius+.5;ada.z=node.z;world.discover(ada);
  const mine=ada.inventory.log||0,other=grace.inventory.log;
  assert.match(world.action(ada,{type:'gather',target:node.id}),/Chopped/);
  assert.equal(ada.inventory.log,mine+5);assert.equal(grace.inventory.log,other);
  world.tick(1);world.action(ada,{type:'gather',target:node.id});
  assert.equal(world.sim.sceneryVisible(node),false);
  grace.x=ada.x;grace.z=ada.z;world.discover(grace);
  const client=new Simulation(world.snapshot(grace));assert.equal(client.sceneryVisible(node),false);
  const p=JSON.parse(JSON.stringify(ada));assert.deepEqual(p.surveyed,ada.surveyed);
});
