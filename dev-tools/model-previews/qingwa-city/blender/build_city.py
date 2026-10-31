import bpy
import bmesh
import math
import json
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

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

root = bpy.data.objects.new("青瓦城池", None)
scene.collection.objects.link(root)
root["assetId"] = "city-jade"
root["units"] = "meters"
root["front"] = "Three.js +Z"
root["source"] = "工程自制程序生成 · Blender 5.0"

groups = {}
for name in ("城墙与城门", "角楼", "城内建筑", "装饰与旗帜"):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = root
    groups[name] = obj

materials = {}


def make_material(name, color, roughness, tile=0, texture=None, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*[c / 255 for c in color], 1)
    mat["tile_meters"] = tile
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*[c / 255 for c in color], 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if texture:
        color_image = bpy.data.images.load(str(TEXTURES / f"{texture}-color.png"), check_existing=True)
        color_image.colorspace_settings.name = "sRGB"
        color_image.pack()
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = color_image
        tex.label = "自制颜色贴图"
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        rough_image = bpy.data.images.load(str(TEXTURES / f"{texture}-roughness.png"), check_existing=True)
        rough_image.colorspace_settings.name = "Non-Color"
        rough_image.pack()
        rough_tex = nodes.new("ShaderNodeTexImage")
        rough_tex.image = rough_image
        links.new(rough_tex.outputs["Color"], bsdf.inputs["Roughness"])
        normal_image = bpy.data.images.load(str(TEXTURES / f"{texture}-normal.png"), check_existing=True)
        normal_image.colorspace_settings.name = "Non-Color"
        normal_image.pack()
        normal_tex = nodes.new("ShaderNodeTexImage")
        normal_tex.image = normal_image
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = 0.55
        links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    materials[name] = mat
    return mat


brick = make_material("城池 · 青砖墙", (154, 148, 133), 0.88, 4, "brick")
stone = make_material("城池 · 深色石基", (116, 111, 99), 0.92, 4, "stone")
roof = make_material("城池 · 青瓦", (65, 70, 69), 0.78, 2, "roof")
wood = make_material("城池 · 木构", (105, 65, 47), 0.68, 2, "wood")
plaster = make_material("城池 · 灰浆墙", (202, 194, 174), 0.9, 3, "plaster")
paving = make_material("城池 · 石板铺地", (135, 128, 109), 0.9, 4, "paving")
fabric = make_material("城池 · 旗帜", (131, 57, 47), 0.86, 1, "fabric")
roof_ridge = make_material("城池 · 瓦脊", (48, 53, 52), 0.8)
metal = make_material("城池 · 门钉金属", (139, 118, 80), 0.42, metallic=0.65)
dark = make_material("城池 · 门窗暗部", (31, 37, 34), 0.86)
door = make_material("城池 · 暗红门扇", (112, 55, 46), 0.62)
# 门扇保留木纹法线，但不使用无法直接导出的颜色混合节点。
normal_image = bpy.data.images.load(str(TEXTURES / "wood-normal.png"), check_existing=True)
normal_image.colorspace_settings.name = "Non-Color"
normal_tex = door.node_tree.nodes.new("ShaderNodeTexImage")
normal_tex.image = normal_image
normal = door.node_tree.nodes.new("ShaderNodeNormalMap")
normal.inputs["Strength"].default_value = 0.35
door.node_tree.links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
door.node_tree.links.new(normal.outputs["Normal"], door.node_tree.nodes.get("Principled BSDF").inputs["Normal"])
door["tile_meters"] = 2


def finish_object(obj, name, mat, group, bevel=0):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    scene.collection.objects.link(obj)
    obj.parent = groups[group]
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("真实边缘倒角", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def cube(name, location, dimensions, mat, group, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_object(obj, name, mat, group, bevel)


def mesh_object(name, vertices, faces, mat, group, bevel=0, authored_uv=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.parent = groups[group]
    if mat:
        mesh.materials.append(mat)
    if authored_uv:
        uv = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                uv.data[loop_index].uv = authored_uv[mesh.loops[loop_index].vertex_index]
        obj["uv_authored"] = True
    if bevel:
        modifier = obj.modifiers.new("边缘倒角", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def tube(name, points, radius, mat, group):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 0
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.parent = groups[group]
    curve.materials.append(mat)
    return obj


def cylinder(name, location, radius, depth, mat, group, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    return finish_object(bpy.context.object, name, mat, group, 0.015)


def beam_between(name, start, end, thickness, mat, group):
    a, b = Vector(start), Vector(end)
    obj = cube(name, (a + b) / 2, (thickness, thickness, (b - a).length), mat, group, 0.012)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return obj


def battlements():
    z = 7.25
    for y in (-21.4, 21.4):
        for i in range(23):
            x = -23.1 + i * 2.1
            cube("城墙垛口", (x, y, z), (1.15, 1.15, 1.15), brick, "城墙与城门", 0.035)
            cube("垛口压顶", (x, y, z + 0.61), (1.25, 1.25, 0.13), stone, "城墙与城门", 0.02)
    for x in (-24.4, 24.4):
        for i in range(19):
            y = -18.9 + i * 2.1
            cube("城墙垛口", (x, y, z), (1.15, 1.15, 1.15), brick, "城墙与城门", 0.035)
            cube("垛口压顶", (x, y, z + 0.61), (1.25, 1.25, 0.13), stone, "城墙与城门", 0.02)


def arch_spandrel():
    radius = 2.8
    spring = 3.25
    top = 6.8
    y_front, y_back = -22.2, -20.6
    segments = 24
    vertices, faces = [], []
    for i in range(segments + 1):
        theta = math.pi * i / segments
        x = radius * math.cos(theta)
        z = spring + radius * math.sin(theta)
        vertices.extend([(x, y_front, z), (x, y_front, top), (x, y_back, z), (x, y_back, top)])
    for i in range(segments):
        a, b = i * 4, (i + 1) * 4
        faces.extend([
            (a, b, b + 1, a + 1),
            (a + 2, a + 3, b + 3, b + 2),
            (a, a + 2, b + 2, b),
            (a + 1, b + 1, b + 3, a + 3),
        ])
    faces.extend([(0, 1, 3, 2), (segments * 4, segments * 4 + 2, segments * 4 + 3, segments * 4 + 1)])
    obj = mesh_object("拱券上方砖墙", vertices, faces, brick, "城墙与城门")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def arch_stones():
    radius, spring = 2.8, 3.25
    for i in range(15):
        a0 = math.pi * i / 15 + 0.012
        a1 = math.pi * (i + 1) / 15 - 0.012
        verts = []
        for y in (-22.32, -21.92):
            for r, theta in ((radius, a0), (radius + 0.48, a0), (radius + 0.48, a1), (radius, a1)):
                verts.append((r * math.cos(theta), y, spring + r * math.sin(theta)))
        mesh_object("拱券楔形石", verts, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], stone, "城墙与城门", 0.018)
    for side in (-1, 1):
        for i in range(5):
            cube("门洞侧石", (side * 3.04, -22.13, 0.95 + i * 0.5), (0.48, 0.4, 0.47), stone, "城墙与城门", 0.018)


def arched_door(side):
    r, spring, bottom = 2.74, 3.22, 0.62
    points = []
    if side < 0:
        points = [(-r, bottom), (0, bottom), (0, spring + r)]
        for i in range(1, 13):
            theta = math.pi / 2 + math.pi / 2 * i / 12
            points.append((r * math.cos(theta), spring + r * math.sin(theta)))
    else:
        points = [(0, bottom), (r, bottom), (r, spring)]
        for i in range(1, 13):
            theta = math.pi / 2 * i / 12
            points.append((r * math.cos(theta), spring + r * math.sin(theta)))
    vertices = []
    for y in (-22.04, -21.84):
        vertices.extend((x, y, z) for x, z in points)
    n = len(points)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    mesh_object("左门扇" if side < 0 else "右门扇", vertices, faces, door, "城墙与城门", 0.015)
    for z in (1.25, 2.35, 3.35):
        cube("门扇横梁", (side * 1.38, -22.10, z), (2.55, 0.16, 0.16), wood, "城墙与城门", 0.015)
    for x in (0.45, 1.1, 1.75, 2.35):
        for z in (1.0, 1.65, 2.3, 2.95, 3.65):
            if z < 3.3 or abs(x) < 2.1:
                bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=0.07, location=(side * x, -22.16, z))
                finish_object(bpy.context.object, "铜门钉", metal, "城墙与城门")


def roof_point(face, u, t, cx, cy, w, d, z, h, ridge_half):
    if face == "front":
        x = u * ((1 - t) * w / 2 + t * ridge_half)
        y = (1 - t) * d / 2
        sign = -1
    elif face == "back":
        x = u * ((1 - t) * w / 2 + t * ridge_half)
        y = -(1 - t) * d / 2
        sign = 1
    elif face == "right":
        x = (1 - t) * w / 2 + t * ridge_half
        y = u * (1 - t) * d / 2
        sign = 1
    else:
        x = -((1 - t) * w / 2 + t * ridge_half)
        y = u * (1 - t) * d / 2
        sign = -1
    lift = 0.20 * ((1 - t) ** 5) * (0.2 + 0.8 * abs(u) ** 4)
    return (cx + x, cy + y, z + h * (t ** 1.5) + lift)


def hip_roof(name, cx, cy, z, w, d, h, group, ridge_ratio=0.42):
    ridge_half = max(0.0, (w - d) * ridge_ratio) if w > d else 0.0
    nu, nt = 12, 5
    for face in ("front", "back", "right", "left"):
        vertices, faces, uvs = [], [], []
        for j in range(nt + 1):
            t = j / nt
            for i in range(nu + 1):
                u = -1 + 2 * i / nu
                vertices.append(roof_point(face, u, t, cx, cy, w, d, z, h, ridge_half))
                edge = w if face in ("front", "back") else d
                slope = math.sqrt(((d if face in ("front", "back") else w) / 2) ** 2 + h ** 2)
                uvs.append(((u + 1) * edge / 4, t * slope / 2))
        for j in range(nt):
            for i in range(nu):
                a = j * (nu + 1) + i
                quad = (a, a + 1, a + nu + 2, a + nu + 1)
                if face in ("back", "left"):
                    quad = tuple(reversed(quad))
                faces.append(quad)
        obj = mesh_object(f"{name} · {face}", vertices, faces, roof, group, authored_uv=uvs)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        solid = obj.modifiers.new("屋檐真实厚度", "SOLIDIFY")
        solid.thickness = 0.14
        solid.offset = -1
        edge_u = [-1 + 2 * i / 12 for i in range(13)]
        tube(f"{name} · 檐口", [roof_point(face, u, 0, cx, cy, w, d, z, h, ridge_half) for u in edge_u], 0.075, roof_ridge, group)
        tile_count = max(5, int((w if face in ("front", "back") else d) / 0.55))
        for i in range(1, tile_count):
            u = -1 + 2 * i / tile_count
            points = [roof_point(face, u, j / 5, cx, cy, w, d, z, h, ridge_half) for j in range(6)]
            points = [(x, y, zz + 0.055) for x, y, zz in points]
            tube(f"{name} · 瓦垄", points, 0.033, roof_ridge, group)
        for u in (-1, 1):
            points = [roof_point(face, u, j / 6, cx, cy, w, d, z, h, ridge_half) for j in range(7)]
            points = [(x, y, zz + 0.1) for x, y, zz in points]
            tube(f"{name} · 垂脊", points, 0.105, roof_ridge, group)
    if ridge_half > 0.05:
        tube(f"{name} · 正脊", [(cx - ridge_half, cy, z + h + 0.13), (cx, cy, z + h + 0.17), (cx + ridge_half, cy, z + h + 0.13)], 0.15, roof_ridge, group)
        for side in (-1, 1):
            tube(f"{name} · 脊端起翘", [(cx + side * (ridge_half - 0.25), cy, z + h + 0.12), (cx + side * (ridge_half + 0.25), cy, z + h + 0.25), (cx + side * (ridge_half + 0.5), cy, z + h + 0.38)], 0.11, roof_ridge, group)
    else:
        cylinder(f"{name} · 宝顶", (cx, cy, z + h + 0.32), 0.18, 0.55, roof_ridge, group, 10)


def bracket_sets(cx, cy, z, w, d, group):
    for y in (cy - d / 2 - 0.12, cy + d / 2 + 0.12):
        count = max(2, int(w / 2.3))
        for i in range(count + 1):
            x = cx - w / 2 + w * i / count
            cube("斗拱下层", (x, y, z), (0.34, 0.5, 0.16), wood, group, 0.015)
            cube("斗拱挑枋", (x, y, z + 0.15), (0.22, 0.82, 0.13), wood, group, 0.015)
            cube("斗拱上层", (x, y, z + 0.28), (0.52, 0.3, 0.12), wood, group, 0.015)
    for x in (cx - w / 2 - 0.12, cx + w / 2 + 0.12):
        count = max(2, int(d / 2.3))
        for i in range(1, count):
            y = cy - d / 2 + d * i / count
            cube("斗拱下层", (x, y, z), (0.5, 0.34, 0.16), wood, group, 0.015)
            cube("斗拱挑枋", (x, y, z + 0.15), (0.82, 0.22, 0.13), wood, group, 0.015)


def lattice_window(cx, cy, z, width, height, group, back=False):
    y = cy + (0.01 if back else -0.01)
    cube("窗洞暗部", (cx, y, z), (width, 0.09, height), dark, group, 0)
    for x in (cx - width / 2, cx + width / 2):
        cube("窗框", (x, y - 0.06 if not back else y + 0.06, z), (0.09, 0.12, height + 0.15), wood, group, 0.01)
    for zz in (z - height / 2, z + height / 2):
        cube("窗框", (cx, y - 0.06 if not back else y + 0.06, zz), (width + 0.12, 0.12, 0.09), wood, group, 0.01)
    for i in range(1, 5):
        x = cx - width / 2 + width * i / 5
        cube("窗棂", (x, y - 0.08 if not back else y + 0.08, z), (0.035, 0.08, height), wood, group, 0.005)
    cube("窗棂横档", (cx, y - 0.08 if not back else y + 0.08, z), (width, 0.08, 0.04), wood, group, 0.005)


def pavilion(name, cx, cy, base, w, d, wall_h, group, enclosed=True, roof_h=1.8):
    cube(f"{name} · 台基", (cx, cy, base + 0.18), (w + 0.7, d + 0.7, 0.36), stone, group, 0.05)
    floor = base + 0.36
    if enclosed:
        cube(f"{name} · 墙身", (cx, cy, floor + wall_h / 2), (w * 0.78, d * 0.76, wall_h), plaster, group, 0.035)
    for x in (cx - w / 2, cx + w / 2):
        for y in (cy - d / 2, cy + d / 2):
            cylinder(f"{name} · 木柱", (x, y, floor + wall_h / 2), 0.14, wall_h, wood, group, 12)
            cube(f"{name} · 柱础", (x, y, floor + 0.1), (0.42, 0.42, 0.2), stone, group, 0.025)
    # 大面宽建筑增加中间柱，避免主殿和门楼只剩四根角柱。
    for y in (cy - d / 2, cy + d / 2):
        count = max(1, round(w / 3.2))
        for i in range(1, count):
            x = cx - w / 2 + w * i / count
            cylinder(f"{name} · 中间木柱", (x, y, floor + wall_h / 2), 0.14, wall_h, wood, group, 12)
            cube(f"{name} · 柱础", (x, y, floor + 0.1), (0.42, 0.42, 0.2), stone, group, 0.025)
    for x in (cx - w / 2, cx + w / 2):
        count = max(1, round(d / 3.2))
        for i in range(1, count):
            y = cy - d / 2 + d * i / count
            cylinder(f"{name} · 中间木柱", (x, y, floor + wall_h / 2), 0.14, wall_h, wood, group, 12)
    for y in (cy - d / 2, cy + d / 2):
        cube(f"{name} · 檐枋", (cx, y, floor + wall_h - 0.12), (w + 0.35, 0.22, 0.28), wood, group, 0.02)
    for x in (cx - w / 2, cx + w / 2):
        cube(f"{name} · 檐枋", (x, cy, floor + wall_h - 0.12), (0.22, d + 0.35, 0.28), wood, group, 0.02)
    if enclosed:
        for x in (cx - w * 0.22, cx + w * 0.22):
            lattice_window(x, cy - d * 0.38 - 0.06, floor + wall_h * 0.55, min(1.25, w * 0.18), min(1.3, wall_h * 0.52), group)
            lattice_window(x, cy + d * 0.38 + 0.06, floor + wall_h * 0.55, min(1.25, w * 0.18), min(1.3, wall_h * 0.52), group, True)
    if name == "城中主殿":
        front_y = cy - d * 0.38 - 0.08
        cube("主殿正门暗部", (cx, front_y, floor + 1.35), (2.5, 0.12, 2.7), dark, group, 0.01)
        for side in (-1, 1):
            cube("主殿门扇", (cx + side * 0.57, front_y - 0.07, floor + 1.28), (1.08, 0.12, 2.5), door, group, 0.015)
            cube("主殿门框", (cx + side * 1.3, front_y - 0.09, floor + 1.4), (0.16, 0.2, 2.8), wood, group, 0.015)
        cube("主殿门楣", (cx, front_y - 0.09, floor + 2.78), (2.75, 0.2, 0.18), wood, group, 0.015)
    bracket_sets(cx, cy, floor + wall_h, w, d, group)
    hip_roof(f"{name} · 屋顶", cx, cy, floor + wall_h + 0.28, w + 1.8, d + 1.8, roof_h, group)


# 城基、铺地和四面墙体。
cube("城池石基", (0, 0, 0.28), (52, 46, 0.56), stone, "城墙与城门", 0.08)
cube("城内铺地", (0, 0, 0.59), (48.8, 42.8, 0.12), paving, "城墙与城门", 0.02)
for x in (-24.4, 24.4):
    cube("侧面砖墙", (x, 0, 3.7), (1.6, 42.8, 6.2), brick, "城墙与城门", 0.045)
    cube("侧面石基", (x, 0, 1.0), (2.0, 43.0, 0.8), stone, "城墙与城门", 0.035)
    cube("侧面墙顶", (x, 0, 6.82), (1.85, 42.8, 0.18), paving, "城墙与城门", 0.02)
cube("背面砖墙", (0, 21.4, 3.7), (48.8, 1.6, 6.2), brick, "城墙与城门", 0.045)
cube("背面石基", (0, 21.4, 1.0), (49.2, 2.0, 0.8), stone, "城墙与城门", 0.035)
cube("背面墙顶", (0, 21.4, 6.82), (48.8, 1.85, 0.18), paving, "城墙与城门", 0.02)
for x in (-13.75, 13.75):
    cube("前门两侧砖墙", (x, -21.4, 3.7), (21.3, 1.6, 6.2), brick, "城墙与城门", 0.045)
    cube("前门石基", (x, -21.4, 1.0), (21.3, 2.0, 0.8), stone, "城墙与城门", 0.035)
cube("前墙墙顶左", (-13.75, -21.4, 6.82), (21.3, 1.85, 0.18), paving, "城墙与城门", 0.02)
cube("前墙墙顶右", (13.75, -21.4, 6.82), (21.3, 1.85, 0.18), paving, "城墙与城门", 0.02)
arch_spandrel()
arch_stones()
arched_door(-1)
arched_door(1)
battlements()

# 城墙外侧马面；城内不再生成登城石阶或其他楼梯状构件。
for x in (-24.95, 24.95):
    for y in (-8.5, 8.5):
        cube("外侧马面", (x, y, 3.25), (1.1, 4.2, 5.3), brick, "城墙与城门", 0.04)
        cube("马面压顶", (x, y, 6.0), (1.3, 4.4, 0.22), stone, "城墙与城门", 0.025)

# 四座低檐角楼，保留参考图中稳重的外轮廓。
for x in (-23.0, 23.0):
    for y in (-20.0, 20.0):
        cube("角楼石座", (x, y, 4.15), (5.4, 5.4, 7.1), brick, "角楼", 0.06)
        cube("角楼基脚", (x, y, 1.0), (5.8, 5.8, 0.8), stone, "角楼", 0.04)
        cube("角楼平台", (x, y, 7.78), (5.9, 5.9, 0.28), stone, "角楼", 0.035)
        pavilion("角楼", x, y, 7.92, 4.2, 4.2, 1.6, "角楼", True, 1.2)

# 单层宽门楼，避免双重檐尖顶压过城墙与主殿。
pavilion("主门楼", 0, -20.65, 6.92, 10.4, 4.8, 2.1, "城墙与城门", True, 1.4)

# 城内仅保留中央主殿；庭院不再放置厢房或其他小建筑。
pavilion("城中主殿", 0, 3.0, 0.66, 17.2, 10.8, 4.0, "城内建筑", True, 2.35)

# 主路、城门与主殿台阶、旗帜。
for i in range(4):
    cube("门前踏步", (0, -22.1 + i * 0.45, 0.18 + i * 0.12), (6.4 - i * 0.25, 0.55, 0.22), stone, "装饰与旗帜", 0.025)
for i in range(5):
    cube("主殿台阶", (0, -5.4 + i * 0.55, 0.18 + i * 0.14), (8.6 - i * 0.18, 0.65, 0.24), stone, "城内建筑", 0.025)
cube("主路", (0, -12.4, 0.68), (5.0, 17.6, 0.08), paving, "城内建筑", 0.01)
for x in (-4.4, 4.4):
    cylinder("门旁旗杆", (x, -18.0, 4.25), 0.075, 7.2, wood, "装饰与旗帜", 10)
    cylinder("旗杆金属顶", (x, -18.0, 7.98), 0.13, 0.28, metal, "装饰与旗帜", 10)
    verts = [(x, -18.0, 7.55), (x + 1.45, -18.0, 7.35), (x + 1.35, -18.0, 5.75), (x + 0.7, -18.0, 5.95), (x, -18.0, 5.7)]
    flag = mesh_object("城防旗帜", verts, [(0, 1, 2, 3, 4)], fabric, "装饰与旗帜")
    solid = flag.modifiers.new("织物厚度", "SOLIDIFY")
    solid.thickness = 0.025

# 批量应用曲线与修饰器，避免逐对象场景更新。
print("MODEL_GEOMETRY_READY", len(scene.objects), flush=True)
bpy.ops.object.select_all(action="DESELECT")
model_objects = [obj for obj in scene.objects if obj.parent in groups.values()]
for obj in model_objects:
    obj.select_set(True)
if model_objects:
    bpy.context.view_layer.objects.active = model_objects[0]
    bpy.ops.object.convert(target="MESH")
print("MODEL_MODIFIERS_APPLIED", flush=True)


def box_uv(obj, tile):
    if not tile or obj.get("uv_authored") or obj.type != "MESH":
        return
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = polygon.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        axes = [i for i in range(3) if i != axis]
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (co[axes[0]] / tile, co[axes[1]] / tile)


for obj in scene.objects:
    if obj.type == "MESH" and obj.parent in groups.values():
        for mat in obj.data.materials:
            box_uv(obj, mat.get("tile_meters", 0))

# 按主要分组和材质合并，保留可编辑的大组。
for group in groups.values():
    by_material = {}
    for obj in list(group.children):
        if obj.type != "MESH":
            continue
        key = obj.data.materials[0].name if obj.data.materials else "无材质"
        by_material.setdefault(key, []).append(obj)
    for material_name, objects in by_material.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = f"{group.name} · {material_name}"

# 统一法线并计算资产统计。
for obj in scene.objects:
    if obj.type == "MESH" and obj.parent in groups.values():
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()

bpy.context.view_layer.update()
mesh_objects = [obj for obj in scene.objects if obj.type == "MESH" and obj.parent in groups.values()]
coords = [obj.matrix_world @ vertex.co for obj in mesh_objects for vertex in obj.data.vertices]
minimum = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
maximum = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
triangles = 0
for obj in mesh_objects:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
stats = {
    "name": "青瓦城池",
    "assetId": "city-jade",
    "kind": "city",
    "builtin": "city",
    "source": "本工程 Blender 自制模型与贴图 · 可自由使用",
    "units": "meters",
    "boundsBlender": {"min": list(minimum), "max": list(maximum)},
    "sizeThreeMeters": [round(maximum.x - minimum.x, 3), round(maximum.z - minimum.z, 3), round(maximum.y - minimum.y, 3)],
    "groundOffset": round(-minimum.z, 3),
    "triangles": triangles,
    "meshCount": len(mesh_objects),
    "materials": sorted({mat.name for obj in mesh_objects for mat in obj.data.materials}),
    "front": "+Z",
    "generator": "blender/build_city.py",
}
(ASSET_MODELS / "qingwa-city.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
print("ASSET_STATS", json.dumps(stats, ensure_ascii=False))

bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / "blender" / "qingwa-city.blend"))

# 仅选择模型资产导出；不压缩几何，确保当前编辑器的 GLTFLoader 可直接读取。
bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
for group in groups.values():
    group.select_set(True)
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
output = ASSET_MODELS / "qingwa-city.glb"
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
shutil.copy2(output, PUBLIC_MODELS / "qingwa-city.glb")
shutil.copy2(ASSET_MODELS / "qingwa-city.json", PUBLIC_MODELS / "qingwa-city.json")

# Blender 检查渲染，不作为最终 Edit3D 验收。
bpy.ops.object.select_all(action="DESELECT")
render_ground = cube("仅供渲染的地面", (0, 0, -0.12), (180, 180, 0.2), None, "装饰与旗帜", 0)
render_ground.parent = None
ground_mat = bpy.data.materials.new("渲染地面 · 山地土壤")
ground_mat.diffuse_color = (0.18, 0.23, 0.15, 1)
ground_mat.use_nodes = True
ground_bsdf = ground_mat.node_tree.nodes.get("Principled BSDF") or ground_mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
ground_bsdf.inputs["Base Color"].default_value = (0.18, 0.23, 0.15, 1)
ground_bsdf.inputs["Roughness"].default_value = 0.95
render_ground.data.materials.append(ground_mat)
world = bpy.data.worlds.new("检查天空")
world.use_nodes = True
world_background = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
world_background.inputs["Color"].default_value = (0.48, 0.62, 0.78, 1)
world_background.inputs["Strength"].default_value = 0.45
scene.world = world
bpy.ops.object.light_add(type="SUN", location=(25, -35, 50))
sun = bpy.context.object
sun.name = "检查主光"
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(28), math.radians(-22), math.radians(-35))
sun.data.angle = math.radians(8)
bpy.ops.object.light_add(type="AREA", location=(-30, 15, 35))
fill = bpy.context.object
fill.name = "检查补光"
fill.data.energy = 1200
fill.data.shape = "DISK"
fill.data.size = 35


def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.object.camera_add(location=(66, -76, 58))
camera = bpy.context.object
camera.name = "检查相机"
camera.data.lens = 48
point_camera(camera, (0, 0, 4.8))
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 960
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"

views = [
    ("blender-main.png", (66, -76, 58), (0, 0, 4.8), 48),
    ("blender-front.png", (0, -78, 30), (0, -4, 5), 52),
    ("blender-rear.png", (-62, 70, 54), (0, 0, 4.8), 48),
    ("blender-roof.png", (27, -38, 29), (0, -13, 8.5), 58),
    ("blender-corner.png", (38, -40, 22), (23, -20, 9.2), 58),
]
for filename, position, target, lens in views:
    camera.location = position
    camera.data.lens = lens
    point_camera(camera, target)
    scene.render.filepath = str(REVIEW / filename)
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / "blender" / "qingwa-city.blend"))
print("CITY_BUILD_COMPLETE")
