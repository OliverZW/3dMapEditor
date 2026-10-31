from pathlib import Path
import hashlib
import json
import struct
import sys

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "public" / "models" / "qingwa-city.glb"
data = path.read_bytes()
magic, version, total = struct.unpack_from("<4sII", data, 0)
assert magic == b"glTF" and version == 2 and total == len(data), "GLB 头或长度无效"
json_length, json_type = struct.unpack_from("<II", data, 12)
assert json_type == 0x4E4F534A, "缺少 JSON chunk"
doc = json.loads(data[20:20 + json_length].decode("utf-8"))
required = set(doc.get("extensionsRequired", []))
assert "KHR_draco_mesh_compression" not in required, "当前编辑器未配置 Draco 解码"
assert "EXT_mesh_gpu_instancing" not in required, "不使用 GPU instancing 扩展"
assert all("uri" not in item for item in doc.get("buffers", [])), "存在外部缓冲资源"
assert all("uri" not in item for item in doc.get("images", [])), "存在外部图片资源"
materials = doc.get("materials", [])
assert materials and all(item.get("name", "").strip() for item in materials), "存在未命名材质"
triangles = 0
for mesh in doc.get("meshes", []):
    for primitive in mesh.get("primitives", []):
        assert primitive.get("mode", 4) == 4, "存在非三角形图元"
        if "indices" in primitive:
            triangles += doc["accessors"][primitive["indices"]]["count"] // 3
        else:
            triangles += doc["accessors"][primitive["attributes"]["POSITION"]]["count"] // 3
report = {
    "file": path.name,
    "bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(),
    "nodes": len(doc.get("nodes", [])),
    "meshes": len(doc.get("meshes", [])),
    "materials": len(materials),
    "materialNames": [item["name"] for item in materials],
    "images": len(doc.get("images", [])),
    "triangles": triangles,
    "extensionsRequired": sorted(required),
    "selfContained": True,
}
print(json.dumps(report, ensure_ascii=False, indent=2))
