import bpy
import bmesh
import json
import math
import random
import shutil
from pathlib import Path

from mathutils import Vector

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[2]
TEXTURES = Path(__file__).resolve().parent / "textures"
PUBLIC_MODELS = PROJECT / "public" / "models"
ASSET_MODELS = WORKSPACE / "editor-assets" / "models"
REVIEW = PROJECT / "docs" / "review"
for directory in (PUBLIC_MODELS, ASSET_MODELS, REVIEW):
    directory.mkdir(parents=True, exist_ok=True)

rng = random.Random(20261025)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
root = bpy.data.objects.new("山地阔叶树", None)
scene.collection.objects.link(root)
root["assetId"] = "tree-broad"
root["units"] = "meters"
root["front"] = "Three.js +Z"
root["source"] = "工程自制程序生成 · Blender 5.0"
root["seed"] = 20261025


def material(name, color, roughness):
    def linear(channel):
        value = channel / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    linear_color = tuple(linear(value) for value in color)
    mat.diffuse_color = (*linear_color, 1)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*linear_color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0
    return mat


bark = material("树木 · 灰褐树皮", (103, 82, 60), 0.88)
nodes = bark.node_tree.nodes
links = bark.node_tree.links
bsdf = nodes.get("Principled BSDF")
for suffix, socket, colorspace in (
    ("color", "Base Color", "sRGB"),
    ("roughness", "Roughness", "Non-Color"),
):
    image = bpy.data.images.load(str(TEXTURES / f"tree-bark-{suffix}.png"), check_existing=True)
    image.colorspace_settings.name = colorspace
    image.pack()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.label = "自制树皮贴图"
    links.new(texture.outputs["Color"], bsdf.inputs[socket])
normal_image = bpy.data.images.load(str(TEXTURES / "tree-bark-normal.png"), check_existing=True)
normal_image.colorspace_settings.name = "Non-Color"
normal_image.pack()
normal_texture = nodes.new("ShaderNodeTexImage")
normal_texture.image = normal_image
normal = nodes.new("ShaderNodeNormalMap")
normal.inputs["Strength"].default_value = 0.65
links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])

leaf_materials = [
    material("树叶 · 深橄榄", (50, 70, 36), 0.84),
    material("树叶 · 山地绿", (70, 91, 42), 0.82),
    material("树叶 · 暖绿", (88, 104, 47), 0.8),
    material("树叶 · 新生梢", (106, 118, 56), 0.78),
]

bark_vertices = []
bark_faces = []
bark_face_uvs = []


def add_tube(points, radii, sides=9):
    points = [Vector(point) for point in points]
    base = len(bark_vertices)
    lengths = [0.0]
    for index in range(1, len(points)):
        lengths.append(lengths[-1] + (points[index] - points[index - 1]).length)
    for index, (point, radius) in enumerate(zip(points, radii)):
        tangent = (points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)]).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < 0.92 else Vector((1, 0, 0))
        axis_u = tangent.cross(reference).normalized()
        axis_v = tangent.cross(axis_u).normalized()
        for side in range(sides):
            angle = side / sides * math.tau
            vertex = point + radius * (math.cos(angle) * axis_u + math.sin(angle) * axis_v)
            bark_vertices.append(tuple(vertex))
    for ring in range(len(points) - 1):
        for side in range(sides):
            a = base + ring * sides + side
            b = base + ring * sides + (side + 1) % sides
            c = base + (ring + 1) * sides + (side + 1) % sides
            d = base + (ring + 1) * sides + side
            bark_faces.append((a, b, c, d))
            circumference = math.tau * (radii[ring] + radii[ring + 1]) * 0.5
            u0 = side / sides * circumference / 0.85
            u1 = (side + 1) / sides * circumference / 0.85
            v0 = lengths[ring] / 1.5
            v1 = lengths[ring + 1] / 1.5
            bark_face_uvs.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
    bark_faces.append(tuple(base + side for side in reversed(range(sides))))
    bark_face_uvs.append(tuple((0, 0) for _ in range(sides)))
    end = base + (len(points) - 1) * sides
    bark_faces.append(tuple(end + side for side in range(sides)))
    bark_face_uvs.append(tuple((0, 0) for _ in range(sides)))


# 微弯主干与外露根系，底面稍后统一归零。
trunk_points = []
trunk_radii = []
for index in range(13):
    z = index * 0.51
    trunk_points.append(Vector((0.11 * math.sin(z * 0.85), 0.07 * math.sin(z * 1.2 + 0.4), z)))
    trunk_radii.append(0.43 * (1 - index / 14) ** 1.18 + 0.025)
add_tube(trunk_points, trunk_radii, 13)
for index in range(7):
    angle = index / 7 * math.tau + rng.uniform(-0.2, 0.2)
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    side = Vector((-math.sin(angle), math.cos(angle), 0))
    length = rng.uniform(0.72, 1.05)
    add_tube(
        [
            (0, 0, 0.52),
            direction * 0.28 + Vector((0, 0, 0.25)),
            direction * (length * 0.58) + side * rng.uniform(-0.09, 0.09) + Vector((0, 0, 0.1)),
            direction * (length * 0.84) + Vector((0, 0, 0.052)),
            direction * length + Vector((0, 0, 0.035)),
        ],
        [0.23, 0.19, 0.12, 0.065, 0.026],
        10,
    )

leaf_vertices = []
leaf_faces = []
leaf_material_indices = []


def add_leaf(center, length, width, angle, tilt, material_index):
    direction = Vector((math.cos(angle), math.sin(angle), tilt)).normalized()
    across = Vector((-math.sin(angle), math.cos(angle), rng.uniform(-0.22, 0.22))).normalized()
    normal = direction.cross(across).normalized()
    base = len(leaf_vertices)
    leaf_vertices.extend(
        [
            tuple(center - direction * length * 0.5),
            tuple(center - across * width * 0.5),
            tuple(center + direction * length * 0.5),
            tuple(center + across * width * 0.5),
            tuple(center + normal * width * 0.12),
        ]
    )
    leaf_faces.extend(((base, base + 1, base + 4), (base + 1, base + 2, base + 4), (base + 2, base + 3, base + 4), (base + 3, base, base + 4)))
    leaf_material_indices.extend([material_index] * 4)


def leaf_cluster(center, radii, count):
    center = Vector(center)
    for _ in range(count):
        direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        distance = rng.random() ** (1 / 3)
        offset = Vector((direction.x * radii[0], direction.y * radii[1], direction.z * radii[2])) * distance
        position = center + offset
        material_index = rng.choices((0, 1, 2, 3), weights=(22, 42, 28, 8))[0]
        add_leaf(
            position,
            rng.uniform(0.21, 0.36),
            rng.uniform(0.1, 0.18),
            rng.uniform(0, math.tau),
            rng.uniform(-0.5, 0.65),
            material_index,
        )


# 不规则主枝、二次枝与细枝共同决定树冠空隙，叶片不组成球状外壳。
for index in range(13):
    angle = index * 2.399963 + rng.uniform(-0.22, 0.22)
    start_index = 4 + int(index * 0.58)
    start = trunk_points[min(start_index, 11)]
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    side = Vector((-math.sin(angle), math.cos(angle), 0))
    length = rng.uniform(2.0, 3.05) * (1.0 if index < 9 else 0.82)
    rise = rng.uniform(1.15, 1.85)
    primary = [
        start,
        start + direction * (length * 0.27) + Vector((0, 0, rise * 0.38)),
        start + direction * (length * 0.58) + side * rng.uniform(-0.18, 0.18) + Vector((0, 0, rise * 0.68)),
        start + direction * (length * 0.82) + side * rng.uniform(-0.2, 0.2) + Vector((0, 0, rise * 0.9)),
        start + direction * length + Vector((0, 0, rise)),
    ]
    radius = rng.uniform(0.14, 0.2) * (1 - index * 0.025)
    add_tube(primary, [radius, radius * 0.78, radius * 0.55, radius * 0.32, 0.025], 10)
    leaf_cluster(primary[-1], (0.76, 0.72, 0.58), 58)
    for secondary_index, primary_point in enumerate((2, 3, 4)):
        secondary_angle = angle + (-0.85 if secondary_index == 0 else 0.7 if secondary_index == 1 else rng.uniform(-0.35, 0.35))
        secondary_direction = Vector((math.cos(secondary_angle), math.sin(secondary_angle), 0))
        secondary_length = rng.uniform(0.95, 1.5)
        secondary_rise = rng.uniform(0.42, 0.9)
        secondary_start = primary[primary_point]
        secondary = [
            secondary_start,
            secondary_start + secondary_direction * secondary_length * 0.42 + Vector((0, 0, secondary_rise * 0.35)),
            secondary_start + secondary_direction * secondary_length + Vector((0, 0, secondary_rise)),
        ]
        add_tube(secondary, [radius * 0.43, radius * 0.25, 0.012], 8)
        leaf_cluster(secondary[-1], (0.68, 0.66, 0.54), 46)
        for twig_index in range(2):
            twig_angle = secondary_angle + (-0.85 if twig_index == 0 else 0.85) + rng.uniform(-0.25, 0.25)
            twig_direction = Vector((math.cos(twig_angle), math.sin(twig_angle), 0))
            twig_length = rng.uniform(0.48, 0.88)
            twig_start = secondary[1] if twig_index == 0 else secondary[2]
            twig_end = twig_start + twig_direction * twig_length + Vector((0, 0, rng.uniform(0.2, 0.52)))
            add_tube([twig_start, (twig_start + twig_end) * 0.5 + Vector((0, 0, 0.08)), twig_end], [0.025, 0.015, 0.004], 6)
            leaf_cluster(twig_end, (0.67, 0.64, 0.52), 54)

# 顶部三分叉遮蔽主干端面，形成连续而非截断的树冠。
for index in range(3):
    angle = index / 3 * math.tau + 0.35
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    start = trunk_points[-3]
    end = trunk_points[-1] + direction * rng.uniform(0.65, 1.0) + Vector((0, 0, rng.uniform(0.45, 0.8)))
    add_tube([start, (start + end) * 0.5 + Vector((0, 0, 0.18)), end], [0.075, 0.042, 0.008], 8)
    leaf_cluster(end, (0.9, 0.85, 0.72), 105)
leaf_cluster(trunk_points[-1] + Vector((0, 0, 0.32)), (1.0, 0.95, 0.78), 130)

bark_mesh = bpy.data.meshes.new("树干与枝系")
bark_mesh.from_pydata(bark_vertices, [], bark_faces)
bark_mesh.update()
bark_object = bpy.data.objects.new("树干与枝系 · 灰褐树皮", bark_mesh)
scene.collection.objects.link(bark_object)
bark_object.parent = root
bark_mesh.materials.append(bark)
uv = bark_mesh.uv_layers.new(name="UVMap")
for polygon, coordinates in zip(bark_mesh.polygons, bark_face_uvs):
    for loop_index, coordinate in zip(polygon.loop_indices, coordinates):
        uv.data[loop_index].uv = coordinate
for polygon in bark_mesh.polygons:
    polygon.use_smooth = True

leaf_mesh = bpy.data.meshes.new("立体阔叶")
leaf_mesh.from_pydata(leaf_vertices, [], leaf_faces)
leaf_mesh.update()
leaf_object = bpy.data.objects.new("树冠 · 立体阔叶", leaf_mesh)
scene.collection.objects.link(leaf_object)
leaf_object.parent = root
for mat in leaf_materials:
    leaf_mesh.materials.append(mat)
for polygon, material_index in zip(leaf_mesh.polygons, leaf_material_indices):
    polygon.material_index = material_index

# 所有几何以接触地面的最低点为 Z=0，根对象保持在树干底部。
minimum_z = min(vertex[2] for vertex in bark_vertices)
for mesh in (bark_mesh, leaf_mesh):
    for vertex in mesh.vertices:
        vertex.co.z -= minimum_z
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

bpy.context.view_layer.update()
mesh_objects = (bark_object, leaf_object)
coordinates = [obj.matrix_world @ vertex.co for obj in mesh_objects for vertex in obj.data.vertices]
minimum = Vector(tuple(min(vertex[axis] for vertex in coordinates) for axis in range(3)))
maximum = Vector(tuple(max(vertex[axis] for vertex in coordinates) for axis in range(3)))
triangles = 0
for obj in mesh_objects:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
stats = {
    "name": "山地阔叶树",
    "assetId": "tree-broad",
    "kind": "tree",
    "builtin": "broad",
    "source": "本工程 Blender 自制模型与贴图 · 可自由使用",
    "units": "meters",
    "boundsBlender": {"min": list(minimum), "max": list(maximum)},
    "sizeThreeMeters": [round(maximum.x - minimum.x, 3), round(maximum.z - minimum.z, 3), round(maximum.y - minimum.y, 3)],
    "groundOffset": round(-minimum.z, 3),
    "triangles": triangles,
    "meshCount": len(mesh_objects),
    "leafCount": len(leaf_vertices) // 5,
    "materials": [mat.name for mat in [bark, *leaf_materials]],
    "front": "+Z",
    "generator": "blender/build_tree.py",
    "seed": 20261025,
}
(ASSET_MODELS / "broadleaf-tree.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
print("TREE_ASSET_STATS", json.dumps(stats, ensure_ascii=False), flush=True)

bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / "blender" / "broadleaf-tree.blend"))
output = ASSET_MODELS / "broadleaf-tree.glb"
bpy.ops.export_scene.gltf(
    filepath=str(output),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_image_format="WEBP",
    export_extras=True,
)
# 制作预览副本，不作为编辑器的素材来源。
shutil.copy2(output, PUBLIC_MODELS / "broadleaf-tree.glb")
shutil.copy2(ASSET_MODELS / "broadleaf-tree.json", PUBLIC_MODELS / "broadleaf-tree.json")
print("TREE_EXPORT_COMPLETE", flush=True)

# 独立 Blender 检查环境，不进入 GLB 或可编辑源工程。
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -0.025))
ground = bpy.context.object
ground.name = "仅供渲染的地面"
ground_material = material("渲染地面 · 山地土壤", (92, 104, 72), 0.96)
ground.data.materials.append(ground_material)
world = bpy.data.worlds.new("树木检查天空")
world.use_nodes = True
world.node_tree.nodes.get("Background").inputs["Color"].default_value = (0.48, 0.62, 0.78, 1)
world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0.5
scene.world = world
bpy.ops.object.light_add(type="SUN", location=(8, -10, 16))
sun = bpy.context.object
sun.data.energy = 2.6
sun.rotation_euler = (math.radians(24), math.radians(-28), math.radians(-35))
sun.data.angle = math.radians(7)
bpy.ops.object.light_add(type="AREA", location=(-7, 4, 11))
fill = bpy.context.object
fill.data.energy = 850
fill.data.shape = "DISK"
fill.data.size = 8
fill.rotation_euler = (Vector((0, 0, 4)) - fill.location).to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.camera_add(location=(12, -16, 10))
camera = bpy.context.object
camera.data.lens = 52
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 960
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"
views = [
    ("tree-main.png", (12, -16, 10), (0, 0, 4.25), 52),
    ("tree-front.png", (0, -18, 6.2), (0, 0, 4.2), 55),
    ("tree-rear.png", (-12, 15, 9), (0, 0, 4.3), 52),
    ("tree-crown.png", (6.8, -8.5, 8.5), (0.4, 0, 6.25), 62),
    ("tree-base.png", (4.8, -6.5, 3.0), (0, 0, 1.2), 62),
]
for filename, position, target, lens in views:
    camera.location = position
    camera.data.lens = lens
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(REVIEW / filename)
    bpy.ops.render.render(write_still=True)
print("TREE_BUILD_COMPLETE", flush=True)
