export type GraphicsQuality = 'performance' | 'balanced' | 'quality';
export interface GraphicsSettings {quality:GraphicsQuality;showFps:boolean}
export const GRAPHICS_KEY='ironwood-graphics-v1';
export const GRAPHICS_PRESETS={
  performance:{pixelRatio:1,shadowSize:1024,shadowHz:10},
  balanced:{pixelRatio:1.25,shadowSize:2048,shadowHz:20},
  quality:{pixelRatio:2,shadowSize:2048,shadowHz:60}
} as const;
export function loadGraphics():GraphicsSettings {
  try{const s=JSON.parse(localStorage.getItem(GRAPHICS_KEY)||'null');if(s&&Object.hasOwn(GRAPHICS_PRESETS,s.quality))return {quality:s.quality,showFps:s.showFps===true};}catch{/* Private browser storage can be unavailable. */}
  return {quality:typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches?'performance':'balanced',showFps:false};
}
