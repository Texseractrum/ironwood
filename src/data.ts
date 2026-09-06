export type Item = 'log' | 'ore' | 'plank' | 'ingot' | 'gear' | 'mechanism' | 'coal' | 'copper' | 'crystal' | 'steel' | 'circuit' | 'pickaxe' | 'stone' | 'glass' | 'alloy' | 'core' | 'club' | 'sword' | 'spear';
export type Stock = Partial<Record<Item, number>>;
export type Kind = 'lumber' | 'mine' | 'quarry' | 'sawmill' | 'furnace' | 'press' | 'assembler' | 'conveyor' | 'splitter' | 'merger' | 'storage' | 'windmill' | 'post' | 'steam' | 'resonator' | 'depot' | 'foundry' | 'kiln' | 'etcher' | 'forge' | 'artificer';
export type Category = 'Production' | 'Logistics' | 'Power';
export interface Definition {
  name: string; subtitle: string; category: Category; icon: string; cost: Stock;
  power: number; duration?: number; input?: Stock; output?: Stock; unlock: number; generation?:number; fuel?:Item; burnTime?:number;
}
export const CELL = 2.3;
export const WINDMILL_SPACING = 4;
export const POWER_LINK_RANGE = 5;
export const POWER_LOAD_RANGE = 4.6;
export const DIRECTIONS = [{x:1,z:0},{x:0,z:1},{x:-1,z:0},{x:0,z:-1}];
export const ITEMS: Record<Item,{name:string; color:string; icon:string}> = {
  log:{name:'Timber',color:'#ba8e54',icon:'Logs'}, ore:{name:'Iron ore',color:'#909b94',icon:'Mountain'},
  plank:{name:'Planks',color:'#dfb775',icon:'PanelsTopLeft'}, ingot:{name:'Iron ingots',color:'#c4cfc7',icon:'BrickWall'},
  gear:{name:'Gears',color:'#d9b261',icon:'Cog'}, mechanism:{name:'Mechanisms',color:'#9cbba0',icon:'Component'},
  coal:{name:'Coal',color:'#646576',icon:'Flame'}, copper:{name:'Copper',color:'#d68e63',icon:'Hexagon'},
  crystal:{name:'Aether crystal',color:'#a28ade',icon:'Gem'}, steel:{name:'Steel',color:'#a9c5d2',icon:'Anvil'},
  circuit:{name:'Aether circuits',color:'#83c8b5',icon:'CircuitBoard'}, pickaxe:{name:'Steel pickaxe',color:'#cad8e3',icon:'Pickaxe'},
  stone:{name:'Stone',color:'#a7aa97',icon:'Mountain'},
  glass:{name:'Crystal glass',color:'#a8d8d4',icon:'Hexagon'},
  alloy:{name:'Auric alloy',color:'#e0ba6c',icon:'Anvil'},
  core:{name:'Aether cores',color:'#c2a4ec',icon:'Gem'},
  club:{name:'Timber club',color:'#ba8e54',icon:'Hammer'},
  sword:{name:'Iron sword',color:'#c4cfc7',icon:'Swords'},
  spear:{name:'Steel spear',color:'#a9c5d2',icon:'Swords'}
};
export const DEFS: Record<Kind,Definition> = {
  lumber:{name:'Lumber camp',subtitle:'The beginning of a good idea.',category:'Production',icon:'Trees',cost:{log:12},power:2,duration:2,output:{log:1},unlock:0},
  mine:{name:'Iron mine',subtitle:'Unearth a little potential.',category:'Production',icon:'Pickaxe',cost:{log:14,ore:4},power:3,duration:2,output:{ore:1},unlock:0},
  quarry:{name:'Mineral drill',subtitle:'Bring the frontier into your factory.',category:'Production',icon:'Pickaxe',cost:{plank:10,ingot:8,copper:5},power:6,duration:3,output:{coal:1},unlock:0},
  sawmill:{name:'Sawmill',subtitle:'Rough timber. Refined possibilities.',category:'Production',icon:'Saw',cost:{log:12,ore:5},power:3,duration:4,input:{log:1},output:{plank:2},unlock:0},
  furnace:{name:'Stone furnace',subtitle:'Where earth becomes industry.',category:'Production',icon:'Flame',cost:{log:10,ore:10},power:4,duration:4,input:{ore:2},output:{ingot:1},unlock:0},
  press:{name:'Gear press',subtitle:'Set something in motion.',category:'Production',icon:'Cog',cost:{plank:8,ingot:6},power:4,duration:6,input:{ingot:1},output:{gear:1},unlock:1},
  assembler:{name:'Assembly bench',subtitle:'Bring all the pieces together.',category:'Production',icon:'Hammer',cost:{plank:12,ingot:8},power:6,duration:6,input:{plank:2,gear:1},output:{mechanism:1},unlock:2},
  conveyor:{name:'Conveyor',subtitle:'Keep your ideas moving.',category:'Logistics',icon:'MoveRight',cost:{log:1},power:0,unlock:0},
  splitter:{name:'Splitter',subtitle:'One path becomes three.',category:'Logistics',icon:'GitFork',cost:{plank:3,ingot:1},power:0,unlock:0},
  merger:{name:'Merger',subtitle:'Many paths. One purpose.',category:'Logistics',icon:'Merge',cost:{plank:3,ingot:1},power:0,unlock:0},
  storage:{name:'Storage chest',subtitle:'A place for everything.',category:'Logistics',icon:'Package',cost:{log:8},power:0,unlock:0},
  windmill:{name:'Windmill',subtitle:'12 power, no fuel. Leave 4 tiles between windmills.',category:'Power',icon:'Wind',cost:{log:14,plank:4},power:0,generation:12,unlock:0},
  steam:{name:'Coal power plant',subtitle:'72 power. Mines and burns the coal beneath it.',category:'Power',icon:'Flame',cost:{plank:12,ingot:8,copper:6},power:0,generation:72,fuel:'coal',burnTime:20,input:{coal:1},unlock:0},
  resonator:{name:'Aether engine',subtitle:'The heart of the distant mountains.',category:'Power',icon:'Gem',cost:{steel:8,circuit:3,gear:4},power:0,generation:96,fuel:'crystal',burnTime:90,input:{crystal:1},unlock:0},
  post:{name:'Transmission post',subtitle:'Automatic wires carry power up to 5 tiles.',category:'Power',icon:'UtilityPole',cost:{log:3},power:0,unlock:0},
  depot:{name:'Dispatch depot',subtitle:'Your work has somewhere to go.',category:'Logistics',icon:'Flag',cost:{log:12,plank:4},power:0,unlock:2},
  foundry:{name:'Steel foundry',subtitle:'Build something that will last.',category:'Production',icon:'Anvil',cost:{plank:16,ingot:12,copper:6},power:8,duration:6,input:{ingot:2,coal:1},output:{steel:1},unlock:3},
  kiln:{name:'Crystal kiln',subtitle:'Catch the light of the frontier.',category:'Production',icon:'Hexagon',cost:{steel:8,copper:8,plank:12},power:6,duration:5,input:{ore:2,coal:1},output:{glass:2},unlock:4},
  etcher:{name:'Circuit etcher',subtitle:'Give the crystal a purpose.',category:'Production',icon:'CircuitBoard',cost:{steel:10,copper:12,gear:6},power:8,duration:6,input:{copper:3,crystal:1},output:{circuit:1},unlock:4},
  forge:{name:'Alloy forge',subtitle:'Strength, with a touch of gold.',category:'Production',icon:'Anvil',cost:{steel:12,glass:8,gear:8},power:10,duration:8,input:{steel:2,copper:2,coal:1},output:{alloy:2},unlock:5},
  artificer:{name:'Core assembler',subtitle:'A small heart for a great beacon.',category:'Production',icon:'Gem',cost:{alloy:12,circuit:6,glass:10},power:12,duration:10,input:{alloy:2,circuit:2,glass:2,crystal:1},output:{core:1},unlock:6}
};
export const BUILDABLE = Object.keys(DEFS) as Kind[];
export const WORLD_RADIUS={x:24,z:20};
export interface Site {id:string;x:number;z:number;item:Item;name:string;amount:number;tier:number}
export const SITES: Site[] = [
  {id:'home-timber',x:-6,z:2,item:'log',name:'Workshop grove',amount:12000,tier:0},
  {id:'home-iron',x:-6,z:-3,item:'ore',name:'Old iron pit',amount:12000,tier:0},
  {id:'east-iron',x:6,z:-5,item:'ore',name:'Watchtower iron',amount:4000,tier:0},
  {id:'east-timber',x:6,z:5,item:'log',name:'Birch hollow',amount:4000,tier:0},
  {id:'west-timber',x:-9,z:-1,item:'log',name:'Westwood',amount:4000,tier:0},
  {id:'south-iron',x:0,z:7,item:'ore',name:'Riverbed iron',amount:4000,tier:0},
  {id:'coal-west',x:-14,z:5,item:'coal',name:'Cinder ridge',amount:900,tier:0},
  {id:'copper-east',x:13,z:4,item:'copper',name:'Copper hills',amount:700,tier:0},
  {id:'coal-north',x:-9,z:-12,item:'coal',name:'Blackstone seam',amount:800,tier:0},
  {id:'copper-north',x:10,z:-12,item:'copper',name:'Redstone hollow',amount:650,tier:0},
  {id:'crystal-north',x:1,z:-16,item:'crystal',name:'Aether spires',amount:160,tier:1},
  {id:'crystal-west',x:-19,z:-5,item:'crystal',name:'Moonfall cavern',amount:120,tier:1},
  {id:'frontier-timber',x:1,z:15,item:'log',name:'Ancient grove',amount:6000,tier:0}
];
export const CRAFTS = {
  club:{label:'Timber club',cost:{log:6},output:{club:1},note:'18 damage · Short reach · Best owned weapon auto-equips'},
  sword:{label:'Iron sword',cost:{ingot:4,plank:2},output:{sword:1},note:'28 damage · Fast attacks · Best owned weapon auto-equips'},
  spear:{label:'Steel spear',cost:{steel:3,plank:3},output:{spear:1},note:'36 damage · Long reach · Best owned weapon auto-equips'},
  plank:{label:'2 planks',cost:{log:1},output:{plank:2},note:'Building material'},
  ingot:{label:'1 iron ingot',cost:{ore:2},output:{ingot:1},note:'Basic machinery'},
  gear:{label:'1 gear',cost:{ingot:1},output:{gear:1},note:'Mechanical components'},
  steel:{label:'1 steel',cost:{ingot:2,coal:1},output:{steel:1},note:'Strong tools and aether engines'},
  pickaxe:{label:'Steel pickaxe',cost:{steel:3,copper:4,plank:2},output:{pickaxe:1},note:'Unlocks crystal mining for your whole crew'},
  circuit:{label:'1 aether circuit',cost:{copper:3,crystal:1},output:{circuit:1},note:'Craft 3 to build an aether engine'},
  mechanism:{label:'1 mechanism',cost:{plank:2,gear:1},output:{mechanism:1},note:'Handcrafted goods do not count as factory production'},
  glass:{label:'2 crystal glass',cost:{ore:2,coal:1},output:{glass:2},note:'Clear mineral glass for vaults and aether cores'},
  alloy:{label:'2 auric alloy',cost:{steel:2,copper:2,coal:1},output:{alloy:2},note:'Advanced machinery and your largest vault'},
  core:{label:'1 aether core',cost:{alloy:2,circuit:2,glass:2,crystal:1},output:{core:1},note:'Powers the final guild beacon; automate cores for chapter goals'}
} satisfies Record<string,{label:string;cost:Stock;output:Stock;note:string}>;
export type Craft = keyof typeof CRAFTS;
export const total = (s: Stock) => Object.values(s).reduce((a,b)=>a+(b||0),0);
export const entries = (s:Stock) => Object.entries(s) as [Item,number][];
export function addStock(target:Stock, source:Stock, factor=1) { for(const [k,n] of entries(source)) target[k]=(target[k]||0)+n*factor; }
export const canAfford = (stock:Stock,cost:Stock) => entries(cost).every(([k,n])=>(stock[k]||0)>=n);
export const isBelt = (kind:Kind) => ['conveyor','splitter','merger'].includes(kind);
export const onIsland = (x:number,z:number) => (x/WORLD_RADIUS.x)**2+(z/WORLD_RADIUS.z)**2 < 1;
