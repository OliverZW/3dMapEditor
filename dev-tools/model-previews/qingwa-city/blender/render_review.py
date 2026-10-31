import bpy
import math
from pathlib import Path
from mathutils import Vector

project = Path(__file__).resolve().parents[1]
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 960
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"
if scene.camera is None:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.12))
    ground = bpy.context.object
    ground.name = "仅供渲染的地面"
    ground.dimensions = (180, 180, 0.2)
    ground_mat = bpy.data.materials.new("渲染地面 · 山地土壤")
    ground_mat.use_nodes = True
    ground_bsdf = ground_mat.node_tree.nodes.get("Principled BSDF") or ground_mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    ground_bsdf.inputs["Base Color"].default_value = (0.18, 0.23, 0.15, 1)
    ground_bsdf.inputs["Roughness"].default_value = 0.95
    ground.data.materials.append(ground_mat)
    world = bpy.data.worlds.new("检查天空")
    world.use_nodes = True
    world_background = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
    world_background.inputs["Color"].default_value = (0.48, 0.62, 0.78, 1)
    world_background.inputs["Strength"].default_value = 0.45
    scene.world = world
    bpy.ops.object.light_add(type="SUN", location=(25, -35, 50))
    sun = bpy.context.object
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(28), math.radians(-22), math.radians(-35))
    sun.data.angle = math.radians(8)
    bpy.ops.object.light_add(type="AREA", location=(-30, 15, 35))
    fill = bpy.context.object
    fill.data.energy = 1200
    fill.data.shape = "DISK"
    fill.data.size = 35
    bpy.ops.object.camera_add(location=(66, -76, 58))
    camera = bpy.context.object
    camera.data.lens = 48
    scene.camera = camera
else:
    camera = scene.camera
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
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(project / "docs" / "review" / filename)
    bpy.ops.render.render(write_still=True)
print("REVIEW_RENDERS_COMPLETE", flush=True)
