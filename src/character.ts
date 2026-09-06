import * as THREE from 'three';
import {APRON_COLORS,HAIR_COLORS,JACKET_COLORS,SKIN_TONES,appearanceKey,normalizeAppearance,type Appearance} from './appearance';

/** Geometry from the GLB stays shared; each engineer owns their material palette. */
export class Character {
  readonly root:THREE.Group;
  private parts:THREE.Object3D[]=[];
  private materials=new Map<THREE.Material,THREE.Material>();
  private extras=new THREE.Group();private hair=new THREE.Group();private cap=new THREE.Group();private goggles=new THREE.Group();
  private hats:THREE.Mesh[]=[];private key='';
  private hairMaterial=new THREE.MeshStandardMaterial({roughness:1});
  private capMaterial=new THREE.MeshStandardMaterial({roughness:.85});
  private look=normalizeAppearance();
  constructor(template:THREE.Group){
    this.root=template.clone(true);
    this.root.traverse(o=>{
      if(o.name.startsWith('leg_')||o.name.startsWith('arm_'))this.parts.push(o);
      if(o instanceof THREE.Mesh){
        const clone=(m:THREE.Material)=>{if(!this.materials.has(m))this.materials.set(m,m.clone());return this.materials.get(m)!;};
        o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
        if(!Array.isArray(o.material)&&o.material.name==='IW_roof')this.hats.push(o);
      }
    });
    const mesh=(parent:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number)=>{
      const item=new THREE.Mesh(geometry,material);item.position.set(x,y,z);item.castShadow=true;item.receiveShadow=true;parent.add(item);return item;
    };
    mesh(this.hair,new THREE.SphereGeometry(.204,10,6,0,Math.PI*2,0,Math.PI/2),this.hairMaterial,0,1.055,0).scale.y=.7;
    mesh(this.hair,new THREE.BoxGeometry(.29,.17,.08),this.hairMaterial,0,1.025,-.145);
    mesh(this.cap,new THREE.SphereGeometry(.222,10,6,0,Math.PI*2,0,Math.PI/2),this.capMaterial,0,1.13,0).scale.y=.65;
    mesh(this.cap,new THREE.BoxGeometry(.35,.035,.26),this.capMaterial,0,1.13,.155);
    const brass=new THREE.MeshStandardMaterial({color:'#bb914b',metalness:.65,roughness:.35});
    const glass=new THREE.MeshStandardMaterial({color:'#8bd6d5',metalness:.3,roughness:.2});
    const dark=new THREE.MeshStandardMaterial({color:'#302820',roughness:.8});
    for(const x of [-.085,.085]){
      mesh(this.extras,new THREE.SphereGeometry(.016,6,4),dark,x,1.02,.19);
      mesh(this.goggles,new THREE.TorusGeometry(.063,.014,6,12),brass,x,1.035,.2);
      mesh(this.goggles,new THREE.CircleGeometry(.052,12),glass,x,1.035,.207);
    }
    mesh(this.goggles,new THREE.BoxGeometry(.048,.02,.018),brass,0,1.035,.206);
    this.extras.add(this.hair,this.cap,this.goggles);this.root.add(this.extras);this.apply();
  }
  apply(value?:Appearance){
    const key=appearanceKey(value);if(key===this.key)return false;this.key=key;
    const a=this.look=normalizeAppearance(value);
    for(const material of this.materials.values())if(material instanceof THREE.MeshStandardMaterial){
      const color=material.name==='IW_skin'?SKIN_TONES[a.skin].color:material.name==='IW_shirt'?JACKET_COLORS[a.jacket].color:material.name==='IW_woodlight'?APRON_COLORS[a.apron].color:undefined;
      if(color)material.color.set(color);
    }
    this.hats.forEach(hat=>hat.visible=a.hat==='brimmed');this.cap.visible=a.hat==='cap';this.goggles.visible=a.goggles;
    this.hairMaterial.color.set(HAIR_COLORS[a.hair].color);this.capMaterial.color.set(JACKET_COLORS[a.jacket].color);
    return true;
  }
  /** Base pose runs before gathering/combat; return the bounce above the ground. */
  animate(elapsed:number,walking:boolean){
    for(const part of this.parts){const sign=part.name.endsWith('left')?1:-1;part.rotation.x=walking?Math.sin(elapsed*11)*.55*sign*(part.name.startsWith('arm')?-1:1):Math.sin(elapsed*2)*.025;}
    return walking?Math.abs(Math.sin(elapsed*11))*.035:0;
  }
  get appearance(){return {...this.look};}
  dispose(){
    this.materials.forEach(m=>m.dispose());
    const materials=new Set<THREE.Material>([this.hairMaterial,this.capMaterial]);
    this.extras.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();materials.add(o.material as THREE.Material);}});
    materials.forEach(m=>m.dispose());this.root.removeFromParent();
  }
}

/** Renders only when a choice, rotation, or viewport size changes. */
export class CharacterPreview {
  private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(32,1,.1,20);private character:Character;
  private observer:ResizeObserver;
  constructor(private canvas:HTMLCanvasElement,template:THREE.Group,appearance:Appearance){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
    this.scene.add(new THREE.HemisphereLight('#fff5de','#687354',2.5));
    const light=new THREE.DirectionalLight('#fff0ce',3);light.position.set(-3,5,4);this.scene.add(light);
    this.character=new Character(template);this.character.apply(appearance);this.character.root.rotation.y=-.35;this.scene.add(this.character.root);
    this.camera.position.set(0,1.5,3.3);this.camera.lookAt(0,.66,0);
    this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(canvas);this.draw();
  }
  update(appearance:Appearance){this.character.apply(appearance);this.draw();}
  rotate(degrees:number){this.character.root.rotation.y=degrees*Math.PI/180;this.draw();}
  private draw(){const {width,height}=this.canvas.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.render(this.scene,this.camera);}
  dispose(){this.observer.disconnect();this.character.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
