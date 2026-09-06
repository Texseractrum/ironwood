import * as THREE from 'three';
import {ITEMS,type Item} from './data';

export interface GatherStrike {x:number;z:number;item:Item;amount:number}
export const GATHER_DURATION=.9;
export const GATHER_IMPACT=.43;
const ease=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

/** A reusable tool rig and chip batch; resource amounts remain server-authoritative. */
export class GatheringAnimation {
  private right?:THREE.Object3D;private left?:THREE.Object3D;
  private tool=new THREE.Group();private axe=new THREE.Group();private pick=new THREE.Group();
  private chips=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({roughness:.9}),14);
  private dummy=new THREE.Object3D();private clock=GATHER_DURATION;private strike?:GatherStrike;
  private impact=new THREE.Vector3();
  constructor(private root:THREE.Group,private scene:THREE.Scene,private height:(x:number,z:number)=>number){
    this.right=root.getObjectByName('arm_right');this.left=root.getObjectByName('arm_left');
    const wood=new THREE.MeshStandardMaterial({color:'#745139',roughness:.85});
    const steel=new THREE.MeshStandardMaterial({color:'#c3d3cf',metalness:.65,roughness:.3});
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.046,.85,6),wood);handle.position.y=-.55;
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.46,.26,.09),steel);blade.position.set(.12,-.98,0);this.axe.add(blade);
    for(const sign of [-1,1]){
      const tip=new THREE.Mesh(new THREE.ConeGeometry(.09,.4,5),steel);tip.rotation.z=-sign*Math.PI/2;tip.position.set(sign*.2,-.96,0);this.pick.add(tip);
    }
    this.tool.add(handle,this.axe,this.pick);this.tool.position.y=-.22;this.tool.visible=false;
    this.tool.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.right?.add(this.tool);
    this.chips.count=0;this.chips.frustumCulled=false;scene.add(this.chips);
  }
  get active(){return this.clock<GATHER_DURATION;}
  cancel(){
    this.clock=GATHER_DURATION;this.tool.visible=false;this.chips.count=0;this.root.rotation.x=0;
    this.right?.rotation.set(0,0,0);this.left?.rotation.set(0,0,0);
  }
  get diagnostics(){return {active:this.active,item:this.strike?.item,phase:this.clock,tool:this.tool.visible?(this.axe.visible?'axe':'pickaxe'):null,chips:this.chips.count};}
  start(strike:GatherStrike){
    this.strike=strike;this.clock=0;this.axe.visible=strike.item==='log';this.pick.visible=!this.axe.visible;
    this.tool.visible=true;this.chips.count=0;
    this.root.rotation.y=Math.atan2(this.root.position.x-strike.x,this.root.position.z-strike.z);
    // A seam spans a tile; strike its near edge so the tool visibly reaches it.
    const dx=strike.x-this.root.position.x,dz=strike.z-this.root.position.z,distance=Math.hypot(dx,dz)||1,reach=Math.min(distance,1.25);
    this.impact.set(this.root.position.x+dx/distance*reach,this.root.position.y+(strike.item==='log'?.8:.28),this.root.position.z+dz/distance*reach);
    (this.chips.material as THREE.MeshStandardMaterial).color.set(ITEMS[strike.item].color);
  }
  update(dt:number,moving=false){
    if(!this.active)return;
    this.clock=Math.min(GATHER_DURATION,this.clock+dt);
    const t=this.clock,chop=this.strike?.item==='log';
    const angle=t<.27?2.6*ease(t/.27):t<GATHER_IMPACT?2.6-(chop?1.3:1.7)*ease((t-.27)/(GATHER_IMPACT-.27)):(chop?1.3:.9)*(1-ease((t-GATHER_IMPACT)/(GATHER_DURATION-GATHER_IMPACT)));
    if(this.right){this.right.rotation.x=angle;this.right.rotation.z=chop?-.5*Math.sin(t/GATHER_DURATION*Math.PI):-.12*Math.sin(t/GATHER_DURATION*Math.PI);}
    if(this.left){this.left.rotation.x=angle*.65;this.left.rotation.z=.2*Math.sin(t/GATHER_DURATION*Math.PI);}
    this.root.rotation.x=-.13*Math.sin(t/GATHER_DURATION*Math.PI);
    if(!moving&&this.strike)this.root.rotation.y=Math.atan2(this.root.position.x-this.strike.x,this.root.position.z-this.strike.z);
    const age=t-GATHER_IMPACT;
    this.chips.count=age>=0&&this.active?14:0;
    for(let i=0;i<this.chips.count;i++){
      const a=i*2.399,speed=.8+(i%4)*.4;
      this.dummy.position.set(this.impact.x+Math.cos(a)*speed*age,this.impact.y+(1.8+i%3*.5)*age-5*age*age,this.impact.z+Math.sin(a)*speed*age);
      this.dummy.position.y=Math.max(this.height(this.dummy.position.x,this.dummy.position.z)+.025,this.dummy.position.y);
      this.dummy.rotation.set(age*8+i,age*6,age*9);
      const size=(.08+(i%3)*.025)*(1-age/.55);this.dummy.scale.set(size,chop?size*.35:size,chop?size*1.8:size);
      this.dummy.updateMatrix();this.chips.setMatrixAt(i,this.dummy.matrix);
    }
    this.chips.instanceMatrix.needsUpdate=true;
    if(!this.active){this.tool.visible=false;this.root.rotation.x=0;if(this.right)this.right.rotation.set(0,0,0);if(this.left)this.left.rotation.set(0,0,0);}
  }
  dispose(){
    this.scene.remove(this.chips);this.chips.dispose();this.chips.geometry.dispose();(this.chips.material as THREE.Material).dispose();
    const materials=new Set<THREE.Material>();this.tool.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();materials.add(o.material as THREE.Material);}});materials.forEach(m=>m.dispose());this.tool.removeFromParent();
  }
}
