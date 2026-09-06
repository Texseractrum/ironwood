import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDABLE, CELL, DEFS, DIRECTIONS, ITEMS, SITES, WORLD_RADIUS, isBelt, onIsland, type Kind, type Item } from './data';
import type { Player, Base } from './protocol';
import { TerrainView } from './terrain-view';
import { traversable,terrainHeight,terrainFootHeight } from './terrain';
import {GatheringAnimation,type GatherStrike} from './gathering';
import { Simulation, isStopped, type Building } from './simulation';
import { GRAPHICS_KEY, GRAPHICS_PRESETS, loadGraphics, type GraphicsSettings } from './graphics';
import {SCENERY,SCENERY_BY_ID,sceneryById,type Scenery} from './scenery';
import {conveyorCorner,extendConveyorPath,planConveyors,directionBetween,sameTile,MAX_CONVEYOR_TILES,type ConveyorPoint} from './conveyors';
import {Character} from './character';
import type {Appearance} from './appearance';
import {conveyorSurface,conveyorSurfaceHeight,conveyorItemPosition,foundationHeight,type ConveyorSurface} from './conveyor-surface';
import {conformConveyor,disposeConveyor} from './conveyor-view';
import {powerAnchor,powerCable} from './power-view';

const up=new THREE.Vector3(0,1,0);
export class World {
  scene=new THREE.Scene();
  camera=new THREE.OrthographicCamera();
  renderer:THREE.WebGLRenderer;
  sun=new THREE.DirectionalLight('#fff0ce',2.5);
  graphics:GraphicsSettings=loadGraphics();
  shadowClock=0;shadowDirty=true;lastShadowSimulation=-1;
  staticBatches=new THREE.Group();
  sceneryBatches:{mesh:THREE.InstancedMesh;nodes:Scenery[];matrices:THREE.Matrix4[];visible:boolean[]}[]=[];
  sceneryObjects=new Map<string,THREE.Object3D>();
  hoverResource?:string;
  desiredTarget=new THREE.Vector3();cameraOffset=new THREE.Vector3();
  assets=new Map<string,THREE.Group>();
  thumbnails:Record<string,string>={};
  objects=new Map<number,THREE.Group>();
  moving=new Map<number,THREE.Object3D[]>();
  items=new THREE.Group();
  itemMeshes=new Map<number,THREE.Mesh>();
  itemGeometry=new THREE.BoxGeometry(.28,.21,.32);
  itemMaterials={} as Record<Item,THREE.MeshStandardMaterial>;
  player=new THREE.Group();
  character?:Character;crewCharacters=new Map<string,Character>();
  gathering?:GatheringAnimation;crewGathering=new Map<string,GatheringAnimation>();
  private gridCell='';
  private foundationGeometry=new THREE.BoxGeometry(1,1,1);
  private foundationMaterial=new THREE.MeshStandardMaterial({color:'#8a8a74',roughness:1});
  ground=new THREE.Plane(up,0);
  ray=new THREE.Raycaster();pointer=new THREE.Vector2();
  grid=new THREE.Group();wires=new THREE.Group();markers=new THREE.Group();
  stoppedSignals=new THREE.Group();
  stoppedBeacons=new THREE.InstancedMesh(new THREE.SphereGeometry(.14,10,8),new THREE.MeshBasicMaterial({color:'#ff2b1c',toneMapped:false}),500);
  stoppedGlows=new THREE.InstancedMesh(new THREE.SphereGeometry(.34,10,8),new THREE.MeshBasicMaterial({color:'#ff3a26',transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),500);
  stoppedHalos=new THREE.InstancedMesh(new THREE.RingGeometry(.5,.78,24),new THREE.MeshBasicMaterial({color:'#ff3020',transparent:true,opacity:.42,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}),500);
  stoppedSignalKey='';
  ghost=new THREE.Group(); highlight=new THREE.Group();
  conveyorPreview=new THREE.Group();conveyorPath:ConveyorPoint[]=[];
  conveyorPlan?:ReturnType<typeof planConveyors>;
  private conveyorPointer?:number;private conveyorPreviewKey='';
  private conveyorSurfaces=new Map<string,ConveyorSurface>();private surfaceRevision=-1;private conveyorGhostKey='';
  onConveyors:(path:ConveyorPoint[],dir:number)=>void=()=>{};
  tutorialMarker=new THREE.Mesh(new THREE.RingGeometry(1.3,1.5,48),new THREE.MeshBasicMaterial({color:'#f6d276',side:THREE.DoubleSide}));
  selectedKind:Kind|null=null; dir=0; mode:'inspect'|'build'|'dismantle'='inspect';
  hover={x:0,z:0,valid:false}; pointerPresent=false;
  keys=new Set<string>(); touchMove={x:0,z:0,run:false}; azimuth=Math.PI/4; targetAzimuth=Math.PI/4;
  zoom=36; targetZoom=36; target=new THREE.Vector3(0,0,0);
  revision=-1; lastWalking=false;elapsed=0;showPower=false;
  particles=new THREE.Group();smoke:THREE.Mesh[]=[];
  onAction:(x:number,z:number,drag:boolean)=>void=()=>{};
  onMove:()=>void=()=>{};
  onRender:(dt:number)=>void=()=>{};
  onRotate:(id:number,dir?:number)=>void=(id,dir)=>{const b=this.sim.state.buildings.find(b=>b.id===id);if(b){b.dir=dir??(b.dir+1)%4;this.sim.revision++;}};
  onTurn:(x:number,z:number,dir:number)=>void=()=>{};
  multiplayer=false;crew:Player[]=[];crewObjects=new Map<string,THREE.Group>();
  terrain?:TerrainView;bases:Base[]=[];ownId='';
  constructor(public canvas:HTMLCanvasElement,public sim:Simulation){
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,GRAPHICS_PRESETS[this.graphics.quality].pixelRatio));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
    this.scene.background=new THREE.Color('#c9d0bc');
    this.scene.fog=new THREE.Fog('#c9d0bc',90,150);
    const hemi=new THREE.HemisphereLight('#edf4df','#687354',1.8);this.scene.add(hemi);
    const sun=this.sun;sun.position.set(-22,35,18);sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-36,right:36,top:32,bottom:-32,near:1,far:100});
    const shadowSize=GRAPHICS_PRESETS[this.graphics.quality].shadowSize;
    sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.bias=-.0003;sun.shadow.normalBias=.04;this.scene.add(sun);
    this.stoppedBeacons.count=0;this.stoppedGlows.count=0;this.stoppedHalos.count=0;
    this.stoppedSignals.add(this.stoppedHalos,this.stoppedGlows,this.stoppedBeacons);
    this.scene.add(this.items,this.grid,this.wires,this.markers,this.ghost,this.highlight,this.particles,this.staticBatches,this.stoppedSignals,this.conveyorPreview);
    this.tutorialMarker.rotation.x=-Math.PI/2;this.tutorialMarker.visible=false;this.scene.add(this.tutorialMarker);
    for(const [key,v] of Object.entries(ITEMS))this.itemMaterials[key as Item]=new THREE.MeshStandardMaterial({color:v.color,roughness:.7,metalness:key==='gear'||key==='ingot'?.45:0});
    this.bind();this.resize();
  }
  async load(){
    const loader=new GLTFLoader();
    await Promise.all([...BUILDABLE.filter(k=>!['quarry','steam','resonator','foundry','kiln','etcher','forge','artificer'].includes(k)),'conveyor_corner','engineer','island','tree','rock'].map(async name=>{
      const gltf=await loader.loadAsync(`/assets/models/${name}.glb`);
      gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
      this.assets.set(name,gltf.scene);
    }));
    this.makeFrontierAssets();this.makeThumbnails();this.environment();
    this.character=new Character(this.assets.get('engineer')!);this.player.add(this.character.root);this.player.scale.setScalar(1.13);
    this.scene.add(this.player);
    this.gathering=new GatheringAnimation(this.player,this.scene,(x,z)=>this.height(x,z));
    const ring=new THREE.Mesh(new THREE.RingGeometry(.6,.67,48),new THREE.MeshBasicMaterial({color:'#eee9b7',transparent:true,opacity:.75,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.025;ring.name='player_ring';this.player.add(ring);
    this.makeGrid();this.sync();
  }
  clone(name:string){return this.assets.get(name)!.clone(true);}
  setAppearance(appearance?:Appearance){if(this.character?.apply(appearance))this.shadowDirty=true;}
  height(x:number,z:number){return this.sim.state.openWorld?terrainHeight(x/CELL,z/CELL):0;}
  // Cover the animated boots, including their forward reach during a stride.
  footHeight(x:number,z:number){return this.sim.state.openWorld?terrainFootHeight(x/CELL,z/CELL,.45/CELL):0;}
  focusPlayer(){
    const p=this.sim.state.player;
    this.player.position.set(p.x,this.footHeight(p.x,p.z),p.z);
    this.target.set(p.x,this.height(p.x,p.z),p.z-1.7);
    this.camera.position.copy(this.target).add(this.cameraOffset.set(Math.sin(this.azimuth)*38,47,Math.cos(this.azimuth)*38));this.camera.lookAt(this.target);
    this.shadowDirty=true;
  }
  buildingHeight(x:number,z:number){return foundationHeight(x,z,!!this.sim.state.openWorld);}
  beltSurface(tile:ConveyorPoint){
    if(this.surfaceRevision!==this.sim.revision){this.conveyorSurfaces.clear();this.surfaceRevision=this.sim.revision;}
    const key=`${tile.x},${tile.z}`;let surface=this.conveyorSurfaces.get(key);
    if(!surface){surface=conveyorSurface(this.sim,tile);this.conveyorSurfaces.set(key,surface);}
    return surface;
  }
  gather(playerId:string,strike:GatherStrike){
    if(playerId===this.ownId)this.gathering?.start(strike);
    else this.crewGathering.get(playerId)?.start(strike);
    this.shadowDirty=true;
  }
  makeFrontierAssets(){
    this.assets.set('quarry',this.clone('mine'));
    for(const [name,source,color] of [['foundry','furnace','#7996a4'],['kiln','furnace','#a8d8d4'],['etcher','assembler','#78bfa8'],['forge','press','#dbb25f'],['artificer','assembler','#b599de']]){
      const root=this.clone(source);
      const crown=new THREE.Mesh(new THREE.TorusGeometry(.48,.09,6,16),new THREE.MeshStandardMaterial({color,metalness:.5,roughness:.35}));
      crown.position.set(0,1.65,0);crown.rotation.x=Math.PI/2;crown.name='spin_upgrade';root.add(crown);
      if(name==='artificer'){
        const core=new THREE.Mesh(new THREE.OctahedronGeometry(.35),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.4}));core.position.set(0,2.05,0);root.add(core);
      }
      this.assets.set(name,root);
    }
    for(let level=1;level<=3;level++){
      const material=new THREE.MeshStandardMaterial({color:['#9baeb0','#b6cbd3','#b699e1'][level-1],metalness:.6,roughness:.35});
      const marker=new THREE.Group();
      for(let i=0;i<level;i++){
        const band=new THREE.Mesh(new THREE.BoxGeometry(1.25,.07,1.25),material);band.position.y=.25+i*.25;marker.add(band);
      }
      this.assets.set(`upgrade-${level}`,marker);
    }
    for(const [name,color] of [['steam','#ba8155'],['resonator','#a58dde']]){
      const root=new THREE.Group(),base=this.clone('furnace');base.scale.set(.85,.8,.85);root.add(base);
      const tank=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,1.5,10),new THREE.MeshStandardMaterial({color,metalness:.6,roughness:.35}));tank.position.set(0,1.8,0);tank.castShadow=true;root.add(tank);
      const rotor=new THREE.Mesh(new THREE.TorusGeometry(.65,.09,6,12),new THREE.MeshStandardMaterial({color:'#d4b16c',metalness:.7,roughness:.4}));rotor.position.set(0,1.7,.55);rotor.name='spin_engine';root.add(rotor);
      if(name==='resonator'){
        const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.6),new THREE.MeshStandardMaterial({color:'#b6a0eb',emissive:'#7853b1',emissiveIntensity:.6,metalness:.3,roughness:.2}));crystal.position.set(0,2.7,0);root.add(crystal);
      }else{
        const iron=new THREE.MeshStandardMaterial({color:'#454b43',metalness:.6,roughness:.55});
        const stone=new THREE.MeshStandardMaterial({color:'#777465',roughness:1});
        const timber=new THREE.MeshStandardMaterial({color:'#99744b',roughness:.85});
        const stack=new THREE.Mesh(new THREE.CylinderGeometry(.19,.29,3.1,8),stone);stack.name='coal_chimney';stack.position.set(.66,1.65,-.52);root.add(stack);
        for(const y of [1.2,2.1,3.12]){const band=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.1,8),iron);band.position.set(.66,y,-.52);root.add(band);}
        const shaft=new THREE.Mesh(new THREE.BoxGeometry(.65,.18,.85),iron);shaft.position.set(-.69,.19,0);shaft.name='coal_mine_shaft';root.add(shaft);
        for(const z of [-.36,.36]){const beam=new THREE.Mesh(new THREE.BoxGeometry(.13,1.7,.13),timber);beam.position.set(-.69,1.02,z);root.add(beam);}
        const crossbar=new THREE.Mesh(new THREE.BoxGeometry(.18,.16,1),timber);crossbar.position.set(-.69,1.87,0);root.add(crossbar);
        const wheel=new THREE.Mesh(new THREE.TorusGeometry(.25,.06,6,12),iron);wheel.position.set(-.69,1.58,.4);wheel.name='spin_mine_wheel';root.add(wheel);
        const drill=new THREE.Mesh(new THREE.CylinderGeometry(.12,.07,1.15,6),iron);drill.position.set(-.69,.88,0);drill.name='spin_drill';root.add(drill);
        const seam=new THREE.Mesh(new THREE.DodecahedronGeometry(.2),new THREE.MeshStandardMaterial({color:'#30332f',roughness:1}));seam.position.set(-.82,.36,.62);root.add(seam);
      }
      root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
      this.assets.set(name,root);
    }
  }
  setGraphics(settings:GraphicsSettings){
    const qualityChanged=settings.quality!==this.graphics.quality;this.graphics=settings;
    if(qualityChanged){
      const preset=GRAPHICS_PRESETS[settings.quality];
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,preset.pixelRatio));this.resize();
      if(this.sun.shadow.mapSize.x!==preset.shadowSize){
        this.sun.shadow.mapSize.set(preset.shadowSize,preset.shadowSize);
        this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
      }
      this.shadowDirty=true;
    }
    try{localStorage.setItem(GRAPHICS_KEY,JSON.stringify(settings));}catch{/* Applies for this session even if storage is disabled. */}
  }
  makeThumbnails(){
    const r=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});r.setSize(156,124);r.setClearColor(0,0);r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.6;
    const s=new THREE.Scene();s.add(new THREE.HemisphereLight('#ffffff','#796851',3));const l=new THREE.DirectionalLight('#fff2cf',3);l.position.set(-3,6,5);s.add(l);
    for(const name of BUILDABLE){
      // The welcome letter also uses the windmill as a large illustration.
      r.setSize(name==='windmill'?624:156,name==='windmill'?496:124);
      const model=this.clone(name);s.add(model);const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
      const span=Math.max(size.y,size.x,size.z)*.91;
      const cam=new THREE.OrthographicCamera(-span*1.25,span*1.25,span,-span,.1,50);cam.position.copy(center).add(new THREE.Vector3(4,3,5));cam.lookAt(center);r.render(s,cam);
      this.thumbnails[name]=r.domElement.toDataURL('image/png');s.remove(model);
    }
    r.dispose();r.forceContextLoss();
  }
  environment(){
    if(this.sim.state.openWorld){this.terrain=new TerrainView(this.scene,this.assets,this.sim,this.renderer.capabilities.getMaxAnisotropy());this.terrain.update(this.sim.state.player.x,this.sim.state.player.z,[],this.ownId);this.scene.add(this.sun.target);this.target.set(this.sim.state.player.x,0,this.sim.state.player.z);return;}
    const island=this.clone('island');island.scale.set(WORLD_RADIUS.x/11.8,1,WORLD_RADIUS.z/9.7);this.scene.add(island);
    // A quiet, matte sea gives the raised island a diorama silhouette.
    const water=new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.MeshStandardMaterial({color:'#aebfaf',roughness:.95}));water.rotation.x=-Math.PI/2;water.position.y=-4.5;water.receiveShadow=true;this.scene.add(water);
    let seed=43;const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const trees:THREE.Matrix4[]=[];const rocks:THREE.Matrix4[]=[];
    const dummy=new THREE.Object3D();
    const treeNodes=SCENERY.filter(n=>n.kind==='tree'),rockNodes=SCENERY.filter(n=>n.kind==='rock');
    for(const [nodes,matrices] of [[treeNodes,trees],[rockNodes,rocks]] as const)for(const node of nodes){
      dummy.position.set(node.x,0,node.z);dummy.rotation.set(0,node.rotation,0);dummy.scale.setScalar(node.scale);dummy.updateMatrix();matrices.push(dummy.matrix.clone());
    }
    // Low grass tufts and scattered stones around the perimeter of the workshop.
    const grass=new THREE.BufferGeometry();const vertices:number[]=[];
    for(let i=0;i<1100;i++){
      const x=(rng()-.5)*WORLD_RADIUS.x*CELL*2,z=(rng()-.5)*WORLD_RADIUS.z*CELL*2;if(!onIsland(x/CELL,z/CELL))continue;
      if(Math.abs(x)<17&&z>-10&&z<9&&rng()<.88)continue;
      const h=.12+rng()*.22;vertices.push(x-.06,0,z,x,h,z,x+.06,0,z,x,0,z-.06,x,h,z,x,0,z+.06);
    }
    grass.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));grass.computeVertexNormals();
    this.scene.add(new THREE.Mesh(grass,new THREE.MeshStandardMaterial({color:'#6f8050',side:THREE.DoubleSide,roughness:1})));
    for(const site of SITES){
      const mat=new THREE.MeshBasicMaterial({color:ITEMS[site.item].color,transparent:true,opacity:.8,side:THREE.DoubleSide});
      const circle=new THREE.Mesh(new THREE.RingGeometry(.87,1.0,6),mat);circle.rotation.x=-Math.PI/2;circle.position.set(site.x*CELL,.02,site.z*CELL);this.markers.add(circle);
    }
    for(const node of SCENERY.filter(n=>n.kind==='mineral')){
      const ore=new THREE.Mesh(node.item==='crystal'?new THREE.OctahedronGeometry(.6):new THREE.DodecahedronGeometry(.6,0),new THREE.MeshStandardMaterial({color:ITEMS[node.item].color,emissive:node.item==='crystal'?'#624294':'#000000',emissiveIntensity:.4,roughness:.55}));
      ore.position.set(node.x,.45,node.z);ore.scale.y=node.item==='crystal'?2:1;ore.castShadow=true;ore.userData.resourceId=node.id;this.scene.add(ore);this.sceneryObjects.set(node.id,ore);
    }
    this.instanceAsset('tree',trees,treeNodes);this.instanceAsset('rock',rocks,rockNodes);
    // Hand-built ruined watchtower at the island's far end.
    const stone=new THREE.MeshStandardMaterial({color:'#92957d',roughness:1});
    const ruin=new THREE.InstancedMesh(new THREE.BoxGeometry(.67,.44,.48),stone,72);let stones=0;dummy.scale.setScalar(1);
    for(let layer=0;layer<7;layer++)for(let i=0;i<12;i++){
      if(layer>3&&i>5&&i<10)continue;const a=(i+(layer%2)*.5)/12*Math.PI*2;
      dummy.position.set(Math.sin(a)*1.2,layer*.47+.2,Math.cos(a)*1.2);dummy.rotation.set(0,a,0);dummy.updateMatrix();ruin.setMatrixAt(stones++,dummy.matrix);
    }
    const tower=SCENERY_BY_ID.get('scenery:watchtower')!;
    ruin.count=stones;ruin.castShadow=true;ruin.receiveShadow=true;ruin.position.set(tower.x,0,tower.z);ruin.userData.resourceId=tower.id;this.scene.add(ruin);this.sceneryObjects.set(tower.id,ruin);
    const pathMat=new THREE.MeshStandardMaterial({color:'#aa9f7e',roughness:1});
    const tiles:THREE.BufferGeometry[]=[];
    for(let i=0;i<45;i++){const g=new THREE.CircleGeometry(.28+rng()*.24,6);g.rotateX(-Math.PI/2);g.translate(-14+i*.7,.006,8+Math.sin(i*.4)*.3);tiles.push(g);}
    this.scene.add(new THREE.Mesh(mergeGeometries(tiles),pathMat));tiles.forEach(g=>g.dispose());
  }
  instanceAsset(name:string,matrices:THREE.Matrix4[],nodes:Scenery[]){
    const root=this.assets.get(name)!;root.updateMatrixWorld(true);
    root.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;
      const mesh=new THREE.InstancedMesh(o.geometry,o.material,matrices.length);
      const transforms=matrices.map(m=>m.clone().multiply(o.matrixWorld));
      transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));
      mesh.userData.resourceIds=nodes.map(n=>n.id);
      this.sceneryBatches.push({mesh,nodes,matrices:transforms,visible:nodes.map(()=>true)});
      mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);
    });
  }
  makeGrid(){
    const vertices:number[]=[];
    for(let x=-WORLD_RADIUS.x;x<=WORLD_RADIUS.x;x++)for(let z=-WORLD_RADIUS.z;z<=WORLD_RADIUS.z;z++){
      if(!this.sim.state.openWorld&&!onIsland(x,z))continue;
      const px=x*CELL,pz=z*CELL,h=CELL/2;
      vertices.push(px-h,.018,pz-h,px+h,.018,pz-h,px-h,.018,pz-h,px-h,.018,pz+h);
    }
    const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    this.grid.add(new THREE.LineSegments(geom,new THREE.LineBasicMaterial({color:'#f7ebc8',transparent:true,opacity:.18})));this.grid.visible=false;
  }
  clearGroup(group:THREE.Group,dispose=false){
    for(const obj of [...group.children]){group.remove(obj);if(dispose)obj.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});}
  }
  sync(){
    if(this.revision===this.sim.revision)return;this.revision=this.sim.revision;
    this.syncScenery();
    const ids=new Set(this.sim.state.buildings.map(b=>b.id));
    for(const [id,o] of this.objects)if(!ids.has(id)){disposeConveyor(o);this.scene.remove(o);this.objects.delete(id);this.moving.delete(id);}
    for(const b of this.sim.state.buildings){
      const corner=b.kind==='conveyor'?conveyorCorner(this.sim,b):0;
      const surface=b.kind==='conveyor'?this.beltSurface(b):undefined;
      const old=this.objects.get(b.id);
      if(old&&old.userData.corner===corner&&old.userData.kind===b.kind&&old.userData.level===(b.level||0)&&old.position.x===b.x*CELL&&old.position.z===b.z*CELL&&old.userData.surface===surface?.key&&(!surface||old.userData.dir===b.dir)){old.rotation.y=-b.dir*Math.PI/2;continue;}
      if(old){disposeConveyor(old);this.scene.remove(old);}
      const root=new THREE.Group();const asset=this.clone(corner?'conveyor_corner':b.kind);root.add(asset);root.userData.corner=corner;root.userData.kind=b.kind;
      root.userData.level=b.level||0;root.userData.surface=surface?.key;root.userData.dir=b.dir;
      if(b.level){if(b.kind==='storage')asset.scale.set(1,1+b.level*.22,1);root.add(this.clone(`upgrade-${b.level}`));}
      const height=surface?.center??this.buildingHeight(b.x,b.z);
      const floor=Math.min(...[[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]].map(([dx,dz])=>this.height((b.x+dx)*CELL,(b.z+dz)*CELL)));
      if(!surface&&height-floor>.08){const footing=new THREE.Mesh(this.foundationGeometry,this.foundationMaterial);footing.name='foundation_body';footing.scale.set(CELL,height-floor+.08,CELL);footing.position.y=-(height-floor)/2-.04;footing.receiveShadow=true;root.add(footing);}
      // Conveyor asset is authored along Blender Y, exported along runtime Z.
      if(isBelt(b.kind))asset.rotation.y=Math.PI/2;
      if(corner===-1)asset.scale.x=-1;
      if(surface)conformConveyor(asset,surface,b.dir);
      const bounds=new THREE.Box3().setFromObject(asset);
      root.position.set(b.x*CELL,height,b.z*CELL);root.rotation.y=-b.dir*Math.PI/2;
      root.userData.signalHeight=isBelt(b.kind)?.72:Math.min(3.8,Math.max(1.35,bounds.max.y+.24));
      const parts:THREE.Object3D[]=[];root.traverse(o=>{if(o.name.startsWith('spin_')||o.name==='hammer'){parts.push(o);o.userData.restY=o.position.y;}});
      this.moving.set(b.id,parts);this.objects.set(b.id,root);this.scene.add(root);
    }
    this.batchStaticBuildings();this.shadowDirty=true;
    this.clearGroup(this.wires,true);
    const cables:THREE.BufferGeometry[]=[];
    for(const [a,b] of this.sim.powerEdges){
      const start=powerAnchor(a,(x,z)=>this.buildingHeight(x,z)),end=powerAnchor(b,(x,z)=>this.buildingHeight(x,z));
      const curve=powerCable(start,end,(x,z)=>this.height(x,z));
      cables.push(new THREE.TubeGeometry(curve,24,.035,5,false));
    }
    if(cables.length){
      const mesh=new THREE.Mesh(mergeGeometries(cables),new THREE.MeshBasicMaterial({color:'#39362d'}));
      mesh.name='transmission_cables';this.wires.add(mesh);cables.forEach(g=>g.dispose());
    }
    this.wires.userData.connections=this.sim.powerEdges.length;
  }
  syncScenery(){
    const hidden=new THREE.Matrix4().makeScale(0,0,0);
    for(const batch of this.sceneryBatches){
      let changed=false;
      batch.nodes.forEach((node,i)=>{
        const visible=this.sim.sceneryVisible(node);if(visible===batch.visible[i])return;
        batch.visible[i]=visible;batch.mesh.setMatrixAt(i,visible?batch.matrices[i]:hidden);changed=true;
      });
      if(changed){batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.computeBoundingSphere();this.shadowDirty=true;}
    }
    for(const [id,object] of this.sceneryObjects)object.visible=this.sim.sceneryVisible(SCENERY_BY_ID.get(id)!);
  }
  batchStaticBuildings(){
    // Keep editable building roots and articulated parts, batch their fixed meshes by material.
    // Instancing shares the original GLB geometry; no vertex copies or per-frame rebuilds.
    for(const mesh of [...this.staticBatches.children]){this.staticBatches.remove(mesh);(mesh as THREE.InstancedMesh).dispose();}
    const batches=new Map<string,{source:THREE.Mesh;matrices:THREE.Matrix4[]}>();
    for(const root of this.objects.values()){
      root.updateMatrixWorld(true);
      root.traverse(o=>{
        if(!(o instanceof THREE.Mesh))return;
        // Multi-material GLBs put the body name on a Group around unnamed mesh primitives.
        let body:THREE.Object3D|null=o;
        while(body&&body!==root&&!body.name.includes('_body'))body=body.parent;
        if(!body?.name.includes('_body'))return;
        // Three.js instances do not support reflected matrices; retain mirrored corners as meshes.
        if(o.matrixWorld.determinant()<0){o.visible=true;return;}
        const materialKey=(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.uuid).join(',');
        const key=`${o.geometry.uuid}:${materialKey}`;let batch=batches.get(key);
        if(!batch){batch={source:o,matrices:[]};batches.set(key,batch);}
        batch.matrices.push(o.matrixWorld.clone());o.visible=false;
      });
    }
    for(const {source,matrices} of batches.values()){
      if(matrices.length===1){source.visible=true;continue;}
      const mesh=new THREE.InstancedMesh(source.geometry,source.material,matrices.length);
      matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=true;mesh.receiveShadow=true;
      mesh.computeBoundingSphere();this.staticBatches.add(mesh);
    }
  }
  syncStoppedSignals(){
    const stopped=this.sim.state.buildings.filter(isStopped);
    const key=stopped.map(b=>`${b.id}:${b.status}:${b.power}:${b.x}:${b.z}`).join('|');if(key===this.stoppedSignalKey)return;this.stoppedSignalKey=key;
    const beacon=new THREE.Object3D(),halo=new THREE.Object3D();
    stopped.forEach((b,i)=>{
      const root=this.objects.get(b.id),height=(root?.userData.signalHeight as number|undefined)??(isBelt(b.kind)?.72:2.2);
      const base=root?.position.y??this.buildingHeight(b.x,b.z);
      beacon.position.set(b.x*CELL,base+height,b.z*CELL);beacon.scale.setScalar(isBelt(b.kind)?.9:1);beacon.updateMatrix();
      this.stoppedBeacons.setMatrixAt(i,beacon.matrix);this.stoppedGlows.setMatrixAt(i,beacon.matrix);
      halo.position.set(b.x*CELL,base+.035,b.z*CELL);halo.rotation.x=-Math.PI/2;halo.scale.setScalar(isBelt(b.kind)?.78:1.18);halo.updateMatrix();this.stoppedHalos.setMatrixAt(i,halo.matrix);
    });
    for(const mesh of [this.stoppedBeacons,this.stoppedGlows,this.stoppedHalos]){
      mesh.count=stopped.length;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
    }
  }
  setBuild(kind:Kind|null){
    this.cancelConveyor();
    this.selectedKind=kind;this.mode=kind?'build':'inspect';this.grid.visible=!!kind;
    // Ghost geometry is shared with the asset kit; only its private materials are disposed.
    this.ghost.traverse(o=>{if(o instanceof THREE.Mesh){const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});
    disposeConveyor(this.ghost);this.clearGroup(this.ghost);this.conveyorGhostKey='';
    if(kind){
      const obj=this.clone(kind);obj.traverse(o=>{if(o instanceof THREE.Mesh){o.material=new THREE.MeshBasicMaterial({color:'#d2e3b0',transparent:true,opacity:.55,depthWrite:false});o.castShadow=false;}});
      if(isBelt(kind))obj.rotation.y=Math.PI/2;this.ghost.add(obj);
    }
  }
  refreshConveyorGhost(){
    if(this.selectedKind!=='conveyor')return;
    const tile={...this.hover,dir:this.dir},surface=this.beltSurface(tile),corner=conveyorCorner(this.sim,tile);
    const key=JSON.stringify([tile.x,tile.z,this.dir,corner,surface.key,this.hover.valid]);
    if(key!==this.conveyorGhostKey){
      this.conveyorGhostKey=key;
      this.ghost.traverse(o=>{if(o instanceof THREE.Mesh)(o.material as THREE.Material).dispose();});
      disposeConveyor(this.ghost);this.clearGroup(this.ghost);
      const asset=this.clone(corner?'conveyor_corner':'conveyor');
      asset.traverse(o=>{if(o instanceof THREE.Mesh){o.material=new THREE.MeshBasicMaterial({color:this.hover.valid?'#d6e7a7':'#e2886f',transparent:true,opacity:.55,depthWrite:false});o.castShadow=false;}});
      asset.rotation.y=Math.PI/2;if(corner===-1)asset.scale.x=-1;
      conformConveyor(asset,surface,this.dir);this.ghost.add(asset);
    }
    this.ghost.position.set(tile.x*CELL,surface.center+.02,tile.z*CELL);this.ghost.rotation.y=-this.dir*Math.PI/2;
  }
  cancelConveyor(){
    const pointer=this.conveyorPointer;this.conveyorPointer=undefined;
    this.conveyorPath=[];this.conveyorPlan=undefined;this.conveyorPreviewKey='';
    this.clearGroup(this.conveyorPreview,true);
    if(pointer!==undefined&&this.canvas.hasPointerCapture(pointer))this.canvas.releasePointerCapture(pointer);
  }
  rotateBuild(){
    const b=this.pointerPresent?this.sim.at(this.hover.x,this.hover.z):undefined;
    if(!this.conveyorPath.length&&b?.kind==='conveyor'&&(this.mode==='inspect'||this.selectedKind==='conveyor'))this.onRotate(b.id);
    else this.dir=(this.dir+1)%4;
    this.refreshConveyorPreview();this.onMove();
  }
  refreshConveyorPreview(){
    if(!this.conveyorPath.length)return;
    const key=JSON.stringify([this.conveyorPath,this.dir,this.hover.x,this.hover.z,this.sim.revision,this.sim.state.inventory.log,this.sim.state.player,this.sim.state.owner,this.sim.state.clanMembers]);
    if(key===this.conveyorPreviewKey)return;this.conveyorPreviewKey=key;
    const plan=planConveyors(this.sim,this.conveyorPath,this.dir);
    if(this.conveyorPath.length===MAX_CONVEYOR_TILES&&!sameTile(this.conveyorPath[this.conveyorPath.length-1],this.hover)){
      plan.error='Draw up to 32 tiles at a time. Retrace to shorten this route.';plan.errorIndex=this.conveyorPath.length-1;
    }
    this.conveyorPlan=plan;
    this.clearGroup(this.conveyorPreview,true);
    for(const tile of plan.tiles){
      const index=this.conveyorPath.findIndex(p=>sameTile(p,tile));
      const corner=conveyorCorner(this.sim,tile,this.conveyorPath[index-1]);
      const root=new THREE.Group(),asset=this.clone(corner?'conveyor_corner':'conveyor');
      // Preview geometries are private so clearing the stroke never disposes GLB assets.
      const color=plan.error?'#df856b':'#d6e7a7';
      asset.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry=o.geometry.clone();o.userData.conveyorGeometry=true;o.material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65,depthWrite:false});o.castShadow=false;}});
      asset.rotation.y=Math.PI/2;if(corner===-1)asset.scale.x=-1;
      const surface=this.beltSurface(tile);root.add(asset);
      // Arrows stay legible above both new and existing belt models.
      const arrow=new THREE.Shape();arrow.moveTo(.48,0);arrow.lineTo(.02,.27);arrow.lineTo(.02,.1);arrow.lineTo(-.4,.1);arrow.lineTo(-.4,-.1);arrow.lineTo(.02,-.1);arrow.lineTo(.02,-.27);arrow.closePath();
      const marker=new THREE.Mesh(new THREE.ShapeGeometry(arrow),new THREE.MeshBasicMaterial({color:plan.error?'#702e22':'#344d3c',side:THREE.DoubleSide,depthTest:false,transparent:true}));
      marker.userData.conveyorGeometry=true;
      marker.rotation.x=-Math.PI/2;marker.position.y=.52;
      if(corner){const offset=CELL/2*(1-Math.SQRT1_2);marker.position.x=offset;marker.position.z=corner*offset;marker.rotation.z=corner*Math.PI/4;}
      marker.renderOrder=10;root.add(marker);
      conformConveyor(root,surface,tile.dir);
      root.position.set(tile.x*CELL,surface.center+.06,tile.z*CELL);root.rotation.y=-tile.dir*Math.PI/2;
      this.conveyorPreview.add(root);
    }
    if(plan.errorIndex>=0){
      const tile=this.conveyorPath[plan.errorIndex];
      const geometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL*.94,.1,CELL*.94));
      const marker=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#ff785b',depthTest:false}));
      marker.position.set(tile.x*CELL,this.buildingHeight(tile.x,tile.z)+.6,tile.z*CELL);marker.renderOrder=11;this.conveyorPreview.add(marker);
    }
  }
  highlightBuilding(id:number|null){
    this.clearGroup(this.highlight,true);if(id===null)return;const b=this.sim.state.buildings.find(b=>b.id===id);if(!b)return;
    const geometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(2.05,.03,2.05));
    const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#f3d691'}));line.position.set(b.x*CELL,this.buildingHeight(b.x,b.z)+.05,b.z*CELL);this.highlight.add(line);
  }
  pick(clientX:number,clientY:number){
    const rect=this.canvas.getBoundingClientRect();this.pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.ray.setFromCamera(this.pointer,this.camera);const point=new THREE.Vector3();
    const terrainHit=this.terrain?.surface?this.ray.intersectObject(this.terrain.surface,false)[0]:undefined;
    this.hoverResource=undefined;
    if(this.mode==='inspect'){
      const objects=[...this.sceneryBatches.map(b=>b.mesh),...this.sceneryObjects.values(),...this.terrain?.resourceMeshes||[]].filter(o=>o.visible);
      for(const hit of this.ray.intersectObjects(objects,false)){
        if(terrainHit&&hit.distance>terrainHit.distance+.1)continue;
        const id=hit.object.userData.resourceId??hit.object.userData.resourceIds?.[hit.instanceId!];
        const node=id&&sceneryById(id),site=id&&this.sim.resourceSite(id);
        if(node&&this.sim.sceneryVisible(node)||site&&!this.sim.at(site.x,site.z)&&this.sim.remaining(site)>0){this.hoverResource=id;break;}
      }
    }
    if(this.terrain?.surface){if(!terrainHit)return;point.copy(terrainHit.point);}
    else if(!this.ray.ray.intersectPlane(this.ground,point))return;
    this.hover.x=Math.round(point.x/CELL);this.hover.z=Math.round(point.z/CELL);
    if(this.hoverResource){const node=sceneryById(this.hoverResource),site=this.sim.resourceSite(node?.siteId||this.hoverResource);if(site){this.hover.x=site.x;this.hover.z=site.z;}}
    this.hover.valid=this.selectedKind?!this.sim.placementError(this.selectedKind,this.hover.x,this.hover.z):(this.sim.state.openWorld?traversable(this.hover.x,this.hover.z):onIsland(this.hover.x,this.hover.z));
    this.ghost.position.set(this.hover.x*CELL,this.buildingHeight(this.hover.x,this.hover.z)+.02,this.hover.z*CELL);this.ghost.rotation.y=-this.dir*Math.PI/2;
    this.ghost.traverse(o=>{if(o instanceof THREE.Mesh)(o.material as THREE.MeshBasicMaterial).color.set(this.hover.valid?'#d6e7a7':'#e2886f');});
    this.refreshConveyorGhost();
  }
  bind(){
    window.addEventListener('resize',()=>this.resize());
    this.canvas.addEventListener('pointermove',e=>{
      this.pointerPresent=true;this.pick(e.clientX,e.clientY);
      if(this.conveyorPointer===e.pointerId&&this.mode==='build'&&this.selectedKind==='conveyor'){
        const last=this.conveyorPath[this.conveyorPath.length-1];
        this.conveyorPath=extendConveyorPath(this.conveyorPath,this.hover);
        const end=this.conveyorPath[this.conveyorPath.length-1];
        if(!sameTile(last,end)&&this.conveyorPath.length>1){
          const existing=this.sim.at(end.x,end.z);
          this.dir=existing?.kind==='conveyor'?existing.dir:directionBetween(this.conveyorPath[this.conveyorPath.length-2],end);
        }
        this.refreshConveyorPreview();
      }
      this.onMove();
    });
    this.canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0||this.conveyorPointer!==undefined)return;this.canvas.focus({preventScroll:true});this.pointerPresent=true;this.pick(e.clientX,e.clientY);
      if(this.mode==='build'&&this.selectedKind==='conveyor'){
        const existing=this.sim.at(this.hover.x,this.hover.z);if(existing?.kind==='conveyor')this.dir=existing.dir;
        this.conveyorPointer=e.pointerId;this.conveyorPath=[{x:this.hover.x,z:this.hover.z}];
        this.canvas.setPointerCapture(e.pointerId);this.refreshConveyorPreview();this.onMove();
      }else this.onAction(this.hover.x,this.hover.z,false);
    });
    this.canvas.addEventListener('pointerup',e=>{
      if(e.pointerId!==this.conveyorPointer||e.button!==0)return;
      const rect=this.canvas.getBoundingClientRect(),inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;
      this.refreshConveyorPreview();const path=this.conveyorPath,dir=this.dir;
      if(inside&&document.elementFromPoint(e.clientX,e.clientY)===this.canvas)this.onConveyors(path,dir);
      this.cancelConveyor();this.onMove();
    });
    this.canvas.addEventListener('pointercancel',()=>{this.cancelConveyor();this.onMove();});
    this.canvas.addEventListener('lostpointercapture',()=>{this.cancelConveyor();this.onMove();});
    this.canvas.addEventListener('pointerleave',()=>{this.pointerPresent=false;this.hoverResource=undefined;this.onMove();});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.targetZoom=THREE.MathUtils.clamp(this.targetZoom+e.deltaY*.015,15,47);},{passive:false});
    window.addEventListener('keydown',e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||(e.target instanceof HTMLElement&&e.target.closest('dialog,button,a,input,select,textarea,summary,[contenteditable="true"],[role="tab"]')))return;this.keys.add(e.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>{this.keys.clear();this.cancelConveyor();this.onMove();});
  }
  resize(){
    const w=innerWidth,h=innerHeight;this.renderer.setSize(w,h);
    this.camera.left=-this.zoom*w/h/2;this.camera.right=this.zoom*w/h/2;this.camera.top=this.zoom/2;this.camera.bottom=-this.zoom/2;this.camera.near=.1;this.camera.far=250;this.camera.updateProjectionMatrix();
  }
  walk(dt:number,enabled:boolean){
    enabled=enabled&&this.sim.state.combat?.health!==0;
    let dx=0,dz=0;
    if(enabled){dx=this.touchMove.x;dz=this.touchMove.z;if(this.keys.has('KeyW')||this.keys.has('ArrowUp'))dz--;if(this.keys.has('KeyS')||this.keys.has('ArrowDown'))dz++;if(this.keys.has('KeyA')||this.keys.has('ArrowLeft'))dx--;if(this.keys.has('KeyD')||this.keys.has('ArrowRight'))dx++;}
    const walking=!!(dx||dz);this.lastWalking=walking;
    if(walking){
      const len=Math.max(1,Math.hypot(dx,dz));dx/=len;dz/=len;
      const c=Math.cos(this.azimuth),s=Math.sin(this.azimuth),vx=dx*c+dz*s,vz=-dx*s+dz*c;
      const speed=this.touchMove.run||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?8:4.8;
      this.sim.movePlayer(vx*speed*dt,vz*speed*dt);
      // The exported engineer model faces +Z.
      const angle=Math.atan2(vx,vz);this.player.rotation.y=angle;
    }
    const bounce=this.character?.animate(this.elapsed,walking)??0;
    this.player.position.set(this.sim.state.player.x,this.footHeight(this.sim.state.player.x,this.sim.state.player.z)+bounce,this.sim.state.player.z);
  }
  render(dt:number,enabled:boolean){
    this.elapsed+=dt;this.sync();this.syncStoppedSignals();this.walk(dt,enabled);
    if(this.terrain){
      const p=this.sim.state.player,oldKey=this.terrain.key;this.terrain.update(p.x,p.z,this.bases,this.ownId);if(oldKey!==this.terrain.key)this.shadowDirty=true;
      this.grid.position.set(Math.round(p.x/CELL)*CELL,0,Math.round(p.z/CELL)*CELL);
      const gridCell=`${this.grid.position.x},${this.grid.position.z}`;
      if(this.grid.visible&&gridCell!==this.gridCell){this.gridCell=gridCell;const geometry=(this.grid.children[0] as THREE.LineSegments).geometry,positions=geometry.getAttribute('position');for(let i=0;i<positions.count;i++)positions.setY(i,this.height(positions.getX(i)+this.grid.position.x,positions.getZ(i)+this.grid.position.z)+.035);positions.needsUpdate=true;geometry.computeBoundingSphere();}
      this.sun.position.set(p.x-22,this.player.position.y+35,p.z+18);this.sun.target.position.set(p.x,this.player.position.y,p.z);
    }
    this.gathering?.update(enabled?dt:0,this.lastWalking);
    const oldZoom=this.zoom;
    this.zoom=Math.abs(this.zoom-this.targetZoom)<.001?this.targetZoom:THREE.MathUtils.damp(this.zoom,this.targetZoom,7,dt);this.azimuth=THREE.MathUtils.damp(this.azimuth,this.targetAzimuth,8,dt);
    if(oldZoom!==this.zoom)this.resizeCamera();
    const desired=this.desiredTarget.set(this.sim.state.player.x,this.height(this.sim.state.player.x,this.sim.state.player.z),this.sim.state.player.z-1.7);
    this.target.lerp(desired,1-Math.exp(-2.5*dt));
    this.camera.position.copy(this.target).add(this.cameraOffset.set(Math.sin(this.azimuth)*38,47,Math.cos(this.azimuth)*38));this.camera.lookAt(this.target);
    const highlightPower=this.showPower||this.selectedKind==='post'||!!(this.selectedKind&&DEFS[this.selectedKind].generation);
    for(const cable of this.wires.children)(cable as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>).material.color.set(highlightPower?'#edc66e':'#39362d');
    this.renderCrew(dt);
    this.onRender(dt);
    this.refreshConveyorPreview();
    if(this.pointerPresent&&!this.conveyorPath.length)this.refreshConveyorGhost();
    this.ghost.visible=!!this.selectedKind&&this.pointerPresent&&!this.conveyorPath.length&&!(this.selectedKind==='conveyor'&&this.sim.at(this.hover.x,this.hover.z));this.ghost.rotation.y=-this.dir*Math.PI/2;this.markers.visible=true;
    const present=new Set<number>();
    for(const b of this.sim.state.buildings){
      const active=(b.active&&b.power>0)||this.sim.generation(b)>0||(isBelt(b.kind)&&!!b.item);
      for(const part of this.moving.get(b.id)||[]){
        if(part.name==='hammer'){part.position.y=(part.userData.restY as number)+(active?Math.sin(this.sim.state.time*5)*.17:0);}
        else if(active){const angle=this.sim.state.time*(part.name==='spin_sails'?.5:2.7);
          if(part.name==='spin_drill'||part.name==='spin_assembly'||part.name==='spin_junction')part.rotation.y=angle;
          else part.rotation.z=angle;
        }
      }
      if(!b.item)continue;present.add(b.id);
      let mesh=this.itemMeshes.get(b.id);if(!mesh){mesh=new THREE.Mesh(this.itemGeometry,this.itemMaterials[b.item]);mesh.castShadow=true;this.itemMeshes.set(b.id,mesh);this.items.add(mesh);}
      mesh.material=this.itemMaterials[b.item];
      const side=b.from===undefined?undefined:(b.from+2)%4;
      const corner=side===undefined?(this.objects.get(b.id)?.userData.corner||0):side===(b.dir+1)%4?1:side===(b.dir+3)%4?-1:0;
      const position=conveyorItemPosition(b.dir,corner,b.travel);
      const height=b.kind==='conveyor'?conveyorSurfaceHeight(this.beltSurface(b),position.x/CELL,position.z/CELL):this.buildingHeight(b.x,b.z);
      mesh.position.set(b.x*CELL+position.x,height+.49,b.z*CELL+position.z);
      mesh.rotation.y=-b.dir*Math.PI/2;
    }
    for(const [id,m] of this.itemMeshes)if(!present.has(id)){this.items.remove(m);this.itemMeshes.delete(id);}
    this.updateSmoke();
    this.shadowClock+=dt;
    const shadowChanged=this.sim.state.time!==this.lastShadowSimulation||this.lastWalking||this.gathering?.active;
    if(this.shadowDirty||(shadowChanged&&this.shadowClock>=1/GRAPHICS_PRESETS[this.graphics.quality].shadowHz)){
      this.renderer.shadowMap.needsUpdate=true;this.shadowClock=0;this.lastShadowSimulation=this.sim.state.time;this.shadowDirty=false;
    }
    this.renderer.render(this.scene,this.camera);
  }
  resizeCamera(){const aspect=innerWidth/innerHeight;this.camera.left=-this.zoom*aspect/2;this.camera.right=this.zoom*aspect/2;this.camera.top=this.zoom/2;this.camera.bottom=-this.zoom/2;this.camera.updateProjectionMatrix();}
  renderCrew(dt:number){
    const nearby=this.crew.filter(p=>Math.hypot(p.x-this.sim.state.player.x,p.z-this.sim.state.player.z)<200);
    const ids=new Set(nearby.map(p=>p.id));
    for(const [id,root] of this.crewObjects)if(!ids.has(id)){
      this.crewGathering.get(id)?.dispose();this.crewGathering.delete(id);this.scene.remove(root);this.crewObjects.delete(id);
      this.crewCharacters.get(id)?.dispose();this.crewCharacters.delete(id);this.shadowDirty=true;
    }
    for(const p of nearby){
      let root=this.crewObjects.get(p.id);
      if(!root){
        root=new THREE.Group();const character=new Character(this.assets.get('engineer')!);root.add(character.root);this.crewCharacters.set(p.id,character);root.scale.setScalar(1.13);root.position.set(p.x,this.footHeight(p.x,p.z),p.z);
        this.crewGathering.set(p.id,new GatheringAnimation(root,this.scene,(x,z)=>this.height(x,z)));
        this.crewObjects.set(p.id,root);this.scene.add(root);
      }
      if(this.crewCharacters.get(p.id)?.apply(p.appearance))this.shadowDirty=true;
      const dx=p.x-root.position.x,dz=p.z-root.position.z,walking=Math.hypot(dx,dz)>.1;
      if(Math.hypot(dx,dz)>.03)root.rotation.y=Math.atan2(dx,dz);
      const blend=1-Math.exp(-12*dt);root.position.x+=dx*blend;root.position.z+=dz*blend;
      const bounce=this.crewCharacters.get(p.id)?.animate(this.elapsed,walking)??0;
      root.position.y=this.footHeight(root.position.x,root.position.z)+bounce;
      this.crewGathering.get(p.id)?.update(dt,walking);
    }
  }
  updateSmoke(){
    const furnaces=this.sim.state.buildings.filter(b=>(b.kind==='furnace'&&b.active&&b.power>0)||(b.kind==='steam'&&this.sim.generation(b)>0));
    const needed=furnaces.length*4;
    while(this.smoke.length<needed){const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.3,1),new THREE.MeshBasicMaterial({color:'#d3d2bf',transparent:true,opacity:.25,depthWrite:false}));this.smoke.push(mesh);this.particles.add(mesh);}
    this.smoke.forEach((m,i)=>{
      m.visible=i<needed;if(!m.visible)return;const b=furnaces[Math.floor(i/4)];const phase=(this.sim.state.time*.27+(i%4)*.25)%1;
      const coal=b.kind==='steam',angle=b.dir*Math.PI/2,dx=coal?.66:0,dz=coal?-.52:.14;
      m.position.set(b.x*CELL+dx*Math.cos(angle)-dz*Math.sin(angle)+phase*.75,this.buildingHeight(b.x,b.z)+(coal?3.25:2.4)+phase*2,b.z*CELL+dx*Math.sin(angle)+dz*Math.cos(angle)+phase*.4);m.scale.setScalar(.6+phase*1.7);
      const material=m.material as THREE.MeshBasicMaterial;material.color.set(coal?'#787b70':'#d3d2bf');material.opacity=(1-phase)*(coal?.34:.22);
    });
  }
  project(x:number,z:number,height=.3){const p=new THREE.Vector3(x,this.height(x,z)+height,z).project(this.camera);return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2,visible:p.z>=-1&&p.z<=1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1};}
}
