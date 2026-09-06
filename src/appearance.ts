/** Compact, allowlisted cosmetics shared by the renderer and world server. */
export const SKIN_TONES = {
  porcelain: {label:'Porcelain',color:'#f3d4ba'}, sand: {label:'Sand',color:'#ddb08b'},
  tan: {label:'Tan',color:'#c77d47'}, copper: {label:'Copper',color:'#a9633f'},
  umber: {label:'Umber',color:'#78482f'}, ebony: {label:'Ebony',color:'#492f26'},
} as const;
export const JACKET_COLORS = {
  moss: {label:'Moss',color:'#a6b279'}, ocean: {label:'Ocean',color:'#548ba2'},
  rust: {label:'Rust',color:'#b96242'}, plum: {label:'Plum',color:'#876887'},
  cream: {label:'Cream',color:'#e3d4ab'}, charcoal: {label:'Charcoal',color:'#515c59'},
} as const;
export const APRON_COLORS = {
  leather: {label:'Leather',color:'#7d4a20'}, walnut: {label:'Walnut',color:'#493021'},
  canvas: {label:'Canvas',color:'#c2ad7d'}, slate: {label:'Slate',color:'#536575'},
} as const;
export const HAIR_COLORS = {
  chestnut: {label:'Chestnut',color:'#603b25'}, black: {label:'Black',color:'#292522'},
  gold: {label:'Golden',color:'#c59a51'}, silver: {label:'Silver',color:'#bbbcb1'},
} as const;
export const HEADWEAR = {brimmed:'Field hat',cap:'Work cap',none:'No hat'} as const;
export interface Appearance {
  skin:keyof typeof SKIN_TONES;jacket:keyof typeof JACKET_COLORS;apron:keyof typeof APRON_COLORS;
  hair:keyof typeof HAIR_COLORS;hat:keyof typeof HEADWEAR;goggles:boolean;
}
export const DEFAULT_APPEARANCE:Readonly<Appearance> = {
  skin:'tan',jacket:'moss',apron:'leather',hair:'chestnut',hat:'brimmed',goggles:false,
};
const choices={skin:SKIN_TONES,jacket:JACKET_COLORS,apron:APRON_COLORS,hair:HAIR_COLORS,hat:HEADWEAR};
export function isAppearance(value:unknown):value is Appearance {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const a=value as Record<string,unknown>;
  return typeof a.goggles==='boolean'&&Object.entries(choices).every(([key,options])=>typeof a[key]==='string'&&Object.hasOwn(options,a[key] as string));
}
/** Old profiles and partial/malformed saves retain the original engineer look. */
export function normalizeAppearance(value?:unknown):Appearance {
  const result={...DEFAULT_APPEARANCE};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  const a=value as Record<string,unknown>;
  for(const key of Object.keys(choices) as (keyof typeof choices)[]){
    if(typeof a[key]==='string'&&Object.hasOwn(choices[key],a[key] as string))Object.assign(result,{[key]:a[key]});
  }
  if(typeof a.goggles==='boolean')result.goggles=a.goggles;
  return result;
}
export function appearanceKey(value?:Appearance){return JSON.stringify(normalizeAppearance(value));}
