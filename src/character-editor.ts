import type * as THREE from 'three';
import {APRON_COLORS,DEFAULT_APPEARANCE,HAIR_COLORS,HEADWEAR,JACKET_COLORS,SKIN_TONES,normalizeAppearance,type Appearance} from './appearance';
import {CharacterPreview} from './character';
import type {GameSession} from './session';
import './character.css';

const palettes={skin:SKIN_TONES,jacket:JACKET_COLORS,apron:APRON_COLORS,hair:HAIR_COLORS};
const labels={skin:'Skin tone',jacket:'Jacket',apron:'Apron',hair:'Hair color'};
export function characterEditorContent(){
  return `<div class="character-heading"><span class="eyebrow">THE MECHANIST’S WARDROBE</span><h2 id="character-title">Make your mark.</h2><p>A familiar face. An outfit of your own.</p></div>
    <form id="character-form"><div class="character-layout">
      <section class="character-preview" aria-label="Engineer preview">
        <span class="eyebrow">YOUR ENGINEER</span><canvas id="character-preview" role="img" aria-label="3D preview of your engineer"></canvas>
        <div class="character-turn"><label for="character-rotation">Rotate preview</label><input id="character-rotation" type="range" min="-180" max="180" value="-20" step="5"/></div>
        <span class="character-preview-note">Ready for the frontier.</span>
      </section>
      <fieldset id="character-options" class="character-options"><legend class="sr-only">Customize your engineer</legend>
        ${Object.entries(palettes).map(([key,options])=>`<fieldset class="character-palette"><legend>${labels[key as keyof typeof labels]} <span id="character-${key}-value"></span></legend><div class="character-swatches">${Object.entries(options).map(([value,option])=>`<label class="character-swatch" title="${option.label}"><input type="radio" name="${key}" value="${value}" aria-label="${option.label}"/><span style="--swatch:${option.color}" aria-hidden="true"><span>✓</span></span></label>`).join('')}</div></fieldset>`).join('')}
        <fieldset class="character-headwear"><legend>Headwear</legend><div>${Object.entries(HEADWEAR).map(([value,label])=>`<label><input type="radio" name="hat" value="${value}"/><span>${label}</span></label>`).join('')}</div></fieldset>
        <label class="character-goggles"><input name="goggles" type="checkbox"/><span>Brass goggles<small>A little ingenuity looks good on you.</small></span></label>
      </fieldset>
    </div><div class="character-footer"><p id="character-feedback" role="status">Your look is saved with your engineer and shared with the world.</p><div class="character-actions"><button type="button" id="character-random" class="button secondary">Surprise me</button><button type="button" id="character-reset" class="character-reset">Reset look</button><span></span><button type="button" id="character-cancel" class="button secondary">Cancel</button><button type="submit" id="character-save" class="button">Save look</button></div></div></form>`;
}

export class CharacterEditor {
  private preview:CharacterPreview;private draft:Appearance;private disposed=false;
  private owner:string;private form:HTMLFormElement;
  constructor(private dialog:HTMLDialogElement,template:THREE.Group,private session:GameSession,private toast:(message:string)=>void){
    this.owner=session.id;this.draft=normalizeAppearance(session.players.find(p=>p.id===session.id)?.appearance);
    this.form=dialog.querySelector<HTMLFormElement>('#character-form')!;
    this.preview=new CharacterPreview(this.form.querySelector('#character-preview')!,template,this.draft);
    this.sync();
    this.form.addEventListener('change',event=>{
      if(!(event.target instanceof HTMLInputElement)||event.target.id==='character-rotation')return;
      const data=new FormData(this.form);
      this.draft=normalizeAppearance({...Object.fromEntries(data),goggles:data.has('goggles')});this.sync();
    });
    this.form.querySelector<HTMLInputElement>('#character-rotation')!.oninput=event=>this.preview.rotate(Number((event.target as HTMLInputElement).value));
    this.form.querySelector<HTMLButtonElement>('#character-random')!.onclick=()=>{
      const pick=(o:object)=>{const keys=Object.keys(o);return keys[Math.floor(Math.random()*keys.length)];};
      this.draft=normalizeAppearance({...Object.fromEntries(Object.entries(palettes).map(([k,v])=>[k,pick(v)])),hat:pick(HEADWEAR),goggles:Math.random()<.5});this.sync();
    };
    this.form.querySelector<HTMLButtonElement>('#character-reset')!.onclick=()=>{this.draft={...DEFAULT_APPEARANCE};this.sync();};
    this.form.querySelector<HTMLButtonElement>('#character-cancel')!.onclick=()=>dialog.close();
    this.form.onsubmit=event=>{event.preventDefault();void this.save();};
  }
  private sync(){
    for(const input of this.form.querySelectorAll<HTMLInputElement>('input[type="radio"]'))input.checked=this.draft[input.name as keyof Appearance]===input.value;
    this.form.querySelector<HTMLInputElement>('[name="goggles"]')!.checked=this.draft.goggles;
    for(const key of Object.keys(palettes) as (keyof typeof palettes)[]){
      const palette=palettes[key] as Record<string,{label:string}>;
      this.form.querySelector(`#character-${key}-value`)!.textContent=palette[this.draft[key]].label;
    }
    this.preview.update(this.draft);
  }
  private async save(){
    const feedback=this.form.querySelector('#character-feedback')!,button=this.form.querySelector<HTMLButtonElement>('#character-save')!;
    if(this.owner!==this.session.id){feedback.textContent='Your engineer changed. Close and reopen the editor to customize them.';return;}
    if(button.disabled)return;
    button.disabled=true;button.textContent='Saving…';feedback.textContent='Saving your look…';
    this.form.querySelector<HTMLFieldSetElement>('#character-options')!.disabled=true;
    for(const id of ['character-random','character-reset'])this.form.querySelector<HTMLButtonElement>('#'+id)!.disabled=true;
    const error=await this.session.customize(this.draft);
    if(this.disposed)return;
    if(!error){this.dialog.close();this.toast('Your engineer’s new look is saved.');return;}
    feedback.textContent=error;button.disabled=false;button.textContent='Save look';
    this.form.querySelector<HTMLFieldSetElement>('#character-options')!.disabled=false;
    for(const id of ['character-random','character-reset'])this.form.querySelector<HTMLButtonElement>('#'+id)!.disabled=false;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.preview.dispose();}
}
