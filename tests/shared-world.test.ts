import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SharedWorld} from '../src/open-world';
import {Simulation,building} from '../src/simulation';
import {CELL} from '../src/data';
import {baseForSlot,chunkAt,chunkSites,proceduralSite,sitesAround,CHUNK_SIZE,CLAIM_RADIUS} from '../src/terrain';

test('procedural deposits and home plots remain stable across positive and negative chunks',()=>{
  assert.deepEqual(chunkAt(-.1,-32.1),{x:-1,z:-2});
  const ids=new Set<string>();let crystals=0;
  for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)for(const site of chunkSites(x,z)){
    assert.deepEqual(proceduralSite(site.id),site);assert.equal(ids.has(site.id),false);ids.add(site.id);if(site.item==='crystal')crystals++;
  }
  assert.ok(crystals>0&&crystals<121);assert.equal(proceduralSite('p:999999999:0:0'),undefined);
  const bases=Array.from({length:128},(_,i)=>baseForSlot(i));
  for(let i=0;i<bases.length;i++){
    if(i>0)assert.equal(Math.hypot(bases[i].x-bases[i-1].x,bases[i].z-bases[i-1].z),CHUNK_SIZE,'successive arrivals get neighboring chunks');
    for(let j=i+1;j<bases.length;j++)assert.ok(Math.hypot(bases[i].x-bases[j].x,bases[i].z-bases[j].z)>CLAIM_RADIUS*2,'protected plots do not overlap');
  }
});
test('new neighbors spawn a short walk apart on clear ground with their own starter resources',()=>{
  const w=new SharedWorld();let previous;
  for(let i=0;i<128;i++){
    const p=w.createProfile(String(i),String(i),'');
    assert.equal(w.sim.canWalk(p.x,p.z),true,`engineer ${i} starts on walkable ground`);
    assert.ok(Math.hypot(p.x/CELL-p.base.x,p.z/CELL-p.base.z)<CLAIM_RADIUS);
    if(previous)assert.ok(Math.hypot(p.x-previous.x,p.z-previous.z)<=CHUNK_SIZE*CELL+2,'neighbors are about ten seconds apart at sprint speed');
    const c=chunkAt(p.base.x,p.base.z);
    for(const item of ['log','ore'])assert.ok(chunkSites(c.x,c.z).some(s=>s.item===item&&p.discovered.includes(s.id)&&Math.hypot(s.x-p.base.x,s.z-p.base.z)<CLAIM_RADIUS));
    previous=p;
  }
});
test('compact allocation preserves legacy homes and skips claimed or built-up plots after restoring',()=>{
  const original=new SharedWorld(),legacy=original.createProfile('legacy','saved-token','Returning');
  legacy.base={x:112,z:16};legacy.x=112*CELL;legacy.z=18*CELL;
  const saved=structuredClone(legacy);
  const w=new SharedWorld(Simulation.restore(original.sim.serialize()).state);
  w.profiles.set(legacy.id,structuredClone(saved));
  w.nextSlot=Array.from({length:64},(_,i)=>i).find(i=>{const b=baseForSlot(i);return b.x===112&&b.z===16;})!;
  const blocked=baseForSlot(w.nextSlot+1),machine=building('storage',blocked.x,blocked.z,0,1);
  machine.owner=legacy.id;w.sim.state.buildings.push(machine);w.sim.reindex();
  const newcomer=w.createProfile('new','new-token','New');
  assert.ok(Math.hypot(newcomer.base.x-saved.base.x,newcomer.base.z-saved.base.z)>=CLAIM_RADIUS*2);
  assert.ok(Math.hypot(newcomer.base.x-machine.x,newcomer.base.z-machine.z)>=CLAIM_RADIUS+3);
  assert.deepEqual(w.guestProfile('saved-token'),saved,'returning players keep their position, plot and supplies');
  assert.deepEqual(w.sim.state.buildings,[machine]);
});
test('one world gives each engineer a private inventory, separate home, and owned buildings',()=>{
  const w=new SharedWorld(),a=w.createProfile('a','token-a','Alice'),b=w.createProfile('b','token-b','Bob');
  a.z+=2*CELL;
  assert.notDeepEqual(a.base,b.base);assert.equal(w.sim.state.buildings.length,0);
  const before={...b.inventory};
  assert.match(w.action(a,{type:'place',kind:'storage',x:a.base.x,z:a.base.z,dir:0}),/Built/);
  const machine=w.sim.state.buildings[0];assert.equal(machine.owner,a.id);assert.deepEqual(b.inventory,before);
  b.x=(a.base.x+3)*CELL;b.z=a.base.z*CELL;
  assert.ok(w.snapshot(b).buildings.some(m=>m.id===machine.id));
  for(const type of ['collect','feed','dismantle'] as const)assert.match(w.action(b,{type,id:machine.id}),/owner/);
  assert.match(w.action(b,{type:'place',kind:'storage',x:a.base.x+2,z:a.base.z,dir:0}),/another engineer/);
  assert.equal(w.sim.state.buildings.length,1);assert.deepEqual(b.inventory,before);
  assert.equal(w.snapshot(b).owner,b.id);assert.equal('token' in w.publicPlayer(a),false);
  const timber=chunkSites(0,0).find(s=>s.item==='log')!;b.x=timber.x*CELL;b.z=(timber.z+1)*CELL;
  assert.match(w.action(b,{type:'gather',target:timber.id}),/another engineer/);
  const thief=building('conveyor',machine.x+1,machine.z,0,2);thief.owner=b.id;
  assert.equal(w.sim.canReceive(thief,'log',machine),false,'foreign conveyors cannot siphon a workshop');
  b.x=2000*CELL;b.z=2000*CELL;assert.equal(w.snapshot(b).buildings.length,0);
  a.x=2000*CELL;a.z=2000*CELL;assert.equal(w.snapshot(a).buildings.length,1,'own factory remains available for missions away from home');
});
test('mining is shared but discoveries, cooldowns, and crafted tools are personal',()=>{
  const w=new SharedWorld(),a=w.createProfile('a','a','Alice'),b=w.createProfile('b','b','Bob');
  const coal=chunkSites(1,1).find(s=>s.item==='coal')!;
  a.x=b.x=coal.x*CELL;a.z=b.z=coal.z*CELL+2;w.discover(a);w.discover(b);
  const before=coal.amount;
  assert.match(w.action(a,{type:'gather',target:coal.id}),/Mined/);
  const left=w.sim.remaining(coal);assert.ok(left<before);
  assert.equal(w.snapshot(b).deposits[coal.id],left);assert.equal(b.inventory.coal,undefined);
  assert.match(w.action(b,{type:'gather',target:coal.id}),/Mined/);
  assert.ok(w.sim.remaining(coal)<left);assert.ok((a.inventory.coal||0)>0&&(b.inventory.coal||0)>0);
  const c=w.createProfile('c','c','Cara');assert.equal(c.discovered.includes(coal.id),false);
  assert.equal(w.snapshot(c).explored.some(cell=>cell===`${coal.x},${coal.z}`),false);
});
test('factory production advances only its owner and sparse open-world saves restore',()=>{
  const w=new SharedWorld(),a=w.createProfile('a','a','Alice'),b=w.createProfile('b','b','Bob');
  const furnace=building('furnace',a.base.x,a.base.z,0,1);furnace.owner=a.id;furnace.input={ore:8};
  const wind=building('windmill',a.base.x+3,a.base.z,0,2);wind.owner=a.id;
  w.sim.state.buildings.push(furnace,wind);w.sim.state.nextId=3;w.sim.reindex();
  for(let i=0;i<100;i++)w.tick(.1);
  assert.ok((a.progress.produced.ingot||0)>0);assert.equal(b.progress.produced.ingot,undefined);
  const loaded=Simulation.restore(w.sim.serialize());assert.equal(loaded.state.openWorld,true);assert.equal(loaded.state.buildings[0].owner,a.id);
});
