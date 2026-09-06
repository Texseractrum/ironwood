import type {GameSession} from './session';

/** Share input immediately, coalescing only keystrokes faster than 20 updates/sec. */
export class LiveChatInput {
  private timer?:ReturnType<typeof setTimeout>;
  private lastSent=-Infinity;
  private active=false;
  constructor(private input:HTMLInputElement,private session:GameSession,private finish:()=>void){
    input.addEventListener('input',()=>{
      this.active=true;
      clearTimeout(this.timer);
      const wait=50-(performance.now()-this.lastSent);
      if(wait<=0)this.publish();else this.timer=setTimeout(()=>this.publish(),wait);
    });
    input.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing)return;
      if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();this.close();input.blur();}
    });
    input.addEventListener('blur',()=>this.close());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.close();});
    window.addEventListener('blur',()=>this.close());
  }
  private publish(){this.lastSent=performance.now();this.session.speak(this.input.value);}
  close(){
    clearTimeout(this.timer);
    if(this.active)this.session.speak(this.input.value,true);
    this.active=false;this.lastSent=-Infinity;this.input.value='';this.finish();
  }
}
