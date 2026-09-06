export type SoundEffect='select'|'wood'|'stone'|'crystal'|'build'|'dismantle'|'craft'|'collect'|'feed'|'discovery'|'milestone'|'welcome'|'footstep';
export interface AudioSettings {enabled:boolean;volume:number}
export const AUDIO_KEY='ironwood-audio-v1';

export function loadAudio():AudioSettings {
  try{
    const value=JSON.parse(localStorage.getItem(AUDIO_KEY)||'null');
    if(value&&typeof value.enabled==='boolean'&&typeof value.volume==='number'&&Number.isFinite(value.volume))
      return {enabled:value.enabled,volume:Math.max(0,Math.min(1,value.volume))};
  }catch{/* Sound still works when browser storage is unavailable. */}
  return {enabled:true,volume:.65};
}

// These are the successful result messages emitted by the simulation. Requests,
// failed actions, and other engineers' snapshots must never sound like success.
export function soundForResult(message:string):SoundEffect|undefined {
  if(/^Built /.test(message)||message==='Conveyor route updated.')return 'build';
  if(message==='Dismantled. Materials returned.')return 'dismantle';
  if(/^Crafted /.test(message))return 'craft';
  if(/^Collected \d+ items\.$/.test(message))return 'collect';
  if(/^Loaded \d+ ingredients\.$/.test(message))return 'feed';
  if(/^Upgraded to /.test(message))return 'milestone';
}

export function noiseBuffer(context:BaseAudioContext):AudioBuffer {
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  return buffer;
}

/** Short, original workshop Foley. Every voice has an envelope and a finite end. */
export function renderEffect(context:BaseAudioContext,destination:AudioNode,effect:SoundEffect,at:number,noise:AudioBuffer):AudioScheduledSourceNode[] {
  const voices:AudioScheduledSourceNode[]=[];
  const voice=(source:AudioScheduledSourceNode,chain:AudioNode[],duration:number,volume:number,delay=0)=>{
    const gain=context.createGain(),start=at+delay;
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.004);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);gain.gain.setValueAtTime(0,start+duration+.01);
    let previous:AudioNode=source;for(const node of chain){previous.connect(node);previous=node;}
    previous.connect(gain);gain.connect(destination);
    source.onended=()=>{source.disconnect();for(const node of chain)node.disconnect();gain.disconnect();};
    source.start(start);source.stop(start+duration+.02);voices.push(source);
  };
  const tone=(frequency:number,duration:number,volume:number,delay=0,end=frequency,type:OscillatorType='sine')=>{
    const source=context.createOscillator();source.type=type;source.frequency.setValueAtTime(frequency,at+delay);
    source.frequency.exponentialRampToValueAtTime(end,at+delay+duration);voice(source,[],duration,volume,delay);
  };
  const rustle=(frequency:number,duration:number,volume:number,delay=0,q=.7)=>{
    const source=context.createBufferSource(),filter=context.createBiquadFilter();source.buffer=noise;
    source.playbackRate.value=.92+Math.random()*.16;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=q;
    voice(source,[filter],duration,volume,delay);
  };
  const bell=(frequency:number,delay=0,volume=.08)=>{
    tone(frequency,.65,volume,delay);tone(frequency*2.76,.28,volume*.22,delay);
  };
  const variation=.96+Math.random()*.08;
  switch(effect){
    case 'select':tone(620,.045,.055,0,420,'triangle');break;
    case 'wood':rustle(850,.11,.3);tone(175*variation,.16,.2,0,65);tone(390,.055,.055,0,190,'triangle');break;
    case 'stone':rustle(2100,.075,.17);tone(1280*variation,.23,.065);tone(2170*variation,.12,.028);tone(145,.08,.1,0,60);break;
    case 'crystal':rustle(2800,.07,.11);bell(1046*variation,0,.07);bell(1568,.06,.045);break;
    case 'build':tone(135,.18,.18,0,48);rustle(620,.13,.21);tone(740,.09,.05,.055,440,'triangle');break;
    case 'dismantle':rustle(550,.21,.22);tone(230,.14,.11,0,75,'triangle');rustle(1400,.09,.09,.1);break;
    case 'craft':tone(780,.12,.09,0,540,'triangle');rustle(1800,.06,.13);tone(990,.18,.08,.115);break;
    case 'collect':tone(660,.13,.085,0,720);tone(990,.2,.07,.075);rustle(2800,.055,.07);break;
    case 'feed':rustle(720,.18,.18);tone(190,.12,.1,.035,80);break;
    case 'footstep':rustle(420,.065,.095);tone(95,.065,.04,0,55);break;
    case 'discovery':bell(784,0,.055);bell(1175,.12,.055);break;
    case 'milestone':for(const [i,note] of [523.25,659.25,783.99,1046.5].entries())bell(note,i*.105,.06);break;
    case 'welcome':for(const [i,note] of [392,523.25,659.25,783.99].entries())bell(note,i*.14,.065);tone(196,.8,.055);break;
  }
  return voices;
}

export class GameAudio {
  settings=loadAudio();
  private context?:AudioContext;private master?:GainNode;private noise?:AudioBuffer;
  private voices=new Set<AudioScheduledSourceNode>();private lastPlayed=new Map<SoundEffect,number>();
  private played=0;private lastEffect?:SoundEffect;
  constructor(){
    const activate=(event:Event)=>{if(event.isTrusted)void this.unlock();};
    document.addEventListener('pointerdown',activate,{capture:true});document.addEventListener('keydown',activate,{capture:true});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){this.stop();void this.context?.suspend().catch(()=>{});}
      else if(this.context)void this.unlock();
    });
    window.addEventListener('pagehide',()=>{this.stop();void this.context?.suspend().catch(()=>{});});
  }
  async unlock(){
    if(!this.settings.enabled||document.hidden)return;
    try{
      if(!this.context){
        this.context=new AudioContext();this.master=this.context.createGain();this.noise=noiseBuffer(this.context);
        const compressor=this.context.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=5;
        this.master.gain.value=this.settings.volume*.65;this.master.connect(compressor);compressor.connect(this.context.destination);
      }
      if(this.context.state==='suspended')await this.context.resume();
    }catch{/* Audio support or autoplay restrictions must not interrupt the game. */}
  }
  setEnabled(enabled:boolean){
    this.settings.enabled=enabled;if(!enabled)this.stop();this.applySettings();if(enabled)void this.unlock();
  }
  setVolume(volume:number){
    if(!Number.isFinite(volume))return;this.settings.volume=Math.max(0,Math.min(1,volume));this.applySettings();
  }
  private applySettings(){
    if(this.master&&this.context)this.master.gain.setTargetAtTime(this.settings.enabled?this.settings.volume*.65:0,this.context.currentTime,.015);
    try{localStorage.setItem(AUDIO_KEY,JSON.stringify(this.settings));}catch{/* Preferences remain usable for this visit. */}
  }
  private stop(){for(const source of this.voices){try{source.stop();}catch{/* Already ended. */}}this.voices.clear();this.lastPlayed.clear();}
  play(effect:SoundEffect,delay=0){
    const context=this.context;
    if(!this.settings.enabled||this.settings.volume===0||document.hidden||!context||context.state!=='running'||!this.master||!this.noise)return;
    const now=context.currentTime,cooldown=effect==='footstep'?.24:effect==='select'?.065:.1;
    if(this.voices.size>24||now-(this.lastPlayed.get(effect)??-Infinity)<cooldown)return;
    this.lastPlayed.set(effect,now);
    try{
      for(const source of renderEffect(context,this.master,effect,now+delay,this.noise)){
        this.voices.add(source);source.addEventListener('ended',()=>this.voices.delete(source),{once:true});
      }
      this.played++;this.lastEffect=effect;
    }catch{/* A device interruption should only silence the effect. */}
  }
  get diagnostics(){return {...this.settings,state:this.context?.state||'locked',voices:this.voices.size,played:this.played,lastEffect:this.lastEffect};}
}
