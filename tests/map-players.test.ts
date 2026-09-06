import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CELL} from '../src/data';
import {mapPlayers,NEARBY_MAP_DISTANCE} from '../src/map-players';
import type {Player} from '../src/protocol';

const player=(id:string,x:number,z=0):Player=>({id,name:id,x,z,color:'#82c9d3',base:{x:0,z:0}});

test('nearby engineers are visible through fog, measured from the player rather than their base',()=>{
  const own=player('own',100),near=player('near',110),boundary=player('boundary',100+NEARBY_MAP_DISTANCE),far=player('far',100+NEARBY_MAP_DISTANCE+.1);
  const players=[far,boundary,own,near],before=structuredClone(players);
  const entries=mapPlayers(players,own.id,own,()=>false);
  assert.deepEqual(entries.map(e=>e.player.id),['near','boundary']);
  assert.equal(entries[0].distance,10);assert.ok(entries.every(e=>e.nearby));
  assert.deepEqual(players,before,'map presence must not mutate players or exploration');
});

test('distant engineers retain visibility only on explored cells, in tile coordinates',()=>{
  const entries=mapPlayers([player('surveyed',100*CELL),player('hidden',101*CELL)],'own',{x:0,z:0},(x,z)=>x===100&&z===0);
  assert.deepEqual(entries.map(e=>e.player.id),['surveyed']);assert.equal(entries[0].nearby,false);
});

test('movement, departure and malformed coordinates cannot leave stale nearby engineers',()=>{
  const own={x:0,z:0},peer=player('peer',10);
  assert.equal(mapPlayers([peer],'own',own,()=>false).length,1);
  peer.z=NEARBY_MAP_DISTANCE+1;
  assert.deepEqual(mapPlayers([peer],'own',own,()=>false),[]);
  assert.deepEqual(mapPlayers([],'own',own,()=>false),[]);
  assert.deepEqual(mapPlayers([player('nan',NaN),player('infinite',0,Infinity)],'own',own,()=>true),[]);
});
