import { performance } from 'node:perf_hooks';
import { Simulation, building, newState } from '../src/simulation';
const state=newState();state.buildings=[];
// Synthetic workload beyond the island's building area, to exercise simulation scaling.
for(let row=0;row<100;row++){
  const source=building('storage',0,row,0,state.nextId++);source.input={ore:100};state.buildings.push(source);
  for(let x=1;x<=10;x++)state.buildings.push(building('conveyor',x,row,0,state.nextId++));
  state.buildings.push(building('storage',11,row,0,state.nextId++));
}
const sim=new Simulation(state),start=performance.now();for(let i=0;i<600;i++)sim.tick(.1);
const elapsed=performance.now()-start;
console.log(JSON.stringify({workload:'100 source and sink pairs, 1,000 belt tiles',ticks:600,elapsedMs:Math.round(elapsed),msPerTick:elapsed/600},null,2));
