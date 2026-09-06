import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { newState, building } from '../src/simulation';

const dense=newState();dense.buildings=[];dense.unlock=2;dense.player={x:0,z:0};
for(let z=-8;z<=8;z++)for(let x=-11;x<=11;x++){
  // Freeze the original island footprint so map-expansion work cannot change this workload.
  if((x/11.8)**2+(z/9.7)**2>=1||(Math.abs(x)<2&&Math.abs(z)<2))continue;
  const kind=z%3===0?'conveyor':x%3===0?'windmill':x%2===0?'sawmill':'furnace';
  const b=building(kind,x,z,0,dense.nextId++);b.input={log:4,ore:8};dense.buildings.push(b);
}
const browser=await chromium.launch({headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]});
const url=process.env.PLAY_URL||'http://localhost:5173';
const results=[];
try{
  for(const [name,dpr,save] of [['starter-1x',1,null],['starter-retina',2,null],['dense-retina',2,dense]] as const){
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:dpr});
    if(save)await page.addInitScript(s=>localStorage.setItem('ironwood-save-v1',s),JSON.stringify(save));
    await page.goto(url);await page.waitForFunction(()=>!!(window as any).ironwood);
    if(save&&(await page.evaluate(()=>(window as any).ironwood.snapshot().buildings.length))!==save.buildings.length)throw new Error('Benchmark save did not restore; refusing to report an invalid dense-factory sample.');
    await page.waitForTimeout(1500);
    const session=await page.context().newCDPSession(page);await session.send('Performance.enable');
    const before=await session.send('Performance.getMetrics');
    const sample=await page.evaluate(`new Promise(resolve=>{
      let mutations=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(document.getElementById('ui'),{subtree:true,childList:true,characterData:true,attributes:true});
      const frames=[];let start=performance.now(),last=start;
      const tick=(time)=>{frames.push(time-last);last=time;if(time-start<5500){requestAnimationFrame(tick);return;}
        observer.disconnect();frames.shift();frames.sort((a,b)=>a-b);const mean=frames.reduce((a,b)=>a+b,0)/frames.length;resolve({mean,p95:frames[Math.floor(frames.length*.95)],fps:1000/mean,mutations});};requestAnimationFrame(tick);
    })`) as {mean:number;p95:number;fps:number;mutations:number};
    const after=await session.send('Performance.getMetrics');const metrics=(list:{name:string;value:number}[])=>Object.fromEntries(list.map(m=>[m.name,m.value]));const a=metrics(after.metrics),b=metrics(before.metrics);
    const diagnostics=await page.evaluate(()=>(window as any).ironwood.diagnostics());
    const row={name,url,buildings:save?.buildings.length,viewport:'1440x1000',devicePixelRatio:dpr,frameMs:sample.mean,p95FrameMs:sample.p95,fps:sample.fps,domMutations:sample.mutations,scriptMs:(a.ScriptDuration-b.ScriptDuration)*1000,taskMs:(a.TaskDuration-b.TaskDuration)*1000,diagnostics};results.push(row);console.log(JSON.stringify(row));
    await page.close();
  }
  await writeFile(`.context/performance-${process.argv[2]||'latest'}.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
