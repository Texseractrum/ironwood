import * as THREE from 'three';
import {noise} from './terrain';

// Continuous world-space variation; the hash used by the simulation stays unchanged.
export function surfaceNoise(x:number,z:number,salt:number){
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const sx=u*u*(3-2*u),sz=v*v*(3-2*v);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(noise(ix,iz,salt),noise(ix+1,iz,salt),sx),
    THREE.MathUtils.lerp(noise(ix,iz+1,salt),noise(ix+1,iz+1,salt),sx),sz);
}

function detailTexture(){
  const size=512;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d')!;
  const channels:Uint8ClampedArray[]=[];
  let seed=73471;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Both patterns wrap at their edges. R holds grass fibers, G holds gravel.
  for(const grass of [true,false]){
    const pixels=ctx.createImageData(size,size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const ix=Math.floor(x/64),iy=Math.floor(y/64),u=(x%64)/64,v=(y%64)/64;
      const sx=u*u*(3-2*u),sy=v*v*(3-2*v);
      const patch=THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(noise(ix,iy,102),noise((ix+1)%8,iy,102),sx),
        THREE.MathUtils.lerp(noise(ix,(iy+1)%8,102),noise((ix+1)%8,(iy+1)%8,102),sx),sy);
      const value=155+patch*48+random()*24;
      const i=(y*size+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    for(let i=0;i<(grass?13500:4300);i++){
      const x=random()*size,y=random()*size,length=grass?2+random()*9:.5+random()*2.8;
      const bend=(random()-.5)*(grass?7:2),tone=Math.floor(90+random()*148);
      ctx.strokeStyle=`rgb(${tone} ${tone} ${tone})`;ctx.fillStyle=ctx.strokeStyle;
      ctx.lineWidth=grass?.65+random()*.65:1;
      // Copy only marks crossing an edge to the opposite side of the tile.
      for(const ox of [0,...(x<10?[size]:x>size-10?[-size]:[])]){
        for(const oy of [0,...(y<12?[size]:y>size-12?[-size]:[])]){
          ctx.beginPath();
          if(grass){ctx.moveTo(x+ox,y+oy);ctx.quadraticCurveTo(x+ox+bend*.3,y+oy-length*.5,x+ox+bend,y+oy-length);ctx.stroke();}
          else{ctx.ellipse(x+ox,y+oy,length,length*.6,bend,0,Math.PI*2);ctx.fill();}
        }
      }
    }
    channels.push(ctx.getImageData(0,0,size,size).data);
  }
  const pixels=new Uint8Array(size*size*4);
  for(let i=0;i<pixels.length;i+=4){pixels[i]=channels[0][i];pixels[i+1]=channels[1][i];pixels[i+2]=255;pixels[i+3]=255;}
  const texture=new THREE.DataTexture(pixels,size,size);
  texture.name='Grass fibers and gravel';texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

export function createTerrainMaterial(anisotropy:number){
  // Rasterize on first render, so terrain data and resource checks also work without a DOM.
  const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);
  let ready=false;
  const material=new THREE.MeshStandardMaterial({vertexColors:true,map:texture,bumpMap:texture,bumpScale:.085,roughness:1});
  material.name='Textured meadow, forest and gravel';
  material.onBeforeCompile=shader=>{
    if(!ready){texture.copy(detailTexture());texture.anisotropy=Math.min(8,anisotropy);texture.needsUpdate=true;ready=true;}
    shader.uniforms.terrainDetail={value:texture};
    shader.vertexShader=`attribute float vegetation; varying float vVegetation;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvVegetation = vegetation;');
    shader.fragmentShader=`
      uniform sampler2D terrainDetail;
      varying float vVegetation;
      float terrainGrain(vec2 uv) {
        vec2 detail = texture2D(terrainDetail, uv).rg;
        return mix(detail.g, detail.r, smoothstep(0.15, 0.85, vVegetation));
      }
      ${shader.fragmentShader}`
      .replace('#include <map_fragment>','diffuseColor.rgb *= terrainGrain(vMapUv);')
      .replace('#include <bumpmap_pars_fragment>',THREE.ShaderChunk.bumpmap_pars_fragment
        .replace(/texture2D\( bumpMap, ([^)]+) \)\.x/g,'terrainGrain( $1 )'));
  };
  material.customProgramCacheKey=()=> 'ironwood-terrain-detail-v1';
  return material;
}
