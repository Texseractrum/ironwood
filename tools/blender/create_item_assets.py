"""Build Ironwood item GLBs and transparent, consistently lit inventory portraits.

Run: blender -b --factory-startup --python tools/blender/create_item_assets.py
Sources are vendored in art/item-sources; see its README for provenance.
Only this script's Item Portraits scene is changed; existing artwork is untouched.
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'art/item-sources'
MODELS = ROOT / 'public/assets/models/items'
ICONS = ROOT / 'public/assets/icons/items'
MODELS.mkdir(parents=True, exist_ok=True)
ICONS.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Item Portraits')
bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = scene.render.resolution_y = 192
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.compression = 100
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('Item Portrait Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.72, .79, .88, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65


def material(name, hex_color, metal=0, rough=.65, glow=0):
    rgb = [int(hex_color[i:i+2], 16)/255 for i in (0, 2, 4)]
    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    mat = bpy.data.materials.new('Item ' + name)
    mat.diffuse_color = (*linear, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*linear, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Emission Color'].default_value = (*linear, 1)
    bs.inputs['Emission Strength'].default_value = glow
    return mat


wood = material('oak', '895830')
leather = material('bindings', '42352C')
iron = material('iron', 'B6C5C9', .4, .32)
polished = material('polished iron', 'E5ECE8', .35, .3)
steel = material('steel', '7396B3', .5, .28)
gold = material('brass', 'D8A444', .45, .34)
copper = material('copper', 'D88750', .35, .42)
coal = material('coal', '353A43', .15, .65)
stone = material('stone', '91988B')
ore = material('iron ore', '606E73')
green = material('enamel', '286254', .2)
violet = material('aether', 'A58AE3', .15, .28, .13)
bright = material('aether light', 'DBC8FF', .1, .25, .25)
glass = material('glass', '75BCBF', .2, .2)
glass_edge = material('glass edge', 'D4F5EE', .2, .25)
objects = []


def keep(obj, mat):
    objects.append(obj)
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def box(name, location, scale, mat, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = keep(bpy.context.object, mat)
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    return obj


def cylinder(name, location, radius, depth, mat, vertices=12, top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                  radius2=radius if top is None else top,
                                  depth=depth, location=location)
    obj = keep(bpy.context.object, mat)
    obj.name = name
    return obj


def gem(location, scale, mat=violet):
    x, y, z = location
    verts = [(0, 0, -.6), (0, 0, .85)]
    verts += [(.42*math.cos(i*math.tau/6), .42*math.sin(i*math.tau/6), -.2) for i in range(6)]
    verts += [(.42*math.cos(i*math.tau/6), .42*math.sin(i*math.tau/6), .42) for i in range(6)]
    faces = []
    for i in range(6):
        j = (i+1) % 6
        faces += [(0, 2+j, 2+i), (2+i, 2+j, 8+j, 8+i), (8+i, 8+j, 1)]
    mesh = bpy.data.meshes.new('Hexagonal crystal')
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('Crystal', mesh)
    scene.collection.objects.link(obj)
    obj.location = (x, y, z)
    obj.scale = scale
    return keep(obj, mat)


def import_model(path, size=1, mat=None):
    bpy.ops.import_scene.gltf(filepath=str(path))
    for image in bpy.data.images:
        if image.source == 'FILE' and not image.packed_file and image.filepath:
            if not Path(bpy.path.abspath(image.filepath)).is_file():
                raise FileNotFoundError(f'Missing model texture: {image.filepath}')
    imported = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    # Bake imported node transforms before normalizing the model's size.
    for obj in imported:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
    bpy.context.view_layer.update()
    points = [o.matrix_world @ Vector(v) for o in imported for v in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center, factor = (lo+hi)/2, size/max(hi-lo)
    for obj in imported:
        obj.location = (obj.location-center)*factor
        obj.scale *= factor
        keep(obj, mat)
    return imported


def rotate_all(axis, angle):
    from mathutils import Matrix
    matrix = Matrix.Rotation(angle, 4, axis)
    for obj in objects:
        obj.matrix_world = matrix @ obj.matrix_world
    bpy.context.view_layer.update()


def gear(location=(0, 0, 0), size=1):
    imported = import_model(SOURCES/'quaternius/gear.glb', size, gold)
    for obj in imported:
        obj.location += Vector(location)
    return imported


def ingot(location, mat, width=1.35, depth=.62, height=.34):
    x, y, z = location
    verts = [(sx*width*f/2, sy*depth*f/2, h) for h, f in [(0, 1), (height, .77)]
             for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    mesh = bpy.data.meshes.new('Cast ingot')
    mesh.from_pydata(verts, [], [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                                (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    obj = bpy.data.objects.new('Cast metal bar', mesh)
    scene.collection.objects.link(obj)
    obj.location = (x, y, z)
    keep(obj, mat)
    mod = obj.modifiers.new('Cast edges', 'BEVEL')
    mod.width = .025
    mod.segments = 1
    obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')


def build(item):
    kenney = SOURCES/'kenney'
    if item in ('log', 'plank', 'pickaxe'):
        name = {'log': 'tree-log', 'plank': 'resource-planks', 'pickaxe': 'tool-pickaxe-upgraded'}[item]
        import_model(kenney/(name+'.glb'), 1.6)
    elif item in ('sword', 'spear'):
        imported = import_model(SOURCES/'quaternius'/(item+'.glb'), 2)
        for obj in imported:
            for slot in obj.material_slots:
                name = slot.material.name.split('.')[0]
                replacement = {'Steel': iron, 'LightSteel': polished, 'DarkSteel': gold,
                               'DarkWood': wood, 'LightWood': leather}.get(name)
                if replacement:
                    slot.material = replacement
        if item == 'spear':
            # A stronger shaft and spearhead silhouette at 22–52 CSS pixels.
            from mathutils import Matrix
            for obj in imported:
                obj.matrix_world = Matrix.Diagonal((2.2, 2.2, 1, 1)) @ obj.matrix_world
    elif item == 'gear':
        gear(size=1.5)
    elif item in ('ore', 'stone', 'coal', 'copper'):
        mat = {'ore': ore, 'stone': stone, 'coal': coal, 'copper': copper}[item]
        import_model(kenney/'resource-stone.glb', 1.3, mat)
        if item == 'ore':
            for loc, scale in [((-.2, -.12, .25), (.23, .18, .2)), ((.18, .04, .32), (.3, .16, .15)), ((.35, -.15, .02), (.18, .18, .25))]:
                obj = box('Exposed iron vein', loc, scale, iron)
                obj.rotation_euler = (.2, .35, -.3)
        if item == 'coal':
            rotate_all('Z', .5)
    elif item == 'ingot':
        ingot((0, 0, 0), iron)
        for x in (-.12, 0, .12):
            box('Foundry stamp', (x, 0, .344), (.035, .15, .005), ore, .002)
    elif item == 'steel':
        for y in (-.29, .29):
            ingot((0, y, 0), steel, 1.5, .48, .25)
        box('Steel band', (0, 0, .15), (.16, 1.06, .33), iron, .015)
    elif item == 'alloy':
        for loc in [(0, -.3, 0), (0, .3, 0), (0, 0, .29)]:
            ingot(loc, gold, 1.15, .52, .28)
    elif item == 'mechanism':
        box('Mechanism frame', (0, 0, -.22), (1.38, .92, .22), green)
        gear((-.28, 0, .02), .8)
        gear((.4, 0, .02), .54)
        for x in (-.57, .57):
            for y in (-.32, .32):
                cylinder('Rivet', (x, y, -.08), .055, .07, iron, 8)
    elif item == 'crystal':
        gem((0, .1, .22), (.8, .8, 1.15))
        gem((-.4, -.12, -.05), (.52, .52, .7), bright).rotation_euler[1] = -.28
        gem((.4, 0, -.12), (.45, .45, .6)).rotation_euler[1] = .3
    elif item == 'circuit':
        box('Circuit board', (0, 0, 0), (1.1, .87, .12), green)
        for x in (-.38, .38):
            box('Copper track', (x, 0, .075), (.045, .58, .025), gold, .005)
            for y in (-.26, 0, .26):
                box('Circuit trace', (x*.65, y, .075), (.29, .035, .025), gold, .005)
                cylinder('Terminal', (x, y, .09), .065, .04, copper, 8)
        gem((0, 0, .2), (.45, .45, .35), bright)
        for x in (-.3, -.1, .1, .3):
            box('Connector', (x, -.48, .02), (.085, .15, .09), gold, .006)
    elif item == 'glass':
        for x, y, z in [(-.14, .13, 0), (0, 0, .14), (.14, -.13, .28)]:
            box('Glass pane', (x, y, z), (1.1, .8, .085), glass, .018)
            box('Polished edge', (x, y-.395, z+.01), (1.02, .02, .06), glass_edge, .005)
        for x in (-.14, .14):
            box('Reflected light', (x, -.13, .326), (.035, .46, .008), glass_edge, .002).rotation_euler[2] = -.45
    elif item == 'core':
        gem((0, 0, .05), (.8, .8, 1.1), bright)
        for z in (-.49, .55):
            cylinder('Core end cap', (0, 0, z), .35, .14, gold, 6)
        for angle in (0, math.pi/2):
            bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=4, location=(0, 0, .02), major_radius=.5, minor_radius=.045)
            obj = keep(bpy.context.object, gold)
            obj.name = 'Aether containment ring'
            obj.rotation_euler = (math.pi/2, angle, .3)
    elif item == 'club':
        cylinder('Club grip', (0, 0, -.5), .075, .8, wood, 8, .11)
        cylinder('Club head', (0, 0, .25), .13, .85, wood, 7, .24)
        for z in (-.8, -.68, -.56, -.44):
            cylinder('Leather grip', (0, 0, z), .092, .065, leather, 8)
        cylinder('Iron collar', (0, 0, .45), .22, .12, iron, 7)
    else:
        raise ValueError(item)


camera_data = bpy.data.cameras.new('Item camera')
camera = bpy.data.objects.new('Item camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'

for name, location, energy, size in [('Key', (-3, -4, 7), 450, 4), ('Fill', (4, -1, 3), 220, 3), ('Rim', (1, 4, 5), 350, 3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', size
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()


def portrait(item):
    objects.clear()
    build(item)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(MODELS/(item+'.glb')), export_format='GLB',
                              use_selection=True, use_active_scene=True,
                              export_apply=True, export_animations=False)
    # Portrait-only rotation leaves exported models in their natural orientation.
    if item in ('sword', 'spear', 'pickaxe', 'club'):
        rotate_all('Y', math.radians(35))
        camera.location = (0, -7, 2)
    elif item == 'gear':
        camera.location = (2, -6, 4)
    else:
        camera.location = (3, -5, 3.7)
    camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(v) for obj in objects for v in obj.bound_box]
    inv = camera.matrix_world.inverted()
    projected = [inv @ p for p in points]
    lx, hx = min(p.x for p in projected), max(p.x for p in projected)
    ly, hy = min(p.y for p in projected), max(p.y for p in projected)
    camera_data.ortho_scale = max(hx-lx, hy-ly)*1.18
    camera.location += camera.rotation_euler.to_matrix() @ Vector(((lx+hx)/2, (ly+hy)/2, 0))
    scene.render.filepath = str(ICONS/(item+'.png'))
    bpy.ops.render.render(write_still=True)
    for obj in list(scene.objects):
        if obj.type not in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(obj, do_unlink=True)
    print('ITEM COMPLETE:', item, flush=True)


ITEMS = ['log', 'ore', 'plank', 'ingot', 'gear', 'mechanism', 'coal', 'copper', 'crystal',
         'steel', 'circuit', 'pickaxe', 'stone', 'glass', 'alloy', 'core', 'club', 'sword', 'spear']
if __name__ == '__main__':
    import sys
    requested = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ITEMS
    for item in requested:
        portrait(item)
