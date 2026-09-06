import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_KEY,loadAudio,soundForResult} from '../src/audio';
import {hasSeenIntro,isNewWorkshop,rememberIntro} from '../src/intro';
import {Simulation,building} from '../src/simulation';
import {applyAction} from '../src/protocol';

test('only new workshops receive the automatic introduction',()=>{
  const sim=new Simulation();assert.equal(isNewWorkshop(sim.state),true);
  sim.state.built=1;assert.equal(isNewWorkshop(sim.state),false);sim.state.built=0;
  sim.state.gathered=1;assert.equal(isNewWorkshop(sim.state),false);sim.state.gathered=0;
  sim.state.produced.plank=1;assert.equal(isNewWorkshop(sim.state),false);sim.state.produced={};
  sim.state.unlock=1;assert.equal(isNewWorkshop(sim.state),false);sim.state.unlock=0;
  sim.state.owner='new-engineer';const neighbor=building('lumber',-6,2,0,1);neighbor.owner='neighbor';
  sim.state.buildings.push(neighbor);assert.equal(isNewWorkshop(sim.state),true);
  neighbor.owner='new-engineer';assert.equal(isNewWorkshop(sim.state),false);
});

test('audio settings validate storage, and intro dismissal belongs to an engineer',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),data=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)}});
  try{
    assert.deepEqual(loadAudio(),{enabled:true,volume:.65});
    data.set(AUDIO_KEY,JSON.stringify({enabled:false,volume:.35}));assert.deepEqual(loadAudio(),{enabled:false,volume:.35});
    data.set(AUDIO_KEY,JSON.stringify({enabled:true,volume:20}));assert.equal(loadAudio().volume,1);
    data.set(AUDIO_KEY,'{broken');assert.deepEqual(loadAudio(),{enabled:true,volume:.65});
    data.set(AUDIO_KEY,JSON.stringify({enabled:'false',volume:null}));assert.deepEqual(loadAudio(),{enabled:true,volume:.65});
    rememberIntro('one');assert.equal(hasSeenIntro('one'),true);assert.equal(hasSeenIntro('two'),false);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage blocked');}});
    assert.doesNotThrow(()=>rememberIntro('three'));assert.equal(hasSeenIntro('three'),false);assert.equal(loadAudio().enabled,true);
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});

test('sound feedback follows actual successful simulation results',()=>{
  const sim=new Simulation();
  assert.equal(soundForResult(applyAction(sim,{type:'craft',recipe:'plank'})),'craft');
  sim.state.inventory={};assert.equal(soundForResult(applyAction(sim,{type:'craft',recipe:'plank'})),undefined);
  assert.equal(soundForResult(applyAction(sim,{type:'collect',id:999})),undefined);
  const chest=building('storage',0,0,0,sim.state.nextId++);sim.state.buildings.push(chest);sim.reindex();
  assert.equal(soundForResult(applyAction(sim,{type:'collect',id:chest.id})),undefined);
  chest.input={plank:2};assert.equal(soundForResult(applyAction(sim,{type:'collect',id:chest.id})),'collect');
  assert.equal(soundForResult(applyAction(sim,{type:'dismantle',id:chest.id})),'dismantle');
  for(const message of ['Connecting to the world. Please wait before making changes.','Conveyors already connected.','Gather the required ingredients first.','Nothing to collect yet.','Built',''])assert.equal(soundForResult(message),undefined);
});
