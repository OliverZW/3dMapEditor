import bpy
import bmesh
import json
import math
import random
import shutil
from pathlib import Path

from mathutils import Vector

# 批量重建时不生成 .blend1，避免已有备份被占用而中断后续树种导出。
bpy.context.preferences.filepaths.save_version = 0

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[2]
TEXTURES = Path(__file__).resolve().parent / "textures"
PUBLIC_MODELS = PROJECT / "public" / "models"
ASSET_MODELS = WORKSPACE / "editor-assets" / "models"
REVIEW = PROJECT / "docs" / "review"
for directory in (PUBLIC_MODELS, ASSET_MODELS, REVIEW):
    directory.mkdir(parents=True, exist_ok=True)

SPECIES = {
    "pine-tree": {"name": "山地松", "assetId": "tree-pine", "seed": 3101},
    "cypress-tree": {"name": "翠柏", "assetId": "tree-cypress", "seed": 3102},
    "maple-tree": {"name": "红枫", "assetId": "tree-maple", "seed": 3103},
    "willow-tree": {"name": "垂柳", "assetId": "tree-willow", "seed": 3104},
}


def linear_color(color):
    def convert(channel):
        value = channel / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    return tuple(convert(value) for value in color)


def make_material(name, color, roughness=0.84):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgb = linear_color(color)
    mat.diffuse_color = (*rgb, 1)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0
    return mat


def make_bark_material():
    mat = make_material("树木 · 灰褐树皮", (103, 82, 60), 0.9)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    for suffix, socket, colorspace in (("color", "Base Color", "sRGB"), ("roughness", "Roughness", "Non-Color")):
        image = bpy.data.images.load(str(TEXTURES / f"tree-bark-{suffix}.png"), check_existing=True)
        image.colorspace_settings.name = colorspace
        image.pack()
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], bsdf.inputs[socket])
    image = bpy.data.images.load(str(TEXTURES / "tree-bark-normal.png"), check_existing=True)
    image.colorspace_settings.name = "Non-Color"
    image.pack()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.6
    links.new(texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


class TreeBuilder:
    def __init__(self, key, config):
        self.key = key
        self.config = config
        self.rng = random.Random(config["seed"])
        self.bark_vertices = []
        self.bark_faces = []
        self.bark_face_uvs = []
        self.leaf_vertices = []
        self.leaf_faces = []
        self.leaf_material_indices = []
        self.root = bpy.data.objects.new(config["name"], None)
        bpy.context.scene.collection.objects.link(self.root)
        self.root["assetId"] = config["assetId"]
        self.root["units"] = "meters"
        self.root["front"] = "Three.js +Z"
        self.root["seed"] = config["seed"]
        self.root["source"] = "工程自制程序生成 · Blender 5.0"
        palettes = {
            "pine-tree": [(31, 57, 40), (43, 70, 45), (55, 79, 48), (67, 88, 53)],
            "cypress-tree": [(36, 66, 43), (48, 80, 48), (62, 91, 52), (76, 101, 58)],
            "maple-tree": [(112, 42, 28), (148, 55, 30), (177, 76, 34), (194, 104, 42)],
            "willow-tree": [(67, 91, 43), (84, 108, 50), (102, 121, 58), (119, 133, 67)],
        }
        names = ["深色", "主色", "暖色", "梢色"]
        self.leaf_materials = [make_material(f"{config['name']} · {names[index]}", color) for index, color in enumerate(palettes[key])]

    def tube(self, points, radii, sides=8):
        points = [Vector(point) for point in points]
        base = len(self.bark_vertices)
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
                self.bark_vertices.append(tuple(point + radius * (math.cos(angle) * axis_u + math.sin(angle) * axis_v)))
        for ring in range(len(points) - 1):
            for side in range(sides):
                a = base + ring * sides + side
                b = base + ring * sides + (side + 1) % sides
                c = base + (ring + 1) * sides + (side + 1) % sides
                d = base + (ring + 1) * sides + side
                self.bark_faces.append((a, b, c, d))
                circumference = math.tau * (radii[ring] + radii[ring + 1]) * 0.5
                u0 = side / sides * circumference / 0.85
                u1 = (side + 1) / sides * circumference / 0.85
                v0 = lengths[ring] / 1.5
                v1 = lengths[ring + 1] / 1.5
                self.bark_face_uvs.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
        self.bark_faces.append(tuple(base + side for side in reversed(range(sides))))
        self.bark_face_uvs.append(tuple((0, 0) for _ in range(sides)))
        end = base + (len(points) - 1) * sides
        self.bark_faces.append(tuple(end + side for side in range(sides)))
        self.bark_face_uvs.append(tuple((0, 0) for _ in range(sides)))

    def roots(self, count=6, reach=0.9):
        for index in range(count):
            angle = index / count * math.tau + self.rng.uniform(-0.2, 0.2)
            direction = Vector((math.cos(angle), math.sin(angle), 0))
            length = reach * self.rng.uniform(0.8, 1.15)
            self.tube(
                [(0, 0, 0.42), direction * 0.28 + Vector((0, 0, 0.18)), direction * length * 0.72 + Vector((0, 0, 0.07)), direction * length + Vector((0, 0, 0.03))],
                [0.18, 0.14, 0.075, 0.022],
                9,
            )

    def leaf(self, center, length, width, angle, tilt, material_index, shape="lanceolate"):
        center = Vector(center)
        direction = Vector((math.cos(angle), math.sin(angle), tilt)).normalized()
        across = Vector((-math.sin(angle), math.cos(angle), self.rng.uniform(-0.18, 0.18))).normalized()
        normal = direction.cross(across).normalized()
        base = len(self.leaf_vertices)
        if shape == "maple":
            outline = [
                (-0.5, 0), (-0.2, -0.13), (-0.34, -0.47), (-0.02, -0.3), (0.1, -0.58),
                (0.25, -0.25), (0.58, -0.28), (0.4, 0), (0.58, 0.28), (0.25, 0.25),
                (0.1, 0.58), (-0.02, 0.3), (-0.34, 0.47), (-0.2, 0.13),
            ]
            self.leaf_vertices.append(tuple(center + normal * width * 0.05))
            for x, y in outline:
                self.leaf_vertices.append(tuple(center + direction * x * length + across * y * width))
            for index in range(len(outline)):
                self.leaf_faces.append((base, base + 1 + index, base + 1 + (index + 1) % len(outline)))
                self.leaf_material_indices.append(material_index)
        elif shape == "needle":
            self.leaf_vertices.extend(
                [
                    tuple(center - direction * length * 0.5),
                    tuple(center - across * width * 0.5),
                    tuple(center + direction * length * 0.5),
                    tuple(center + across * width * 0.5),
                ]
            )
            for face in ((base, base + 1, base + 2), (base, base + 2, base + 3)):
                self.leaf_faces.append(face)
                self.leaf_material_indices.append(material_index)
        else:
            self.leaf_vertices.extend(
                [
                    tuple(center - direction * length * 0.5),
                    tuple(center - across * width * 0.5),
                    tuple(center + direction * length * 0.5),
                    tuple(center + across * width * 0.5),
                    tuple(center + normal * width * 0.1),
                ]
            )
            for face in ((base, base + 1, base + 4), (base + 1, base + 2, base + 4), (base + 2, base + 3, base + 4), (base + 3, base, base + 4)):
                self.leaf_faces.append(face)
                self.leaf_material_indices.append(material_index)

    def cluster(self, center, radii, count, length, width, shape="lanceolate", upright=0.0):
        center = Vector(center)
        if self.key == "pine-tree":
            shape = "needle"
        for _ in range(count):
            direction = Vector((self.rng.gauss(0, 1), self.rng.gauss(0, 1), self.rng.gauss(0, 1))).normalized()
            distance = self.rng.random() ** (1 / 3)
            offset = Vector((direction.x * radii[0], direction.y * radii[1], direction.z * radii[2])) * distance
            material_index = self.rng.choices((0, 1, 2, 3), weights=(25, 43, 25, 7))[0]
            self.leaf(
                center + offset,
                self.rng.uniform(*length),
                self.rng.uniform(*width),
                self.rng.uniform(0, math.tau),
                self.rng.uniform(-0.45, 0.55) + upright,
                material_index,
                shape,
            )

    def finish(self):
        bark_mesh = bpy.data.meshes.new(f"{self.config['name']} · 枝干")
        bark_mesh.from_pydata(self.bark_vertices, [], self.bark_faces)
        bark_mesh.update()
        bark_object = bpy.data.objects.new(f"{self.config['name']} · 树干与枝系", bark_mesh)
        bpy.context.scene.collection.objects.link(bark_object)
        bark_object.parent = self.root
        bark_mesh.materials.append(make_bark_material())
        uv = bark_mesh.uv_layers.new(name="UVMap")
        for polygon, coordinates in zip(bark_mesh.polygons, self.bark_face_uvs):
            for loop_index, coordinate in zip(polygon.loop_indices, coordinates):
                uv.data[loop_index].uv = coordinate
            polygon.use_smooth = True
        leaf_mesh = bpy.data.meshes.new(f"{self.config['name']} · 叶冠")
        leaf_mesh.from_pydata(self.leaf_vertices, [], self.leaf_faces)
        leaf_mesh.update()
        leaf_object = bpy.data.objects.new(f"{self.config['name']} · 立体叶冠", leaf_mesh)
        bpy.context.scene.collection.objects.link(leaf_object)
        leaf_object.parent = self.root
        for mat in self.leaf_materials:
            leaf_mesh.materials.append(mat)
        for polygon, material_index in zip(leaf_mesh.polygons, self.leaf_material_indices):
            polygon.material_index = material_index
        minimum_z = min(vertex[2] for vertex in self.bark_vertices)
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
        objects = (bark_object, leaf_object)
        coordinates = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
        minimum = Vector(tuple(min(vertex[axis] for vertex in coordinates) for axis in range(3)))
        maximum = Vector(tuple(max(vertex[axis] for vertex in coordinates) for axis in range(3)))
        triangles = 0
        for obj in objects:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
        stats = {
            "name": self.config["name"],
            "assetId": self.config["assetId"],
            "kind": "tree",
            "builtin": self.key.removesuffix("-tree"),
            "source": "本工程 Blender 自制模型与贴图 · 可自由使用",
            "units": "meters",
            "boundsBlender": {"min": list(minimum), "max": list(maximum)},
            "sizeThreeMeters": [round(maximum.x - minimum.x, 3), round(maximum.z - minimum.z, 3), round(maximum.y - minimum.y, 3)],
            "groundOffset": round(-minimum.z, 3),
            "triangles": triangles,
            "meshCount": 2,
            "leafCount": len(self.leaf_faces) // (14 if self.key == "maple-tree" else 2 if self.key == "pine-tree" else 4),
            "materials": [bark_mesh.materials[0].name, *(mat.name for mat in self.leaf_materials)],
            "front": "+Z",
            "generator": "blender/build_tree_variants.py",
            "seed": self.config["seed"],
        }
        (ASSET_MODELS / f"{self.key}.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        bpy.ops.object.select_all(action="DESELECT")
        self.root.select_set(True)
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = self.root
        bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / "blender" / f"{self.key}.blend"))
        output = ASSET_MODELS / f"{self.key}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output), export_format="GLB", use_selection=True, export_apply=True,
            export_yup=True, export_animations=False, export_cameras=False, export_lights=False,
            export_image_format="WEBP", export_extras=True,
        )
        # 制作预览副本，不作为编辑器的素材来源。
        shutil.copy2(output, PUBLIC_MODELS / f"{self.key}.glb")
        shutil.copy2(ASSET_MODELS / f"{self.key}.json", PUBLIC_MODELS / f"{self.key}.json")
        print("TREE_VARIANT_EXPORTED", self.key, json.dumps(stats, ensure_ascii=False), flush=True)
        return stats


def build_pine(builder):
    rng = builder.rng
    trunk = []
    for index in range(17):
        z = index * 0.56
        trunk.append(Vector((0.1 * math.sin(z * 0.7) + z * 0.025, 0.08 * math.sin(z * 1.1), z)))
    builder.tube(trunk, [0.38 * (1 - index / 18) ** 1.25 + 0.004 for index in range(17)], 12)
    builder.roots(6, 0.85)
    for level in range(8):
        z = 2.35 + level * 0.82
        branch_count = 5 if level < 5 else 4
        length = 3.0 * (1 - level / 10) ** 0.85
        for branch in range(branch_count):
            angle = branch / branch_count * math.tau + level * 1.37 + rng.uniform(-0.18, 0.18)
            direction = Vector((math.cos(angle), math.sin(angle), 0))
            start = Vector((z * 0.025, 0, z))
            end = start + direction * length + Vector((0, 0, rng.uniform(0.15, 0.48)))
            points = [start, start + direction * length * 0.32 - Vector((0, 0, 0.16)), start + direction * length * 0.7 - Vector((0, 0, 0.1)), end]
            radius = max(0.035, 0.12 - level * 0.009)
            builder.tube(points, [radius, radius * 0.7, radius * 0.4, 0.01], 8)
            builder.cluster(points[2], (0.68, 0.62, 0.3), 80, (0.25, 0.42), (0.025, 0.052))
            builder.cluster(end, (0.78, 0.7, 0.34), 160, (0.25, 0.42), (0.025, 0.052))
            for side_sign in (-1, 1):
                twig_angle = angle + side_sign * 0.72
                twig_direction = Vector((math.cos(twig_angle), math.sin(twig_angle), 0))
                twig_start = points[2]
                twig_end = twig_start + twig_direction * length * 0.36 + Vector((0, 0, 0.2))
                builder.tube([twig_start, twig_end], [radius * 0.34, 0.006], 6)
                builder.cluster(twig_end, (0.62, 0.56, 0.3), 105, (0.24, 0.4), (0.024, 0.048))
    builder.cluster(trunk[-1], (0.58, 0.55, 0.68), 220, (0.25, 0.4), (0.025, 0.05), upright=0.35)


def build_cypress(builder):
    rng = builder.rng
    trunk = [Vector((0.04 * math.sin(index * 0.7), 0.03 * math.cos(index), index * 0.5)) for index in range(18)]
    builder.tube(trunk, [0.3 * (1 - index / 19) ** 1.35 + 0.012 for index in range(18)], 11)
    builder.roots(5, 0.65)
    for level in range(12):
        z = 1.45 + level * 0.57
        length = 1.5 * (1 - level / 14) ** 0.85
        builder.cluster((0, 0, z + 0.3), (0.52, 0.52, 0.72), 70, (0.13, 0.23), (0.055, 0.1), upright=0.45)
        for branch in range(3):
            angle = branch / 3 * math.tau + level * 1.19 + rng.uniform(-0.2, 0.2)
            direction = Vector((math.cos(angle), math.sin(angle), 0))
            start = Vector((0, 0, z))
            end = start + direction * length + Vector((0, 0, 0.65 + length * 0.25))
            builder.tube([start, start + direction * length * 0.55 + Vector((0, 0, 0.28)), end], [0.065, 0.035, 0.006], 7)
            for step in (0.5, 0.78, 1.0):
                center = start.lerp(end, step)
                builder.cluster(center, (0.53, 0.53, 0.74), 105, (0.13, 0.23), (0.055, 0.1), upright=0.45)
    builder.cluster(trunk[-1] - Vector((0, 0, 0.2)), (0.5, 0.5, 0.85), 260, (0.13, 0.23), (0.05, 0.09), upright=0.55)


def build_maple(builder):
    rng = builder.rng
    trunk = [Vector((0.12 * math.sin(index * 0.55), 0.08 * math.sin(index * 0.8), index * 0.43)) for index in range(13)]
    builder.tube(trunk, [0.4 * (1 - index / 14) ** 1.2 + 0.018 for index in range(13)], 12)
    builder.roots(7, 0.9)
    for index in range(11):
        angle = index * 2.399963 + rng.uniform(-0.2, 0.2)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        start = trunk[3 + int(index * 0.65)]
        length = rng.uniform(2.0, 3.0)
        rise = rng.uniform(0.85, 1.5)
        primary = [start, start + direction * length * 0.35 + Vector((0, 0, rise * 0.5)), start + direction * length * 0.72 + Vector((0, 0, rise * 0.85)), start + direction * length + Vector((0, 0, rise))]
        radius = rng.uniform(0.12, 0.17)
        builder.tube(primary, [radius, radius * 0.62, radius * 0.32, 0.014], 9)
        builder.cluster(primary[-1], (0.85, 0.8, 0.48), 30, (0.25, 0.39), (0.25, 0.4), "maple")
        for branch_index in range(3):
            branch_angle = angle + (-0.85, 0.75, 0.1)[branch_index]
            branch_direction = Vector((math.cos(branch_angle), math.sin(branch_angle), 0))
            branch_start = primary[1] if branch_index == 0 else primary[2]
            branch_end = branch_start + branch_direction * rng.uniform(0.8, 1.35) + Vector((0, 0, rng.uniform(0.25, 0.6)))
            builder.tube([branch_start, branch_end], [radius * 0.36, 0.007], 7)
            builder.cluster(branch_end, (0.78, 0.72, 0.48), 38, (0.25, 0.4), (0.25, 0.4), "maple")
            for sign in (-1, 1):
                twig_angle = branch_angle + sign * 0.8
                twig_end = branch_end + Vector((math.cos(twig_angle), math.sin(twig_angle), 0)) * rng.uniform(0.4, 0.72) + Vector((0, 0, 0.15))
                builder.tube([branch_end, twig_end], [0.018, 0.004], 6)
                builder.cluster(twig_end, (0.62, 0.6, 0.42), 26, (0.24, 0.38), (0.24, 0.38), "maple")
    builder.cluster(trunk[-1] + Vector((0, 0, 0.35)), (1.1, 1.0, 0.65), 85, (0.25, 0.4), (0.25, 0.4), "maple")


def build_willow(builder):
    rng = builder.rng
    trunk = [Vector((0.1 * math.sin(index * 0.5), 0.07 * math.cos(index * 0.6), index * 0.46)) for index in range(14)]
    builder.tube(trunk, [0.43 * (1 - index / 15) ** 1.2 + 0.005 for index in range(14)], 12)
    builder.roots(7, 1.0)
    for index in range(10):
        angle = index * 2.399963 + rng.uniform(-0.18, 0.18)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        start = trunk[5 + int(index * 0.65)]
        length = rng.uniform(2.1, 3.15)
        rise = rng.uniform(1.2, 1.85)
        primary = [start, start + direction * length * 0.3 + Vector((0, 0, rise * 0.65)), start + direction * length * 0.68 + Vector((0, 0, rise)), start + direction * length + Vector((0, 0, rise * 0.72))]
        radius = rng.uniform(0.12, 0.18)
        builder.tube(primary, [radius, radius * 0.65, radius * 0.35, 0.012], 9)
        builder.cluster(primary[2], (0.88, 0.82, 0.58), 95, (0.3, 0.48), (0.055, 0.095))
        builder.cluster(primary[-1], (0.85, 0.78, 0.55), 90, (0.3, 0.48), (0.055, 0.095))
        for hanging_index in range(5):
            t = 0.28 + hanging_index * 0.17
            segment = min(2, int(t * 3))
            local_t = t * 3 - segment
            hanging_start = primary[segment].lerp(primary[segment + 1], local_t)
            hanging_length = rng.uniform(1.35, 2.65) * (0.8 + t * 0.25)
            sway = Vector((-math.sin(angle), math.cos(angle), 0)) * rng.uniform(-0.35, 0.35)
            points = []
            for step in range(6):
                fraction = step / 5
                points.append(hanging_start + direction * (0.28 * math.sin(fraction * math.pi)) + sway * fraction + Vector((0, 0, -hanging_length * fraction)))
            builder.tube(points, [0.018, 0.015, 0.012, 0.009, 0.006, 0.0025], 6)
            for step in range(1, 6):
                center = points[step]
                builder.cluster(center, (0.28, 0.28, 0.42), 28, (0.3, 0.5), (0.045, 0.08), upright=-0.65)
    builder.cluster(trunk[-1] + Vector((0, 0, 0.25)), (1.15, 1.05, 0.68), 220, (0.3, 0.48), (0.05, 0.09))


BUILDERS = {"pine-tree": build_pine, "cypress-tree": build_cypress, "maple-tree": build_maple, "willow-tree": build_willow}
CAMERAS = {
    "pine-tree": ((13, -17, 11), (0, 0, 4.5), (6, -8, 8), (0, 0, 6.3)),
    "cypress-tree": ((11, -15, 9), (0, 0, 4.3), (5, -7, 7), (0, 0, 5.4)),
    "maple-tree": ((12, -16, 9), (0, 0, 3.7), (6, -8, 7), (0, 0, 5.0)),
    "willow-tree": ((13, -17, 10), (0, 0, 3.9), (6, -8, 7), (0, 0, 4.8)),
}
all_stats = {}
for key, config in SPECIES.items():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    builder = TreeBuilder(key, config)
    BUILDERS[key](builder)
    all_stats[key] = builder.finish()
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.mesh.primitive_plane_add(size=70, location=(0, 0, -0.025))
    ground = bpy.context.object
    ground.data.materials.append(make_material("渲染地面 · 山地土壤", (92, 104, 72), 0.96))
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
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.lens = 52
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    main_position, main_target, detail_position, detail_target = CAMERAS[key]
    for suffix, position, target, lens in (("main", main_position, main_target, 52), ("detail", detail_position, detail_target, 58)):
        camera.location = position
        camera.data.lens = lens
        camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(REVIEW / f"{key}-{suffix}.png")
        bpy.ops.render.render(write_still=True)
    print("TREE_VARIANT_REVIEWED", key, flush=True)

(REVIEW / "tree-variants-stats.json").write_text(json.dumps(all_stats, ensure_ascii=False, indent=2), encoding="utf-8")
print("FOUR_TREE_VARIANTS_COMPLETE", flush=True)
