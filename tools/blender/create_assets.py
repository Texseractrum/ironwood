"""Ironwood's original asset kit. Execute through Blender MCP, one phase at a time.

exec(compile(open(path).read(), path, 'exec')); make_assets('machines')
No existing scene data is removed. Exports use a dedicated Ironwood scene.
"""
import bpy, math, random, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'public/assets/models')
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(ROOT, 'art'), exist_ok=True)
SCENE = bpy.data.scenes.get('Ironwood Assets') or bpy.data.scenes.new('Ironwood Assets')
bpy.context.window.scene = SCENE
M = {}

def material(name, color, rough=0.8, metal=0, emission=0):
    color=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in color)
    mat = bpy.data.materials.get('IW_' + name) or bpy.data.materials.new('IW_' + name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if emission:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
    M[name] = mat
    return mat

for args in [
    ('wood',(0.27,0.13,0.058)), ('woodlight',(0.49,0.29,0.12)),
    ('endgrain',(0.66,0.45,0.22)), ('iron',(0.105,0.13,0.12),0.5,0.65),
    ('brass',(0.64,0.39,0.13),0.48,0.6), ('stone',(0.42,0.43,0.36)),
    ('stoneLight',(0.63,0.60,0.48)), ('roof',(0.16,0.27,0.22)),
    ('cloth',(0.85,0.78,0.56)), ('leaf',(0.23,0.34,0.16)),
    ('leafLight',(0.38,0.47,0.23)), ('leafDark',(0.12,0.23,0.14)),
    ('grass',(0.51,0.56,0.36)), ('grassLight',(0.53,0.58,0.38)),
    ('grassDark',(0.49,0.54,0.35)), ('dirt',(0.42,0.32,0.21)),
    ('glow',(1.0,0.32,0.055),0.6,0,2), ('skin',(0.78,0.49,0.28)),
    ('shirt',(0.65,0.69,0.51)), ('red',(0.49,0.20,0.10))
]: material(*args)

current = None

def begin(name):
    global current
    existing = bpy.data.collections.get('IW_' + name)
    if existing:
        # Only the generated collection for this asset is replaced on reruns.
        for o in list(existing.objects): bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(existing)
    current = bpy.data.collections.new('IW_' + name)
    SCENE.collection.children.link(current)
    return current

def finish_obj(o, name, mat, parent=None):
    o.name = name
    for coll in list(o.users_collection): coll.objects.unlink(o)
    current.objects.link(o)
    if mat: o.data.materials.append(M[mat])
    if parent: o.parent = parent
    return o

def box(name, pos, scale, mat='wood', bevel=0.025, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = finish_obj(bpy.context.object,name,mat,parent)
    o.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=o.modifiers.new('Hand softened edges','BEVEL'); mod.width=bevel; mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def cylinder(name,pos,radius,depth,mat='iron',vertices=12,rotation=None,parent=None,radius2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if radius2 is None else radius2,depth=depth,location=pos)
    o=finish_obj(bpy.context.object,name,mat,parent)
    if rotation: o.rotation_euler=rotation
    return o

def beam(name,a,b,width,mat='wood',parent=None):
    a,b=Vector(a),Vector(b)
    o=box(name,(a+b)/2,(width,width,(b-a).length),mat,parent=parent)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return o

def pivot(name,pos):
    o=bpy.data.objects.new(name,None); current.objects.link(o); o.location=pos; return o

def gear(name,pos,radius=0.35,axis='Y',mat='iron'):
    p=pivot(name,pos)
    rot=(math.pi/2,0,0) if axis=='Y' else (0,0,0)
    cylinder('Hub',(0,0,0),radius*0.76,0.12,mat,16,rot,p)
    for i in range(12):
        a=i*math.tau/12
        loc=(math.sin(a)*radius,0,math.cos(a)*radius) if axis=='Y' else (math.sin(a)*radius,math.cos(a)*radius,0)
        t=box('Gear tooth',loc,(radius*.34,.17,radius*.32),mat,.015,p)
        if axis=='Y': t.rotation_euler.y=a
        else: t.rotation_euler.x=math.pi/2; t.rotation_euler.z=-a
    cylinder('Brass bearing',(0,-.10,0),radius*.23,.1,'brass',12,(math.pi/2,0,0),p)
    return p

def base():
    box('Stone footing',(0,0,.08),(1.84,1.84,.16),'stone')
    for y in [-.62,.62]: box('Foundation rail',(0,y,.21),(1.8,.14,.16))
    for x in [-.64,0,.64]: box('Deck plank',(x,0,.3),(.59,1.7,.14),'woodlight')
    for x in [-.73,.73]:
        for y in [-.72,.72]: box('Iron corner',(x,y,.35),(.17,.19,.09),'iron',.01)

def export(name):
    # Merge static geometry into a single multi-material mesh; retain articulated parts.
    for parent in [o for o in current.objects if o.type=='EMPTY']:
        children=[o for o in current.objects if o.parent==parent and o.type=='MESH']
        if len(children)>1:
            bpy.ops.object.select_all(action='DESELECT')
            for child in children: child.select_set(True)
            bpy.context.view_layer.objects.active=children[0]
            bpy.ops.object.join()
    statics=[o for o in current.objects if o.type=='MESH' and o.parent is None]
    bpy.ops.object.select_all(action='DESELECT')
    if statics:
        for o in statics: o.select_set(True)
        bpy.context.view_layer.objects.active=statics[0]
        bpy.ops.object.join(); statics[0].name=name+'_body'
    bpy.ops.object.select_all(action='DESELECT')
    for o in current.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=True,export_extras=True)
    print('EXPORTED',name)

def sawmill():
    begin('sawmill'); base()
    for x in [-.65,.65]: box('Saw table leg',(x,0,.65),(.17,1.25,.65))
    box('Saw table',(0,0,1.0),(1.65,1.5,.12),'woodlight')
    gear('spin_saw',(0,0,1.2),.55,'Y','iron')
    for x in [-.5,.5]: cylinder('Timber',(x,0,1.16),.14,1.8,'woodlight',10,(math.pi/2,0,0))
    box('Drive housing',(.65,.5,.8),(.34,.45,.65),'roof')
    gear('spin_drive',(.7,-.4,.62),.24)
    export('sawmill')

def mine():
    begin('mine'); base()
    for x in [-.65,.65]:
        beam('A frame',(x,-.6,.35),(x,.05,2.1),.18)
        beam('A frame',(x,.6,.35),(x,.05,2.1),.18)
        box('Iron binding',(x,.05,1.96),(.24,.27,.18),'iron')
    beam('Crane crossbar',(-.87,.05,2.1),(.87,.05,2.1),.23)
    cylinder('Drill axle',(0,0,1.1),.065,1.7,'iron')
    p=pivot('spin_drill',(0,0,.55))
    for i in range(5): cylinder('Drill cone',(0,0,i*.11),.28-i*.025,.18,'iron',8,parent=p,radius2=.07)
    gear('spin_winch',(.7,-.3,1.1),.44)
    for i in range(5): box('Ore chunk',(-.5+i*.22,-.62,.52),(.19,.23,.22),'stone')
    export('mine')

def furnace():
    begin('furnace'); base()
    cylinder('Firebox',(0,0,.82),.7,1.05,'stone',8)
    for z in [.43,.82,1.21]:
        for i in range(8):
            a=i*math.tau/8+(0.2 if z==.82 else 0)
            b=box('Masonry',(math.sin(a)*.61,math.cos(a)*.61,z),(.49,.23,.34),'stoneLight')
            b.rotation_euler.z=-a
    box('Furnace mouth',(0,-.69,.74),(.7,.08,.65),'iron')
    box('Fire',(0,-.741,.68),(.47,.02,.36),'glow',0)
    for x in [-.19,0,.19]: box('Grate',(x,-.77,.7),(.04,.055,.43),'iron',0)
    cylinder('Chimney',(0,.14,1.8),.3,1.1,'stone',8)
    cylinder('Chimney cap',(0,.14,2.38),.37,.13,'iron',8)
    box('Bellows',(.69,0,.7),(.4,.63,.34),'woodlight')
    export('furnace')

def press():
    begin('press'); base()
    for x in [-.63,.63]: box('Press upright',(x,0,1.01),(.23,.36,1.4))
    box('Cross head',(0,0,1.72),(1.62,.46,.27))
    for x in [-.62,.62]: box('Iron collar',(x,0,1.5),(.29,.41,.16),'iron')
    p=pivot('hammer', (0,0,1.1)); box('Hammer head',(0,0,0),(.65,.55,.38),'iron',parent=p)
    box('Anvil',(0,0,.5),(.84,.64,.25),'iron')
    gear('spin_flywheel',(.69,-.32,1.16),.52,'Y','brass')
    export('press')

def assembler():
    begin('assembler'); base()
    for x in [-.72,.72]:
        for y in [-.67,.67]: box('Workshop column',(x,y,.95),(.13,.13,1.35))
    for x in [-.45,.45]:
        roof=box('Canvas awning',(x,0,1.82),(.99,1.95,.13),'roof'); roof.rotation_euler.y=.28 if x>0 else -.28
    box('Ridge',(0,0,1.96),(.13,2.07,.12),'woodlight')
    box('Work surface',(0,0,.85),(1.6,1.5,.15),'woodlight')
    gear('spin_assembly',(.25,-.22,1.03),.3,'Z','brass')
    box('Blueprint',(-.45,-.24,.95),(.47,.63,.025),'cloth',0)
    box('Tool cabinet',(0,.57,.64),(1.4,.4,.58),'roof')
    export('assembler')

def lumber():
    begin('lumber'); base()
    for x in [-.62,0,.62]:
        for z in [.5,.79]: cylinder('Stacked log',(x,.1,z),.17,1.6,'woodlight',10,(math.pi/2,0,0))
        cylinder('End grain',(x,-.711,.5),.14,.01,'endgrain',10,(math.pi/2,0,0))
    for x in [-.74,.74]: box('Log rack',(x,0,.71),(.13,1.6,.75))
    beam('Crane',(-.65,.55,.35),(-.65,.55,1.8),.16)
    beam('Arm',(-.65,.55,1.8),(.55,.55,1.8),.16)
    gear('spin_lumber',(-.65,-.35,1.1),.26)
    export('lumber')

def windmill():
    begin('windmill'); base()
    cylinder('Tower',(0,0,1.25),.65,2,'stoneLight',8,radius2=.38)
    cylinder('Roof',(0,0,2.54),.68,.78,'roof',8,radius2=0)
    for z in [.48,1.15,1.88]: cylinder('Iron hoop',(0,0,z),.67-(z-.3)*.13,.08,'iron',8)
    p=pivot('spin_sails',(0,-.54,2.2))
    cylinder('Wind axle',(0,0,0),.17,.4,'brass',12,(math.pi/2,0,0),p)
    for i in range(4):
        a=i*math.pi/2+.25
        beam('Sail spar',(0,0,0),(math.sin(a)*1.6,0,math.cos(a)*1.6),.09,'woodlight',p)
        panel=box('Linen sail',(math.sin(a)*1.05,-.025,math.cos(a)*1.05),(.43,.055,1.04),'cloth',.01,p)
        panel.rotation_euler.y=a
        for k in [.6,.85,1.1,1.35,1.58]:
            slat=box('Sail rib',(math.sin(a)*k,-.067,math.cos(a)*k),(.48,.03,.025),'wood',0,p); slat.rotation_euler.y=a
    export('windmill')

def storage(depot=False):
    name='depot' if depot else 'storage'; begin(name); base()
    for x in [-.57,0,.57]:
        box('Crate',(x,0,.66),(.53,1.23,.65),'woodlight')
        for y in [-.52,.52]: box('Iron band',(x,y,.69),(.56,.065,.7),'iron',.006)
    if depot:
        for x in [-.77,.77]: box('Depot post',(x,.5,1.18),(.14,.14,1.8))
        box('Dispatch sign',(0,.48,1.8),(1.6,.13,.53),'roof')
        gear('Emblem',(0,.37,1.8),.17,'Y','brass')
        for x in [-.73,.73]: cylinder('Cart wheel',(x,-.6,.4),.35,.13,'wood',12,(math.pi/2,0,0))
    else:
        box('Chest lid',(0,0,1.04),(1.8,1.35,.13),'woodlight')
        box('Latch',(0,-.72,.9),(.2,.08,.2),'brass')
    export(name)

def logistics(kind):
    begin(kind)
    if kind=='post':
        box('Foot',(0,0,.13),(.65,.65,.25),'stone')
        box('Transmission shaft',(0,0,1),(.15,.15,1.9))
        box('Crossbar',(0,0,1.76),(.92,.15,.13),'woodlight')
        for x in [-.34,.34]: cylinder('Coupler',(x,0,1.86),.09,.18,'brass')
    else:
        for x in [-.4,.4]: box('Rail',(x,0,.23),(.09,2.3,.12),'iron',.008)
        for i in range(10): box('Wood slat',(0,-1.04+i*.23,.29),(.78,.19,.09),'woodlight',.009)
        for y in [-.75,.75]: box('Feet',(0,y,.1),(1.1,.12,.2))
        if kind in ['splitter','merger']:
            box('Junction housing',(0,0,.56),(1.35,1.15,.5),'roof')
            gear('spin_junction',(0,0,.87),.25,'Z','brass')
    export(kind)

def engineer():
    begin('engineer')
    for side,x in [('left',-.16),('right',.16)]:
        p=pivot('leg_'+side,(x,0,.44))
        box('Trouser',(0,0,-.14),(.20,.24,.33),'iron',.04,p)
        box('Boot',(0,-.055,-.32),(.24,.34,.16),'wood',.04,p)
    box('Jacket',(0,0,.64),(.56,.33,.48),'shirt',.07)
    box('Apron',(0,-.197,.59),(.39,.04,.39),'woodlight',.025)
    box('Belt',(0,0,.5),(.58,.36,.085),'wood',.015)
    box('Buckle',(0,-.205,.51),(.1,.045,.08),'brass',.01)
    cylinder('Head',(0,0,1.0),.2,.31,'skin',8)
    cylinder('Hat brim',(0,0,1.13),.32,.07,'roof',12)
    cylinder('Hat',(0,0,1.21),.215,.14,'roof',8,radius2=.18)
    box('Backpack',(0,.24,.68),(.4,.23,.43),'wood',.07)
    for side,x in [('left',-.37),('right',.37)]:
        p=pivot('arm_'+side,(x,0,.83))
        box('Sleeve',(0,0,-.16),(.18,.23,.31),'shirt',.045,p)
        box('Hand',(0,0,-.34),(.17,.20,.13),'skin',.04,p)
    export('engineer')

def conveyor_corner():
    begin('conveyor_corner')
    for i in range(11):
        a=-math.pi/2+i*math.pi/20
        plank=box('Corner slat',(-1.15+1.15*math.cos(a),-1.15-1.15*math.sin(a),.29),(.78,.2,.09),'woodlight',.009)
        plank.rotation_euler.z=-a
    for radius in [.71,1.59]:
        for i in range(12):
            a=-math.pi/2+i*math.pi/24; b=a+math.pi/24
            beam('Curved rail',(-1.15+radius*math.cos(a),-1.15-radius*math.sin(a),.23),(-1.15+radius*math.cos(b),-1.15-radius*math.sin(b),.23),.07,'iron')
    for x,y in [(-1.05,0),(0,-1.05)]:box('Corner foot',(x,y,.10),(.18,.18,.2))
    export('conveyor_corner')

def tree():
    begin('tree')
    cylinder('Trunk',(0,0,.74),.13,1.48,'wood',7,radius2=.075)
    for i,(z,r) in enumerate([(1.15,.93),(1.68,.78),(2.15,.58),(2.57,.36)]):
        o=cylinder('Pine boughs',(0,0,z),r,1.1,'leafDark' if i==0 else 'leaf',7,radius2=.035)
        o.rotation_euler.z=i*.39
    export('tree')

def rock():
    begin('rock')
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(0,0,.45))
    o=finish_obj(bpy.context.object,'Weathered rock','stone'); o.scale=(1,.72,.73)
    export('rock')

def island():
    begin('island'); rng=random.Random(87)
    N=64; verts=[(0,0,-.04)]; radii=[1+rng.uniform(-.025,.025) for i in range(N)]
    for ring in range(1,7):
        for i in range(N):
            a=i*math.tau/N; r=radii[i]*ring/6
            verts.append((math.cos(a)*29*r,math.sin(a)*24*r,-.04))
    for i in range(N):
        a=i*math.tau/N; r=radii[i]
        verts.append((math.cos(a)*28*r,math.sin(a)*23*r,-2.1-rng.random()*.7))
    for i in range(N):
        a=i*math.tau/N; r=radii[i]*.91
        verts.append((math.cos(a)*28*r,math.sin(a)*23*r,-3.5-rng.random()*.5))
    faces=[]
    for i in range(N):
        j=(i+1)%N; faces.append((0,i+1,j+1))
    for ring in range(7):
        for i in range(N):
            j=(i+1)%N; a=1+ring*N+i; b=1+ring*N+j; c=b+N; d=a+N
            faces.extend([(a,d,c),(a,c,b)])
    mesh=bpy.data.meshes.new('Island mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new('Island',mesh); current.objects.link(o)
    for m in ['grass','grassLight','grassDark','stone','stoneLight','dirt']: mesh.materials.append(M[m])
    for p in mesh.polygons: p.material_index=0 if p.index<N+N*10 else rng.choice([3,4,5])
    export('island')

def make_assets(phase):
    if phase=='machines':
        for fn in [sawmill,mine,furnace,press,assembler,lumber,windmill]: fn()
    elif phase=='details':
        storage(); storage(True)
        for k in ['conveyor','splitter','merger','post']: logistics(k)
        conveyor_corner(); engineer(); tree(); rock(); island()
    elif phase=='save':
        # Arrange copies into a useful Blender asset-gallery scene for inspection.
        gallery=bpy.data.scenes.get('Ironwood Gallery') or bpy.data.scenes.new('Ironwood Gallery')
        bpy.context.window.scene=gallery
        for o in list(gallery.objects):
            if o.name.startswith('Gallery '): bpy.data.objects.remove(o,do_unlink=True)
        names=['mine','lumber','sawmill','furnace','press','assembler','windmill','storage','depot','conveyor','splitter','merger','post','engineer','tree','rock']
        for i,name in enumerate(names):
            coll=bpy.data.collections.get('IW_'+name)
            if not coll: continue
            obj=bpy.data.objects.new('Gallery '+name,None); obj.instance_type='COLLECTION'; obj.instance_collection=coll
            gallery.collection.objects.link(obj); obj.location=((i%4)*4,(i//4)*4,0)
        cam_data=bpy.data.cameras.get('Ironwood camera') or bpy.data.cameras.new('Ironwood camera')
        cam=bpy.data.objects.new('Gallery camera',cam_data);gallery.collection.objects.link(cam)
        cam.location=(22,-20,24);cam.rotation_euler=(Vector((6,6,0.8))-cam.location).to_track_quat('-Z','Y').to_euler()
        cam_data.type='ORTHO';cam_data.ortho_scale=23;gallery.camera=cam
        for name,loc,energy,size in [('key',(-3,-4,15),1800,10),('fill',(14,8,10),1000,8)]:
            data=bpy.data.lights.new('Ironwood '+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
            lamp=bpy.data.objects.new('Gallery '+name,data);gallery.collection.objects.link(lamp);lamp.location=loc
            lamp.rotation_euler=(Vector((6,6,0))-lamp.location).to_track_quat('-Z','Y').to_euler()
        gallery.render.engine='CYCLES';gallery.cycles.samples=24
        gallery.render.resolution_x=1600;gallery.render.resolution_y=1100;gallery.render.resolution_percentage=100
        gallery.world=bpy.data.worlds.get('Ironwood world') or bpy.data.worlds.new('Ironwood world');gallery.world.color=(.35,.4,.3)
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type=='VIEW_3D':
                    area.spaces.active.shading.color_type='MATERIAL'
                    area.spaces.active.region_3d.view_distance=24
                    area.spaces.active.region_3d.view_location=(6,6,0)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'art/ironwood.blend'))
        print('SAVED ironwood.blend')
    print('PHASE COMPLETE',phase)
