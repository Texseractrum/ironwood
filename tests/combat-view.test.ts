import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {attackArcRotation,CombatView} from '../src/combat-view';
import {GatheringAnimation} from '../src/gathering';
import {freshCombat} from '../src/combat-data';
import {Simulation,newState} from '../src/simulation';
import type {World} from '../src/world';

function combatScene(){
  const player=new THREE.Group(),arm=new THREE.Group(),scene=new THREE.Scene();arm.name='arm_right';player.add(arm);scene.add(player);
  const sim=new Simulation({...newState(),combat:{...freshCombat(),weapon:'sword'},player:{x:0,z:0}});
  const gathering=new GatheringAnimation(player,scene,()=>20);
  const world={sim,player,scene,gathering,ownId:'alice',crew:[],crewObjects:new Map(),crewGathering:new Map(),camera:new THREE.PerspectiveCamera(),footHeight:()=>20} as unknown as World;
  return {view:new CombatView(world),sim,arm,player,gathering};
}

test('attack arcs stay centred in the character forward direction',()=>{
  for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const centre=new THREE.Vector3(Math.cos(Math.PI*.4),Math.sin(Math.PI*.4),0)
      .applyEuler(new THREE.Euler(-Math.PI/2,0,attackArcRotation(angle)));
    assert.ok(Math.abs(centre.x-Math.sin(angle))<1e-12);
    assert.ok(Math.abs(centre.z-Math.cos(angle))<1e-12);
  }
});

test('empty attack poses interrupt gathering, handle late gathering updates, and return to rest',()=>{
  const {view,arm,player,gathering}=combatScene();
  const gather={x:1,z:0,item:'log' as const,amount:1};gathering.start(gather);gathering.update(.15);
  view.swing('alice',0,0,Math.PI/2);assert.equal(gathering.active,false);
  // A gathering response arriving after the key press cannot hide the weapon.
  gathering.start(gather);view.update(.05);
  assert.equal(gathering.active,false);assert.equal(arm.getObjectByName('combat-weapon')?.visible,true);
  assert.ok(arm.rotation.x>1);assert.equal(player.rotation.y,Math.PI/2);
  view.update(.4);assert.deepEqual(view.diagnostics.swings,[]);assert.equal(arm.rotation.x,0);assert.equal(arm.rotation.z,0);
  view.swing('alice',0,0,0);view.update(.05);assert.ok(arm.rotation.x>1);
  gathering.dispose();
});

test('overhead health bars appear only when injured or protected',()=>{
  const {view,sim,gathering}=combatScene();view.update(.01);assert.deepEqual(view.diagnostics.healthBars,[]);
  sim.state.combat!.health=70;view.update(.01);assert.deepEqual(view.diagnostics.healthBars,['alice']);
  sim.state.combat!.health=100;sim.state.combat!.protectedUntil=5;view.update(.01);assert.deepEqual(view.diagnostics.healthBars,['alice']);
  sim.state.time=5;view.update(.01);assert.deepEqual(view.diagnostics.healthBars,[]);
  gathering.dispose();
});
