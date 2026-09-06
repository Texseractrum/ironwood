import * as THREE from 'three';
import type {World} from './world';
import {MAX_HEALTH,MOB_TYPES,type CombatEvent,type CombatState,type CombatTarget,type Mob,type Weapon} from './combat-data';

const ATTACK_ARC_ANGLE=Math.PI*.8;

/** RingGeometry is drawn in XY, then laid onto XZ; offset its centre onto +Z, the model's forward axis. */
export const attackArcRotation=(angle:number)=>angle-Math.PI/2-ATTACK_ARC_ANGLE/2;

/** Low-poly creatures and reusable combat rigs; no gameplay decisions live here. */
export class CombatView {
  mobs=new Map<string,THREE.Group>();
  private bars=new Map<string,{root:THREE.Group;fill:THREE.Mesh}>();
  private rigs=new Map<string,{arm:THREE.Object3D;group:THREE.Group;weapon:Weapon}>();
  private swings=new Map<string,{left:number;angle:number}>();
  private effects:{mesh:THREE.Mesh;left:number}[]=[];
  private box=new THREE.BoxGeometry(1,1,1);
  private orb=new THREE.IcosahedronGeometry(1,1);
  private cone=new THREE.ConeGeometry(1,1,5);
  private plane=new THREE.PlaneGeometry(1,1);
  private arc=new THREE.RingGeometry(1.05,1.2,18,1,0,ATTACK_ARC_ANGLE);
  private wood=new THREE.MeshStandardMaterial({color:'#765139',roughness:.9});
  private iron=new THREE.MeshStandardMaterial({color:'#cbd8d1',metalness:.7,roughness:.3});
  private gold=new THREE.MeshStandardMaterial({color:'#d5b46c',metalness:.5,roughness:.4});
  private fur=new THREE.MeshStandardMaterial({color:'#5b655e',roughness:1});
  private dark=new THREE.MeshStandardMaterial({color:'#263a35',roughness:1});
  private slime=new THREE.MeshStandardMaterial({color:'#9b80ca',emissive:'#52316f',emissiveIntensity:.18,roughness:.35});
  private eyes=new THREE.MeshBasicMaterial({color:'#ffdb8b'});
  private barBack=new THREE.MeshBasicMaterial({color:'#293c32',depthTest:false});
  private barGood=new THREE.MeshBasicMaterial({color:'#a6c97e',depthTest:false});
  private barEnemy=new THREE.MeshBasicMaterial({color:'#db896d',depthTest:false});
  private barShield=new THREE.MeshBasicMaterial({color:'#d8c477',depthTest:false});
  constructor(private world:World){}
  get diagnostics(){return {swings:[...this.swings.keys()],healthBars:[...this.bars].filter(([,bar])=>bar.root.visible).map(([id])=>id)};}
  private part(root:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number){
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;root.add(mesh);return mesh;
  }
  private creature(mob:Mob){
    const root=new THREE.Group();root.name=mob.id;
    if(mob.kind==='wolf'){
      this.part(root,this.box,this.fur,0,.7,0,.68,.64,1.18);
      this.part(root,this.box,this.fur,0,1.02,.65,.64,.6,.65);
      this.part(root,this.box,this.dark,0,.92,1.02,.37,.25,.3);
      for(const side of [-1,1]){
        this.part(root,this.cone,this.fur,side*.22,1.45,.56,.17,.45,.2);
        this.part(root,this.orb,this.eyes,side*.325,1.1,.8,.065,.06,.07);
        for(const end of [-1,1]){const leg=this.part(root,this.box,this.dark,side*.25,.3,end*.4,.16,.55,.19);leg.name=`mob-leg:${side*end}`;}
      }
      const tail=this.part(root,this.cone,this.fur,0,.9,-.85,.22,.8,.22);tail.rotation.x=-.8;
    }else{
      this.part(root,this.orb,this.slime,0,.58,0,.95,.78,.85);
      this.part(root,this.cone,this.iron,0,1.36,0,.22,.55,.22);
      for(const side of [-1,1])this.part(root,this.orb,this.eyes,side*.29,.82,.71,.09,.14,.055);
    }
    this.world.scene.add(root);this.world.shadowDirty=true;return root;
  }
  private bar(id:string,x:number,y:number,z:number,fraction:number,enemy:boolean,protectedNow=false){
    let bar=this.bars.get(id);
    if(!bar){
      const root=new THREE.Group(),back=new THREE.Mesh(this.plane,this.barBack),fill=new THREE.Mesh(this.plane,this.barGood);
      back.scale.set(1.42,.09,1);fill.scale.set(1.35,.045,1);fill.position.z=.01;back.renderOrder=12;fill.renderOrder=13;
      root.add(back,fill);this.world.scene.add(root);bar={root,fill};this.bars.set(id,bar);
    }
    bar.root.position.set(x,y,z);bar.root.quaternion.copy(this.world.camera.quaternion);
    bar.root.visible=fraction<1||protectedNow;
    const width=1.35*Math.max(0,Math.min(1,fraction));bar.fill.scale.x=width;bar.fill.position.x=(width-1.35)/2;
    bar.fill.material=protectedNow?this.barShield:enemy?this.barEnemy:this.barGood;
  }
  private weapon(id:string,root:THREE.Group,state?:CombatState){
    const weapon=state?.weapon??'fists',arm=root.getObjectByName('arm_right');if(!arm)return;
    let rig=this.rigs.get(id);
    if(rig&&(rig.weapon!==weapon||rig.arm!==arm)){rig.group.removeFromParent();this.rigs.delete(id);rig=undefined;}
    if(!rig){
      const group=new THREE.Group();group.name='combat-weapon';group.position.y=-.25;group.rotation.x=-Math.PI/2;arm.add(group);
      if(weapon==='club'){
        this.part(group,this.box,this.wood,0,-.35,0,.08,.65,.08);
        this.part(group,this.box,this.wood,0,-.82,0,.23,.45,.22);
        this.part(group,this.box,this.iron,0,-.8,0,.25,.08,.24);
      }else if(weapon==='sword'){
        this.part(group,this.box,this.wood,0,-.15,0,.075,.3,.075);
        this.part(group,this.box,this.gold,0,-.31,0,.38,.075,.13);
        this.part(group,this.box,this.iron,0,-.75,0,.14,.8,.06);
        const tip=this.part(group,this.cone,this.iron,0,-1.2,0,.1,.24,.04);tip.rotation.z=Math.PI;
      }else if(weapon==='spear'){
        this.part(group,this.box,this.wood,0,-.6,0,.055,1.7,.055);
        const tip=this.part(group,this.cone,this.iron,0,-1.6,0,.14,.45,.07);tip.rotation.z=Math.PI;
      }
      rig={arm,group,weapon};this.rigs.set(id,rig);
    }
    const gathering=id===this.world.ownId?this.world.gathering:this.world.crewGathering.get(id);
    const swing=this.swings.get(id);
    if(swing&&gathering?.active)gathering.cancel();
    rig.group.visible=!gathering?.active&&state?.health!==0;
    if(swing){root.rotation.y=swing.angle;arm.rotation.x=1.3+Math.sin(swing.left/.35*Math.PI)*1.3;arm.rotation.z=-.2;}
    else if(!gathering?.active)arm.rotation.z=0;
  }
  hit(event:CombatEvent){
    if(Math.hypot(event.x-this.world.sim.state.player.x,event.z-this.world.sim.state.player.z)>70)return;
    const angle=Math.atan2(event.x-event.fromX,event.z-event.fromZ);
    if(event.attacker.kind==='player'){
      // The local input already played this swing; acknowledgements must not replay it.
      if(event.attacker.id!==this.world.ownId)this.swing(event.attacker.id,event.fromX,event.fromZ,angle);
    }else this.swingEffect(event.fromX,event.fromZ,angle,'#eb967e');
  }
  swing(id:string,x:number,z:number,angle:number){
    (id===this.world.ownId?this.world.gathering:this.world.crewGathering.get(id))?.cancel();
    this.swings.set(id,{left:.35,angle});
    this.swingEffect(x,z,angle,'#fff0b2');
  }
  private swingEffect(x:number,z:number,angle:number,color:string){
    const material=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false});
    const mesh=new THREE.Mesh(this.arc,material);mesh.rotation.x=-Math.PI/2;mesh.rotation.z=attackArcRotation(angle);
    mesh.position.set(x,this.world.footHeight(x,z)+.9,z);this.world.scene.add(mesh);this.effects.push({mesh,left:.3});
    this.world.shadowDirty=true;
  }
  update(dt:number){
    const w=this.world,s=w.sim.state,activeBars=new Set<string>(),activeRigs=new Set<string>([w.ownId]);
    w.player.visible=s.combat?.health!==0;
    if(w.player.visible){this.bar(w.ownId,w.player.position.x,w.player.position.y+2.2,w.player.position.z,(s.combat?.health??MAX_HEALTH)/MAX_HEALTH,false,(s.combat?.protectedUntil??0)>s.time);activeBars.add(w.ownId);this.weapon(w.ownId,w.player,s.combat);}
    for(const p of w.crew){
      const root=w.crewObjects.get(p.id);if(!root)continue;activeRigs.add(p.id);root.visible=p.combat?.health!==0;
      if(!root.visible)continue;
      const allied=s.clanMembers?.includes(p.id)??false;
      this.bar(p.id,root.position.x,root.position.y+2.2,root.position.z,(p.combat?.health??MAX_HEALTH)/MAX_HEALTH,!allied,(p.combat?.protectedUntil??0)>s.time);activeBars.add(p.id);this.weapon(p.id,root,p.combat);
    }
    const activeMobs=new Set<string>();
    for(const mob of s.mobs??[]){
      if(mob.health<=0)continue;activeMobs.add(mob.id);
      let root=this.mobs.get(mob.id);
      if(!root){root=this.creature(mob);root.position.set(mob.x,w.footHeight(mob.x,mob.z),mob.z);this.mobs.set(mob.id,root);}
      const dx=mob.x-root.position.x,dz=mob.z-root.position.z,blend=1-Math.exp(-12*dt);
      if(Math.hypot(dx,dz)>.015)root.rotation.y=Math.atan2(dx,dz);
      root.position.x+=dx*blend;root.position.z+=dz*blend;root.position.y=w.footHeight(root.position.x,root.position.z);
      if(mob.kind==='slime'){const bounce=Math.sin(w.elapsed*5+mob.homeX);root.scale.set(1-bounce*.06,1+bounce*.1,1-bounce*.06);}
      else root.children.forEach(part=>{if(part.name.startsWith('mob-leg:'))part.rotation.x=Math.hypot(dx,dz)>.01?Math.sin(w.elapsed*10)*.5*Number(part.name.split(':')[1]):0;});
      this.bar(mob.id,root.position.x,root.position.y+1.95,root.position.z,mob.health/MOB_TYPES[mob.kind].health,true);activeBars.add(mob.id);
    }
    for(const [id,root] of this.mobs)if(!activeMobs.has(id)){root.removeFromParent();this.mobs.delete(id);w.shadowDirty=true;}
    for(const [id,bar] of this.bars)if(!activeBars.has(id)){bar.root.removeFromParent();this.bars.delete(id);}
    for(const [id,rig] of this.rigs)if(!activeRigs.has(id)){rig.group.removeFromParent();this.rigs.delete(id);}
    for(const [id,swing] of this.swings){swing.left-=dt;if(swing.left<=0){this.swings.delete(id);const rig=this.rigs.get(id);if(rig)rig.arm.rotation.set(0,0,0);}}
    this.effects=this.effects.filter(effect=>{effect.left-=dt;(effect.mesh.material as THREE.MeshBasicMaterial).opacity=Math.max(0,effect.left/.3)*.85;if(effect.left>0)return true;effect.mesh.removeFromParent();(effect.mesh.material as THREE.Material).dispose();return false;});
  }
  pick(clientX:number,clientY:number):CombatTarget|undefined {
    const w=this.world,rect=w.canvas.getBoundingClientRect();
    w.ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),w.camera);
    const targets=[...this.mobs].map(([id,root])=>({target:{kind:'mob',id} as CombatTarget,root}));
    for(const [id,root] of w.crewObjects)if(root.visible)targets.push({target:{kind:'player',id},root});
    const hit=w.ray.intersectObjects(targets.filter(t=>t.root.visible).map(t=>t.root),true)[0];
    if(!hit)return;
    let object:THREE.Object3D|null=hit.object;
    while(object){const target=targets.find(t=>t.root===object);if(target)return target.target;object=object.parent;}
  }
}
