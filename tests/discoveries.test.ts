import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveries } from '../src/discoveries';
import { Simulation, building } from '../src/simulation';

test('starter supplies reveal usable machinery without spoiling frontier materials', () => {
  const known = discoveries(new Simulation().state);
  assert.deepEqual(known.materials, ['log', 'ore', 'plank', 'ingot']);
  assert.deepEqual(known.recipes, ['club', 'sword', 'plank', 'ingot', 'gear']);
  for (const kind of ['quarry', 'steam', 'resonator', 'press', 'assembler', 'depot']) {
    assert.ok(!known.blueprints.includes(kind as typeof known.blueprints[number]), kind);
  }
  for (const kind of ['lumber', 'mine', 'sawmill', 'furnace', 'conveyor', 'storage', 'windmill']) {
    assert.ok(known.blueprints.includes(kind as typeof known.blueprints[number]), kind);
  }
});

test('crafting discovers goods; spending the last one and reloading preserves knowledge', () => {
  const sim = new Simulation();
  sim.craft('gear');
  assert.ok(discoveries(sim.state).materials.includes('gear'));
  assert.ok(discoveries(sim.state).recipes.includes('mechanism'));
  sim.craft('mechanism');
  assert.equal(sim.state.inventory.gear, 0);
  const restored = Simulation.restore(sim.serialize());
  assert.ok(discoveries(restored.state).materials.includes('gear'));
  assert.ok(discoveries(restored.state).materials.includes('mechanism'));
  assert.ok(!discoveries(restored.state).blueprints.includes('press'));
});

test('chapter unlocks and frontier ingredients reveal their respective blueprints', () => {
  const sim = new Simulation();
  sim.state.unlock = 1;
  assert.ok(discoveries(sim.state).blueprints.includes('press'));
  assert.ok(!discoveries(sim.state).materials.includes('gear'));
  sim.state.inventory.copper = 5;
  assert.ok(discoveries(sim.state).blueprints.includes('quarry'));
  assert.ok(!discoveries(sim.state).blueprints.includes('steam'));
  sim.state.inventory.coal = 5;
  assert.ok(discoveries(sim.state).blueprints.includes('steam'));
  assert.ok(discoveries(sim.state).recipes.includes('steel'));
  assert.ok(!discoveries(sim.state).blueprints.includes('resonator'));
});

test('other engineers cannot reveal undiscovered materials through their machines', () => {
  const sim = new Simulation();
  sim.state.owner = 'me';
  const machine = building('resonator', 0, 0, 0, 1);
  machine.owner = 'someone-else';machine.input = { crystal: 1 };
  sim.state.buildings.push(machine);
  assert.deepEqual(discoveries(sim.state).materials, ['log', 'ore', 'plank', 'ingot']);
});
