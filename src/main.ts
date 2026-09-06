import './style.css';
import { Simulation, newState } from './simulation';
import { World } from './world';
import { UI } from './ui';
import { GameSession } from './session';
import {Nameplates} from './nameplates';
import {ClanUI} from './clan-ui';
import {CELL} from './data';
import {CombatUI} from './combat-ui';
import {MobileControls} from './mobile-controls';
import './mobile.css';

async function start(){
  const recovery=false;
  const sim=new Simulation({...newState(),openWorld:true,inventory:{},deposits:{},discovered:[],base:{x:16,z:16},player:{x:16*CELL,z:16*CELL}});
  const world=new World(document.getElementById('world') as HTMLCanvasElement,sim);
  await world.load();const session=new GameSession(sim);const ui=new UI(sim,world,session);
  session.onSpawn=()=>world.focusPlayer();
  const combat=new CombatUI(world,session,ui);
  const nameplates=new Nameplates(world,session,()=>ui.account(),message=>ui.toast(message,6000));
  const clans=new ClanUI(session,world,message=>ui.toast(message,6000),(base,label)=>{ui.waypoint={...base,label};ui.renderedMap='';ui.toast('Follow the compass to your clan’s base.');});
  const mobile=new MobileControls(world,ui,session);
  const url=new URL(location.href),auth=url.searchParams.get('auth');url.searchParams.delete('room');url.searchParams.delete('auth');history.replaceState(null,'',url);session.start();
  if(auth){const messages:Record<string,string>={success:'Signed in with X. Loading your saved workshop…',cancelled:'Login cancelled. You can keep playing as a guest.',expired:'That login expired. Please try again.',failed:'X login could not be completed. Your progress is still here; please try again.'};if(messages[auth])ui.toast(messages[auth],6500);}
  document.getElementById('loading')!.remove();
  let last=performance.now(),accumulator=0,uiClock=0,saveClock=0;
  let fpsFrames=0,fpsTime=0,fps=0;
  function frame(now:number){
    const wallDt=(now-last)/1000;const dt=Math.min(wallDt,.1);last=now;
    if(document.hidden){requestAnimationFrame(frame);return;}
    const running=!ui.paused&&!ui.modalOpen&&!document.hidden;
    if(running&&!session.room){accumulator+=dt;while(accumulator>=.1){sim.tick(.1);accumulator-=.1;}}
    else accumulator=0;
    mobile.update();world.render(dt,running&&(!session.room||session.connected));nameplates.update();session.update(dt);uiClock+=dt;saveClock+=dt;
    if(uiClock>.2){ui.update(uiClock);clans.update();uiClock=0;}
    if(saveClock>20){if(!recovery)ui.save();saveClock=0;}
    fpsFrames++;fpsTime+=wallDt;if(fpsTime>1){fps=fpsFrames/fpsTime;fpsFrames=0;fpsTime=0;ui.updateFps(fps);}
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange',()=>{last=performance.now();world.keys.clear();if(document.hidden){world.cancelConveyor();if(!recovery)ui.save();}});
  window.addEventListener('pagehide',()=>{if(!recovery)ui.save();});
  // Read-only diagnostics for automated verification; mutations use ordinary UI controls.
  Object.defineProperty(window,'ironwood',{value:{
    snapshot:()=>structuredClone(sim.state),
    gathering:()=>world.gathering?.diagnostics,
    combat:()=>combat.view.diagnostics,
    characters:()=>({own:world.character?.appearance,crew:Object.fromEntries([...world.crewCharacters].map(([id,character])=>[id,character.appearance]))}),
    audio:()=>ui.audio.diagnostics,
    session:()=>({room:session.room,id:session.id,status:session.status,connected:session.connected,players:session.players,bases:session.bases,explored:session.explored,chat:session.chat,clan:session.clan,invites:session.invites}),
    project:(x:number,z:number)=>world.project(x*2.3,z*2.3),
    diagnostics:()=>({fps,calls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles,geometries:world.renderer.info.memory.geometries,textures:world.renderer.info.memory.textures,graphics:{...world.graphics,pixelRatio:world.renderer.getPixelRatio(),width:world.canvas.width,height:world.canvas.height,shadowSize:world.sun.shadow.mapSize.x,staticBatches:world.staticBatches.children.length},assets:[...world.assets.keys()],power:{supply:sim.supply,demand:sim.demand,wires:world.wires.userData.connections||0,wiresVisible:world.wires.visible,highlighted:world.showPower}})
  }});
  requestAnimationFrame(frame);
}
start().catch(error=>{
  console.error(error);const loading=document.getElementById('loading')!;
  loading.innerHTML='<p>The island could not be loaded.</p><small>Please reload the page. A browser with WebGL support is required.</small><button onclick="location.reload()">Try again</button>';
});
