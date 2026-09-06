import {CELL,ITEMS,type Item} from './data';
import {BIOMES,biomeAt,chunkAt,sitesAround,proceduralSite,CLAIM_RADIUS} from './terrain';
import {ownsBuilding,type Simulation} from './simulation';
import type {GameSession} from './session';
import './atlas.css';
import {itemIcon} from './item-icons';
import {mapPlayers,NEARBY_MAP_DISTANCE} from './map-players';

type Waypoint={x:number;z:number;label:string};
const resources:Item[]=['log','ore','coal','copper','crystal'];
const glyph:Partial<Record<Item,string>>={log:'T',ore:'Fe',coal:'C',copper:'Cu',crystal:'✦'};
const node=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export class Atlas {
  center={x:0,z:0};span=64;filter='all';private listKey='';
  constructor(private sim:Simulation,private session:GameSession,private getWaypoint:()=>Waypoint|null,private mark:(p:Waypoint|null)=>void){}
  content(){return `<div class="atlas-heading"><span class="eyebrow">IRONWOOD · SHARED WORLD</span><h2 id="atlas-title">Find your next frontier.</h2><p>Explore to reveal land and deposits. Every engineer shares this world; each workshop has its own home.</p></div><div class="atlas-layout"><section class="atlas-map"><div class="atlas-toolbar"><button id="map-me" class="button secondary">Locate me</button><button id="map-home" class="button secondary">My base</button><div class="map-zoom"><button id="map-out" aria-label="Zoom out">−</button><button id="map-in" aria-label="Zoom in">+</button></div></div><canvas id="atlas-canvas" width="840" height="440" tabindex="0" aria-label="World map" aria-describedby="map-instructions"></canvas><div class="atlas-coordinate"><span id="map-position"></span><span>◆ Home &nbsp; ● Engineers &nbsp; ▪ Machines</span></div><p id="map-instructions" class="note">Drag to pan · scroll to zoom · click an engineer or a destination to mark their location.<br>Keyboard: arrows pan, + / − zoom, Enter marks the center. N is up.</p></section><aside class="atlas-sidebar"><h3 id="map-people-title">Nearby engineers</h3><p class="map-people-note">Within ${Math.round(NEARBY_MAP_DISTANCE)} m of you · select an engineer to mark their current location.</p><div id="map-people" class="map-destinations" role="group" aria-labelledby="map-people-title"></div><h3>Where next?</h3><p id="map-waypoint" role="status"></p><button id="map-clear" class="button secondary">Clear waypoint</button><label for="map-resource">Find a resource</label><select id="map-resource"><option value="all">All discovered resources</option>${resources.map(item=>`<option value="${item}">${ITEMS[item].name}</option>`).join('')}</select><div id="map-resources" class="map-destinations"></div><h3>Nearby workshops</h3><div id="map-bases" class="map-destinations"></div></aside></div><div class="atlas-legend">${resources.map(item=>`<span>${itemIcon(item)}${ITEMS[item].name}</span>`).join('')}<span><b class="fog-key">?</b>Unexplored</span></div>`;}
  mount(){
    this.center={x:this.sim.state.player.x/CELL,z:this.sim.state.player.z/CELL};this.filter='all';
    node('map-me').onclick=()=>{this.center={x:this.sim.state.player.x/CELL,z:this.sim.state.player.z/CELL};this.draw();};
    node('map-home').onclick=()=>{const base=this.sim.state.base;if(base){this.center={...base};this.set({...base,label:'My base'});}};
    node('map-in').onclick=()=>this.zoom(.75);node('map-out').onclick=()=>this.zoom(1.333);
    node('map-clear').onclick=()=>{this.mark(null);this.draw();this.waypointText();};
    node<HTMLSelectElement>('map-resource').onchange=e=>{this.filter=(e.target as HTMLSelectElement).value;this.list();this.draw();};
    const canvas=node<HTMLCanvasElement>('atlas-canvas');
    let drag:{x:number;y:number;cx:number;cz:number;moved:boolean}|undefined;
    canvas.onpointerdown=e=>{if(e.button!==0)return;canvas.focus();canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,cx:this.center.x,cz:this.center.z,moved:false};};
    canvas.onpointermove=e=>{if(!drag)return;const scale=this.span/canvas.getBoundingClientRect().width;drag.moved||=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5;if(drag.moved){this.center={x:drag.cx-(e.clientX-drag.x)*scale,z:drag.cz-(e.clientY-drag.y)*scale};this.draw();}};
    canvas.onpointerup=e=>{if(drag&&!drag.moved){
      const r=canvas.getBoundingClientRect(),x=this.center.x+((e.clientX-r.left)/r.width-.5)*this.span,z=this.center.z+((e.clientY-r.top)/r.height-.5)*this.span*canvas.height/canvas.width;
      const engineer=this.engineers().map(({player})=>{const px=r.width/2+(player.x/CELL-this.center.x)*r.width/this.span,pz=r.height/2+(player.z/CELL-this.center.z)*r.height/(this.span*canvas.height/canvas.width);return {player,px,pz,distance:Math.hypot(px-(e.clientX-r.left),pz-(e.clientY-r.top))};}).filter(p=>p.px>=0&&p.px<=r.width&&p.pz>=0&&p.pz<=r.height&&p.distance<=14).sort((a,b)=>a.distance-b.distance)[0];
      if(engineer)this.markEngineer(engineer.player.id);
      else{const site=this.knownSites().find(p=>Math.hypot(p.x-x,p.z-z)<this.span/70);this.set(site?{x:site.x,z:site.z,label:site.name}:{x:Math.round(x),z:Math.round(z),label:this.sim.isExplored(x,z)?'Map destination':'Unexplored land'});}
    }drag=undefined;};
    canvas.onpointercancel=()=>drag=undefined;
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY>0?1.12:.89);},{passive:false});
    canvas.onkeydown=e=>{const step=this.span/8;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','+','=','-'].includes(e.key))e.preventDefault();if(e.key==='ArrowUp')this.center.z-=step;if(e.key==='ArrowDown')this.center.z+=step;if(e.key==='ArrowLeft')this.center.x-=step;if(e.key==='ArrowRight')this.center.x+=step;if(e.key==='+'||e.key==='=')this.zoom(.75);if(e.key==='-')this.zoom(1.333);if(e.key==='Enter')this.set({x:Math.round(this.center.x),z:Math.round(this.center.z),label:'Map destination'});this.draw();};
    this.list();this.draw();this.waypointText();
  }
  private zoom(factor:number){this.span=Math.max(32,Math.min(1024,this.span*factor));this.draw();}
  private set(p:Waypoint){this.mark(p);this.waypointText();this.draw();}
  private waypointText(){const p=this.getWaypoint();node('map-waypoint').textContent=p?`${p.label} · ${this.distance(p.x,p.z)} m away. Close the map and follow the compass.`:'Choose an engineer, resource, workshop, or point on the map to set a waypoint.';}
  private distance(x:number,z:number){return Math.round(Math.hypot(x*CELL-this.sim.state.player.x,z*CELL-this.sim.state.player.z));}
  private engineers(){return mapPlayers(this.session.connected?this.session.players:[],this.session.id,this.sim.state.player,(x,z)=>this.sim.isExplored(x,z));}
  nearby(){return this.engineers().filter(entry=>entry.nearby);}
  private markEngineer(id:string){
    const entry=this.engineers().find(entry=>entry.player.id===id);if(!entry)return;
    const player=entry.player;this.center={x:player.x/CELL,z:player.z/CELL};this.set({...this.center,label:player.name+'’s location'});
  }
  private listPeople(){
    const list=node('map-people'),nearby=this.nearby(),ids=new Set(nearby.map(({player})=>player.id));
    for(const row of [...list.children]){const id=(row as HTMLElement).dataset.playerId;if(id&&!ids.has(id))row.remove();}
    if(!nearby.length){
      const message=this.session.connected?`No other engineers within ${Math.round(NEARBY_MAP_DISTANCE)} m. Explore to meet someone.`:'Reconnecting… Nearby engineers will appear when you’re back online.';
      if(list.textContent!==message){const empty=document.createElement('p');empty.className='note';empty.textContent=message;list.replaceChildren(empty);}return;
    }
    list.querySelector('.note')?.remove();
    nearby.forEach(({player,distance},index)=>{
      let button=[...list.children].find(row=>(row as HTMLElement).dataset.playerId===player.id) as HTMLButtonElement|undefined;
      if(!button){button=document.createElement('button');button.className='map-destination map-person';button.dataset.playerId=player.id;const dot=document.createElement('i');dot.className='map-person-dot';dot.setAttribute('aria-hidden','true');button.append(dot,document.createElement('b'),document.createElement('span'));button.onclick=()=>this.markEngineer(player.id);list.append(button);}
      const dot=button.querySelector<HTMLElement>('i')!,name=button.querySelector('b')!,detail=button.querySelector('span')!;
      dot.style.backgroundColor=player.color;if(name.textContent!==player.name)name.textContent=player.name;
      const subtitle=`${Math.round(distance)} m away${this.session.clan?.id&&player.clanId===this.session.clan.id?' · Your clan':''}`;if(detail.textContent!==subtitle)detail.textContent=subtitle;
      // Keep keyboard focus stable while live positions reorder the list.
      if(!list.contains(document.activeElement)&&list.children[index]!==button)list.insertBefore(button,list.children[index]||null);
    });
  }
  private knownSites(){return this.sim.state.discovered.map(proceduralSite).filter(p=>p!==undefined).filter(p=>this.sim.isExplored(p.x,p.z)&&(this.filter==='all'||p.item===this.filter));}
  private list(){
    const destinations=node('map-resources');destinations.replaceChildren();
    const sites=this.knownSites().sort((a,b)=>this.distance(a.x,a.z)-this.distance(b.x,b.z)).slice(0,8);
    for(const site of sites){const button=document.createElement('button');button.className='map-destination';button.dataset.site=site.id;const reserve=this.sim.state.deposits[site.id];button.innerHTML=`<b>${itemIcon(site.item)}${site.name}</b><span>${this.distance(site.x,site.z)} m · ${site.x} : ${site.z}</span><small>${reserve===0?'Exhausted':site.tier?'Steel pickaxe required':'E to gather · build an extractor'}</small>`;button.onclick=()=>{this.center={x:site.x,z:site.z};this.set({x:site.x,z:site.z,label:site.name});};destinations.append(button);}
    if(!sites.length){destinations.innerHTML='<p class="note">No matching deposits surveyed yet. Walk into the fog to discover more. Crystals are rare; explore beyond your home region.</p>';}
    const bases=node('map-bases');bases.replaceChildren();
    for(const base of this.session.bases.filter(b=>b.id===this.session.id||this.sim.isExplored(b.x,b.z)).sort((a,b)=>this.distance(a.x,a.z)-this.distance(b.x,b.z)).slice(0,8)){
      const button=document.createElement('button');button.className='map-destination';const title=document.createElement('b');title.textContent=base.id===this.session.id?'◆ My base':`◆ ${base.name}`;const subtitle=document.createElement('span');subtitle.textContent=`${this.distance(base.x,base.z)} m · ${base.online?'Online':'Away'}`;button.append(title,subtitle);button.onclick=()=>{this.center={x:base.x,z:base.z};this.set({x:base.x,z:base.z,label:base.id===this.session.id?'My base':base.name+'’s base'});};bases.append(button);
    }
  }
  draw(){const canvas=node<HTMLCanvasElement>('atlas-canvas');if(canvas){
    const key=this.sim.state.discovered.join('|')+this.session.bases.map(b=>`${b.id}:${b.name}:${b.online}`).join('|');
    if(key!==this.listKey){this.listKey=key;this.list();}
    this.listPeople();
    this.paint(canvas,true);node('map-position').textContent=`Center ${Math.round(this.center.x)} : ${Math.round(this.center.z)} · ${this.session.status}`;
  }}
  paint(canvas:HTMLCanvasElement,large:boolean){
    const c=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,p=this.sim.state.player;
    const center=large?this.center:{x:p.x/CELL,z:p.z/CELL},span=large?this.span:40,scale=w/span;
    const x=(v:number)=>w/2+(v-center.x)*scale,z=(v:number)=>h/2+(v-center.z)*scale;
    c.fillStyle='#293c36';c.fillRect(0,0,w,h);
    const minX=center.x-span/2,minZ=center.z-span*h/w/2;
    // Draw explored cells only: resource markers never leak through the fog.
    for(const key of this.sim.state.explored){const [tx,tz]=key.split(',').map(Number);if(tx<minX-1||tx>minX+span+1||tz<minZ-1||tz>minZ+span*h/w+1)continue;c.fillStyle=BIOMES[biomeAt(tx,tz)].color;c.fillRect(x(tx-.5),z(tz-.5),scale+.5,scale+.5);}
    c.strokeStyle='#d4dfc518';c.lineWidth=1;const grid=span>256?64:16;
    for(let tx=Math.floor(minX/grid)*grid;tx<minX+span;tx+=grid){c.beginPath();c.moveTo(x(tx),0);c.lineTo(x(tx),h);c.stroke();}for(let tz=Math.floor(minZ/grid)*grid;tz<minZ+span*h/w;tz+=grid){c.beginPath();c.moveTo(0,z(tz));c.lineTo(w,z(tz));c.stroke();}
    const label=(text:string,px:number,pz:number,color='#fff7de')=>{c.font=`600 ${large?12:10}px sans-serif`;c.textAlign='center';c.lineWidth=4;c.strokeStyle='#263a30';c.strokeText(text,px,pz);c.fillStyle=color;c.fillText(text,px,pz);};
    for(const b of this.sim.state.buildings){if(!this.sim.isExplored(b.x,b.z))continue;c.fillStyle=ownsBuilding(this.sim.state,b)?'#fbdeb0':'#c4c8bd';c.fillRect(x(b.x)-2,z(b.z)-2,4,4);}
    const sites=large?this.knownSites():sitesAround(p.x/CELL,p.z/CELL,1).filter(site=>this.sim.state.discovered.includes(site.id)&&this.sim.isExplored(site.x,site.z));
    for(const site of sites){const px=x(site.x),pz=z(site.z);if(px<5||px>w-5||pz<5||pz>h-5)continue;c.fillStyle=this.sim.state.deposits[site.id]===0?'#6c766d':ITEMS[site.item].color;c.strokeStyle='#fff3d7';c.lineWidth=1.5;c.beginPath();c.arc(px,pz,large?9:4,0,Math.PI*2);c.fill();c.stroke();if(large){label(glyph[site.item]||'?',px,pz+4);if(span<=128)label(site.name,px,pz+24);}}
    const bases=this.session.bases.slice();if(this.sim.state.base&&!bases.some(b=>b.id===this.session.id))bases.push({...this.sim.state.base,id:this.session.id,name:'My base',color:'#e9c77e',online:true});
    for(const base of bases){if(base.id!==this.session.id&&!this.sim.isExplored(base.x,base.z))continue;const px=x(base.x),pz=z(base.z);if(px<0||px>w||pz<0||pz>h)continue;c.strokeStyle=base.color;c.lineWidth=1;c.setLineDash([4,4]);c.beginPath();c.arc(px,pz,CLAIM_RADIUS*scale,0,Math.PI*2);c.stroke();c.setLineDash([]);label('◆',px,pz);if(large)label(base.id===this.session.id?'MY BASE':base.name,px,pz-15,base.color);}
    const waypoint=this.getWaypoint();if(waypoint){c.strokeStyle='#f7d481';c.lineWidth=2;c.setLineDash([6,5]);c.beginPath();c.moveTo(x(p.x/CELL),z(p.z/CELL));c.lineTo(x(waypoint.x),z(waypoint.z));c.stroke();c.setLineDash([]);c.beginPath();c.arc(x(waypoint.x),z(waypoint.z),11,0,Math.PI*2);c.stroke();}
    for(const {player} of this.engineers().reverse()){
      const px=x(player.x/CELL),pz=z(player.z/CELL),radius=large?11:8;if(px<0||px>w||pz<0||pz>h)continue;
      c.beginPath();c.arc(px,pz,radius,0,Math.PI*2);c.fillStyle=player.color;c.fill();c.strokeStyle='#20382e';c.lineWidth=5;c.stroke();c.strokeStyle='#fff7de';c.lineWidth=2;c.stroke();
      c.fillStyle='#20382e';c.beginPath();c.arc(px,pz-radius*.3,radius*.25,0,Math.PI*2);c.fill();c.beginPath();c.arc(px,pz+radius*.48,radius*.48,Math.PI,0);c.fill();
      if(large)label(player.name,px,pz+27);
    }
    c.fillStyle='#ffffff';c.strokeStyle='#263a30';c.lineWidth=3;c.beginPath();c.arc(x(p.x/CELL),z(p.z/CELL),large?6:4,0,Math.PI*2);c.fill();c.stroke();if(large)label('YOU',x(p.x/CELL),z(p.z/CELL)+22);
    label('↑ N',w-30,26);c.fillStyle='#21392ce8';c.fillRect(10,h-37,132,27);c.fillStyle='#f7efd4';c.font='11px sans-serif';c.textAlign='left';c.fillText(`${Math.round(span*CELL/5)} m`,19,h-19);c.fillRect(65,h-24,w/5,2);
    if(large){c.strokeStyle='#efe7ce66';c.lineWidth=1;c.beginPath();c.moveTo(w/2-5,h/2);c.lineTo(w/2+5,h/2);c.moveTo(w/2,h/2-5);c.lineTo(w/2,h/2+5);c.stroke();}
  }
}
