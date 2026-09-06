import {test} from 'node:test';
import assert from 'node:assert/strict';
import {joystickVector} from '../src/mobile-controls';

test('joystick dead zone prevents drift and the edge enables running',()=>{
  assert.deepEqual(joystickVector(0,0,40),{x:0,z:0,run:false});
  assert.deepEqual(joystickVector(3,-3,40),{x:0,z:0,run:false});
  const walking=joystickVector(20,0,40);
  assert.ok(walking.x>0&&walking.x<1);assert.equal(walking.z,0);assert.equal(walking.run,false);
  assert.deepEqual(joystickVector(80,0,40),{x:1,z:0,run:true});
});
test('diagonal input is capped so dragging far outside the pad never speeds up movement',()=>{
  for(const [x,z] of [[40,40],[-800,600],[0,-100]]){
    const input=joystickVector(x,z,40);
    assert.ok(Math.abs(Math.hypot(input.x,input.z)-1)<1e-10);
    assert.equal(Math.sign(input.x),Math.sign(x));assert.equal(Math.sign(input.z),Math.sign(z));
  }
});
