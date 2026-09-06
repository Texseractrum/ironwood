import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,building,type State} from '../src/simulation';
import {SharedWorld} from '../src/open-world';
import {DEFS,ITEMS,SITES,CELL,addStock,total,type Kind,type Stock,type Craft} from '../src/data';
import {CHAPTERS,CHESTS,MACHINE_UPGRADES,BEACON_COST,advanceChapters,chapterObjectives,chestCapacity,machineDuration,updateMastery,canComplete} from '../src/progression';
import {applyAction,isAction} from '../src/protocol';
import {discoveries} from '../src/discoveries';

function put(sim:Simulation,kind:Kind,x=0,z=0){const b=building(kind,x,z,0,sim.state.nextId++);sim.state.buildings.push(b);sim.reindex();return b;}
const advance=(sim:Simulation,seconds:number)=>{for(let i=0;i<Math.round(seconds*10);i++)sim.tick(.1);};
const supplies=():Stock=>Object.fromEntries(Object.keys(ITEMS).map(k=>[k,k==='pickaxe'?1:10000]));

test('all chest tiers retain contents, enforce capacity, debit once and fully refund upgrades',()=>{
  const sim=new Simulation();sim.state.unlock=7;sim.state.inventory=supplies();
  const chest=put(sim,'storage'),source=put(sim,'conveyor',-1,0);chest.input={plank:100};
  for(let level=1;level<CHESTS.length;level++){
    assert.equal(sim.canReceive(chest,'plank',source),false);
    const before=structuredClone(sim.state.inventory),contents=structuredClone(chest.input);
    assert.match(applyAction(sim,{type:'upgrade',id:chest.id}),/Upgraded/);
    assert.equal(chestCapacity(chest),CHESTS[level].capacity);assert.deepEqual(chest.input,contents);
    for(const [item,n] of Object.entries(CHESTS[level].cost))assert.equal(sim.state.inventory[item as keyof Stock],before[item as keyof Stock]!-n!);
    assert.equal(sim.canReceive(chest,'plank',source),true);
    chest.input={plank:CHESTS[level].capacity};
    const loaded=Simulation.restore(sim.serialize());assert.equal(chestCapacity(loaded.byId.get(chest.id)!),CHESTS[level].capacity);
  }
  const before=structuredClone(sim.state.inventory);assert.match(sim.upgrade(chest),/no further/);assert.deepEqual(sim.state.inventory,before);
  sim.dismantle(chest.id);
  const expected={...before};addStock(expected,DEFS.storage.cost);for(const upgrade of CHESTS.slice(1))addStock(expected,upgrade.cost);addStock(expected,{plank:4000});assert.deepEqual(sim.state.inventory,expected);
});

test('upgrades reject locked, unaffordable, distant and foreign changes without spending',()=>{
  const sim=new Simulation(),chest=put(sim,'storage');sim.state.inventory=supplies();
  const before=sim.serialize();assert.match(sim.upgrade(chest),/chapter/);assert.equal(sim.serialize(),before);
  sim.state.unlock=7;sim.state.inventory={};assert.match(sim.upgrade(chest),/materials/);assert.equal(chest.level,undefined);
  sim.state.inventory=supplies();sim.state.player={x:45,z:0};assert.match(sim.upgrade(chest),/closer/);
  sim.state.player={x:0,z:2};sim.state.owner='a';chest.owner='b';assert.match(sim.upgrade(chest),/owner/);
  assert.equal(isAction({type:'upgrade',id:-1}),false);assert.equal(isAction({type:'upgrade',id:1.5}),false);assert.equal(isAction({type:'upgrade',id:chest.id}),true);
});

test('machine upgrades preserve batch progress, increase real output, and keep input and power costs',()=>{
  const sim=new Simulation();sim.state.unlock=7;sim.state.inventory=supplies();
  const furnace=put(sim,'furnace'),wind=put(sim,'windmill',0,2);furnace.input={ore:8};
  advance(sim,2);assert.equal(furnace.active,true);assert.equal(furnace.input.ore,6);
  const fraction=furnace.progress/machineDuration(furnace),demand=sim.demand;
  sim.upgrade(furnace);assert.ok(Math.abs(furnace.progress/machineDuration(furnace)-fraction)<1e-8);
  sim.upgrade(furnace);assert.equal(machineDuration(furnace),2);assert.equal(sim.demand,demand);
  advance(sim,1);assert.equal(furnace.produced,1);assert.equal(furnace.output.ingot,1);
  advance(sim,6);assert.equal(furnace.produced,4);assert.equal(furnace.input.ore,0);
  assert.equal(wind.power,0);assert.equal(sim.supply,12);
  const restored=Simulation.restore(sim.serialize());assert.equal(restored.byId.get(furnace.id)!.level,2);
});

test('new material factories consume their recipes and persist deterministic production',()=>{
  for(const kind of ['foundry','kiln','etcher','forge','artificer'] as const){
    const sim=new Simulation(),machine=put(sim,kind);put(sim,'windmill',0,2);
    addStock(machine.input,DEFS[kind].input!);advance(sim,1);
    const saved=Simulation.restore(sim.serialize());advance(sim,DEFS[kind].duration!);advance(saved,DEFS[kind].duration!);
    assert.deepEqual(sim.state,saved.state);assert.deepEqual(machine.output,DEFS[kind].output);assert.equal(total(machine.input),0);
  }
});

test('the eight chapters require actual factory production and upgrades, with one-time badges and rewards',()=>{
  const sim=new Simulation(),s=sim.state;s.inventory=supplies();
  for(let i=0;i<30;i++)sim.craft('ingot');advanceChapters(s);assert.equal(s.unlock,0,'Handcrafting cannot skip production goals.');
  s.produced.ingot=10;advanceChapters(s);assert.equal(s.unlock,1);
  const rewarded=structuredClone(s.inventory);advanceChapters(s);assert.deepEqual(s.inventory,rewarded);
  s.produced.gear=8;advanceChapters(s);assert.equal(s.unlock,2);
  s.delivered=20;advanceChapters(s);assert.equal(s.unlock,3);
  const chest=put(sim,'storage');s.produced.steel=20;advanceChapters(s);assert.equal(s.unlock,3);
  sim.upgrade(chest);advanceChapters(s);assert.equal(s.unlock,4);
  s.produced.glass=20;s.produced.circuit=12;advanceChapters(s);assert.equal(s.unlock,5);
  s.produced.alloy=24;sim.upgrade(chest);advanceChapters(s);assert.equal(s.unlock,6);
  s.produced.core=6;const a=put(sim,'foundry',2,0),b=put(sim,'kiln',4,0);
  sim.upgrade(a);sim.upgrade(b);sim.upgrade(chest);advanceChapters(s);assert.equal(s.unlock,7);
  assert.equal(s.won,false);assert.equal(s.campaign.badges.length,7);
  assert.ok(chapterObjectives(s).some(goal=>goal.n<goal.max));assert.equal(canComplete(s),false);
  s.delivered=100;s.campaign.mastery=true;
  const before=structuredClone(s.inventory);assert.match(applyAction(sim,{type:'commission'}),/beacon is lit/);
  const expected={...before};addStock(expected,BEACON_COST,-1);assert.deepEqual(s.inventory,expected);
  assert.equal(s.won,true);assert.equal(s.campaign.badges.length,8);assert.equal(s.campaign.completedAt,s.time);
  const completed=sim.serialize();assert.match(applyAction(sim,{type:'commission'}),/already earned/);assert.equal(sim.serialize(),completed);
  applyAction(sim,{type:'acknowledge-completion'});const restored=Simulation.restore(sim.serialize());assert.equal(restored.state.campaign.completionSeen,true);assert.equal(restored.state.won,true);
});

test('mastery uses upgraded assembly capacity and survives later layout changes',()=>{
  const sim=new Simulation(),s=sim.state,a=put(sim,'assembler');s.delivered=20;a.level=2;
  for(let i=1;i<=3;i++){s.time=i*60;s.delivered+=8;a.produced+=8;updateMastery(s);}
  assert.equal(s.campaign.mastery,false,'8/min is only 40% of an upgraded bench.');
  for(let i=4;i<=6;i++){s.time=i*60;s.delivered+=16;a.produced+=16;updateMastery(s);}
  assert.equal(s.campaign.mastery,true);sim.resetChallenge();assert.equal(s.challenge.windows,0);assert.equal(s.campaign.mastery,true);
});

test('completion and upgrades are private, atomic, and survive shared-world profile restoration',()=>{
  const w=new SharedWorld(),a=w.createProfile('a','a','Alice'),b=w.createProfile('b','b','Bob');
  a.z+=2*CELL;
  a.progress.unlock=7;a.inventory=supplies();a.progress.delivered=100;a.progress.campaign.mastery=true;
  assert.match(w.action(a,{type:'place',kind:'storage',x:a.base.x,z:a.base.z,dir:0}),/Built/);
  const chest=w.sim.state.buildings[0];const other=JSON.stringify(b);
  assert.match(w.action(b,{type:'upgrade',id:chest.id}),/owner/);assert.equal(JSON.stringify(b),other);
  assert.match(w.action(a,{type:'upgrade',id:chest.id}),/Upgraded/);assert.equal(chest.level,1);
  assert.match(w.action(b,{type:'commission'}),/Finish all/);assert.equal(b.progress.won,false);
  assert.match(w.action(a,{type:'commission'}),/beacon is lit/);assert.equal(a.progress.won,true);assert.equal(b.progress.won,false);
  w.action(a,{type:'acknowledge-completion'});
  const loaded=new SharedWorld(Simulation.restore(w.sim.serialize()).state);
  loaded.profiles.set(a.id,JSON.parse(JSON.stringify(a)));loaded.profiles.set(b.id,JSON.parse(JSON.stringify(b)));
  loaded.tick(.1);const snapshot=loaded.snapshot(loaded.profiles.get(a.id)!);
  assert.equal(snapshot.campaign.completionSeen,true);assert.equal(snapshot.won,true);assert.equal(snapshot.buildings[0].level,1);assert.equal(loaded.snapshot(loaded.profiles.get(b.id)!).won,false);
});

test('legacy wins migrate to earned honours and invalid campaign/upgrade data is rejected',()=>{
  const sim=new Simulation(),legacy=JSON.parse(sim.serialize());legacy.unlock=2;legacy.won=true;delete legacy.campaign;
  const restored=Simulation.restore(JSON.stringify(legacy));assert.equal(restored.state.unlock,3);assert.equal(restored.state.won,false);assert.equal(restored.state.campaign.mastery,true);assert.ok(restored.state.campaign.badges.includes('Guild supplier'));
  const chest=put(restored,'storage');chest.level=3;chest.input={core:4000};advance(restored,.1);assert.doesNotThrow(()=>Simulation.restore(restored.serialize()));
  for(const mutate of [(s:State)=>{s.buildings[0].level=4;},(s:State)=>{s.buildings[0].input={core:4001};},(s:State)=>{s.campaign.badges=['<script>'];},(s:State)=>{s.campaign.completedAt=-1;},(s:State)=>{s.campaign.mastery='yes' as unknown as boolean;}]){
    const invalid=JSON.parse(restored.serialize());mutate(invalid);assert.throws(()=>Simulation.restore(JSON.stringify(invalid)));
  }
});

test('advanced blueprints require their chapter as well as discovered ingredients',()=>{
  const sim=new Simulation();sim.state.inventory=supplies();sim.state.unlock=2;
  assert.ok(!discoveries(sim.state).blueprints.includes('foundry'));
  for(let chapter=3;chapter<CHAPTERS.length;chapter++){
    sim.state.unlock=chapter;const known=discoveries(sim.state);
    for(const kind of ['foundry','kiln','etcher','forge','artificer'] as Kind[])assert.equal(known.blueprints.includes(kind),DEFS[kind].unlock<=chapter);
  }
});

test('the advanced campaign is reachable with gathered materials, real construction and production',()=>{
  // The earlier earned-material workshop test covers chapters 1–3. Continue from
  // its commission with the normal starting pack, without gifting advanced goods.
  const sim=new Simulation(),s=sim.state;s.unlock=3;s.delivered=20;s.campaign.badges=CHAPTERS.slice(0,3).map(ch=>ch.badge);
  function gather(id:string,amount:number){
    const site=SITES.find(site=>site.id===id)!;s.player={x:site.x*CELL,z:(site.z+1)*CELL};
    const target=(s.inventory[site.item]||0)+amount;
    while((s.inventory[site.item]||0)<target){s.time+=1.1;assert.match(sim.gather(id),/^(Mined|Chopped)/);}
  }
  function craft(kind:Craft,count:number){for(let i=0;i<count;i++)assert.match(sim.craft(kind),/Crafted/,kind);}
  function build(kind:Kind,x:number,z:number){
    for(const node of sim.scenery.filter(n=>sim.overlapsScenery(n,x,z)&&sim.sceneryVisible(n))){
      s.player={x:node.x+node.radius+.5,z:node.z};
      while(sim.sceneryVisible(node)){s.time+=1.1;assert.match(sim.gather(node.id),/^(Mined|Chopped)/);}
    }
    s.player={x:x*CELL,z:(z+2)*CELL};const b=sim.place(kind,x,z,0);assert.notEqual(typeof b,'string',String(b));return b as ReturnType<typeof building>;
  }
  gather('home-timber',400);gather('home-iron',1800);gather('coal-west',600);gather('copper-east',500);
  craft('plank',100);craft('ingot',800);craft('gear',150);craft('steel',160);craft('pickaxe',1);gather('crystal-north',150);
  const chest=build('storage',3,0);assert.match(sim.upgrade(chest),/Upgraded/);build('windmill',0,-3);
  function produce(kind:Kind,item:keyof Stock,amount:number){
    s.player={x:0,z:2*CELL};const previous=sim.at(0,0);if(previous)assert.equal(sim.dismantle(previous.id),null);
    const machine=build(kind,0,0),target=(s.produced[item]||0)+amount;
    let steps=0;
    while((s.produced[item]||0)<target&&steps++<20000){sim.feed(machine);advance(sim,1);sim.collect(machine);}
    assert.ok((s.produced[item]||0)>=target,`${kind}: ${machine.status}`);return machine;
  }
  produce('foundry','steel',20);assert.equal(s.unlock,4);
  produce('kiln','glass',140);produce('etcher','circuit',100);assert.equal(s.unlock,5);
  s.player={x:3*CELL,z:2*CELL};assert.match(sim.upgrade(chest),/Upgraded/);
  produce('forge','alloy',120);assert.equal(s.unlock,6);
  const coreMachine=produce('artificer','core',20);assert.match(sim.upgrade(coreMachine),/Upgraded/);
  const furnace=build('furnace',-3,0);assert.match(sim.upgrade(furnace),/Upgraded/);
  s.player={x:3*CELL,z:2*CELL};assert.match(sim.upgrade(chest),/Upgraded/);advance(sim,.1);assert.equal(s.unlock,7);
  s.player={x:0,z:2*CELL};assert.equal(sim.dismantle(coreMachine.id),null);
  const assembler=build('assembler',0,0);build('depot',1,0);
  // A loaded assembly bench dispatches through its actual output, with no direct
  // edits to delivery counters, challenge windows, or produced materials.
  for(let i=0;i<800;i++){sim.feed(assembler);advance(sim,1);}
  assert.ok(s.delivered>=100);assert.equal(s.campaign.mastery,true);assert.equal(canComplete(s),true);
  assert.match(sim.completeCommission(),/beacon is lit/);assert.equal(s.won,true);
  assert.equal(Simulation.restore(sim.serialize()).state.won,true);
});
