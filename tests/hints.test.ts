import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HintSchedule,PLAYER_HINTS,type HintContext} from '../src/hints';

const context:HintContext={age:0,nearResource:false,hasMachines:false,needsPower:false,inspecting:false,building:false,conveyor:false,dismantling:false,nearPlayer:false,hasClan:false,advanced:false};
test('hints start gently, appear once, and leave a gap after dismissal',()=>{
  const hints=new HintSchedule();
  assert.equal(hints.tick(1,context,false),undefined);
  assert.equal(hints.tick(1,{...context,age:2},false)?.id,'move');
  hints.dismiss();
  assert.equal(hints.tick(21,{...context,age:30},false),undefined);
  assert.equal(hints.tick(1,{...context,age:30},false)?.id,'chat');
  assert.ok(hints.seen.has('move'));
});
test('dialogs and chat pause exposure without marking unseen hints as read',()=>{
  const hints=new HintSchedule(),ready={...context,age:20};
  assert.equal(hints.tick(100,ready,true),undefined);
  assert.equal(hints.seen.size,0);
  assert.equal(hints.tick(0,ready,false)?.id,'move');
  hints.tick(5,ready,false);hints.tick(100,ready,true);
  assert.equal(hints.tick(4,ready,false)?.id,'move');
  assert.equal(hints.tick(1,ready,false),undefined);
  assert.ok(hints.seen.has('move'));
});
test('a hovered or focused hint stays available to read and dismiss',()=>{
  const hints=new HintSchedule(),ready={...context,age:20};
  hints.tick(0,ready,false);
  assert.equal(hints.tick(200,ready,false,true)?.id,'move');
  assert.equal(hints.seen.size,0);
});
test('contextual hints disappear when they no longer apply',()=>{
  const hints=new HintSchedule();
  assert.equal(hints.tick(0,{...context,conveyor:true},false)?.id,'conveyors');
  assert.equal(hints.tick(1,context,false),undefined);
  assert.equal(hints.seen.size,0);
});
test('learned controls are skipped and hint preferences can be replayed',()=>{
  let saved=0;const hints=new HintSchedule(()=>saved++);
  hints.complete('move');hints.complete('chat');
  assert.equal(hints.tick(0,{...context,age:25},false)?.id,'build');
  hints.setEnabled(false);assert.equal(hints.tick(100,{...context,age:25},false),undefined);
  hints.reset();assert.equal(hints.tick(0,{...context,age:25},false)?.id,'move');
  assert.equal(saved,4);
});
test('hint IDs are unique so dismissing one never suppresses another',()=>{
  assert.equal(new Set(PLAYER_HINTS.map(h=>h.id)).size,PLAYER_HINTS.length);
});
