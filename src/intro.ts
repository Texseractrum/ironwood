import {ownsBuilding,type State} from './simulation';

export const INTRO_KEY='ironwood-intro-seen-v1';
export function isNewWorkshop(state:State):boolean {
  return state.unlock===0&&!state.won&&state.built===0&&state.gathered===0
    &&!state.buildings.some(b=>ownsBuilding(state,b))&&!Object.values(state.produced).some(n=>n>0);
}
export function hasSeenIntro(owner:string):boolean {
  try{return localStorage.getItem(`${INTRO_KEY}:${owner}`)==='seen';}catch{return false;}
}
export function rememberIntro(owner:string){
  try{localStorage.setItem(`${INTRO_KEY}:${owner}`,'seen');}catch{/* The UI also remembers dismissal for this visit. */}
}

export function introContent(windmill:string):string {
  const touch=typeof matchMedia==='function'&&matchMedia('(max-width: 800px), (pointer: coarse)').matches;
  return `<div class="intro-layout">
    <section class="intro-art" aria-label="Welcome to the Ironwood frontier">
      <span class="intro-brand">IRONWOOD <span>THE ART OF INDUSTRY</span></span>
      <div class="intro-model" aria-hidden="true"><span class="intro-orbit"></span><img src="${windmill}" alt="" draggable="false"/></div>
      <div class="intro-art-caption"><span class="intro-rule"></span><p>A little wind.<br>A world of possibility.</p><small>A FIELD NOTE FROM THE MECHANIST’S GUILD</small></div>
    </section>
    <section class="intro-letter">
      <span class="eyebrow">YOUR STORY STARTS HERE</span>
      <h2 id="intro-title">Welcome to <br>Ironwood.</h2>
      <p id="intro-description">An open clearing, a pack of supplies, and an idea. That’s all you need to turn this quiet corner of the frontier into a workshop full of life.</p>
      <ol class="intro-steps">
        <li><span>01</span><div><h3>Start with the forest</h3><p>Set up a lumber camp to gather timber.</p></div></li>
        <li><span>02</span><div><h3>Put the wind to work</h3><p>Power your machines and connect them with conveyors.</p></div></li>
        <li><span>03</span><div><h3>Make something remarkable</h3><p>Turn raw materials into your first working factory.</p></div></li>
      </ol>
      <p class="intro-reassurance">The tutorial will guide you, one small step at a time.</p>
      <button id="begin-tutorial" class="button intro-begin">Begin building <span aria-hidden="true">→</span></button>
      <div class="intro-options"><label><input id="intro-sound" type="checkbox"/> Sound effects</label><button id="intro-look-around">Look around first</button></div>
      <p class="intro-controls">${touch?'Drag the thumb stick to move · Tap Build to start':'<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move <span>·</span> <kbd>H</kbd> field guide'}</p>
    </section>
  </div>`;
}
