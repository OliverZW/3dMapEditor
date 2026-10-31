"""从已有研究副本整理四层地表；仅在当前工程生成派生文件。"""

import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
LAYERS = [
    ("grass", "草地", 16, "atlas_layers_0_to_3__183.png", (0, 1024, 1024, 2048)),
    ("soil", "泥土", 16, "atlas_layers_0_to_3__183.png", (1024, 1024, 2048, 2048)),
    ("rock", "岩石", 32, "atlas_layers_4_to_7__204.png", (0, 0, 1024, 1024)),
    ("sand", "沙地", 24, "atlas_layers_4_to_7__204.png", (1024, 1024, 2048, 2048)),
]


def seamless(image):
    # 在相对边界同时衰减原始差值，边缘达到同一颜色，内部纹理不变。
    pixels = np.asarray(image, dtype=np.float32).copy()
    band = 32
    for axis in (0, 1):
        moved = np.swapaxes(pixels, 0, axis)
        for i in range(band):
            t = (1 - i / band) ** 2
            a, b = moved[i].copy(), moved[-1 - i].copy()
            mean = (a + b) / 2
            moved[i] = a * (1 - t) + mean * t
            moved[-1 - i] = b * (1 - t) + mean * t
    return Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))


def normal_map(image):
    gray = np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32) / 255
    dx = (np.roll(gray, -1, axis=1) - np.roll(gray, 1, axis=1)) * 1.5
    dy = (np.roll(gray, -1, axis=0) - np.roll(gray, 1, axis=0)) * 1.5
    # 输出切线空间 +Y；图片行向下，纹理 v 向上。
    normals = np.stack((-dx, dy, np.ones_like(gray)), axis=2)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    return seamless(Image.fromarray(np.rint((normals * 0.5 + 0.5) * 255).astype(np.uint8)))


def png_bytes(image):
    output = io.BytesIO()
    image.save(output, format="PNG", compress_level=9)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(r"F:\cocosProject\sanguo"))
    args = parser.parse_args()
    output = ROOT / "editor-assets" / "surface"
    output.mkdir(parents=True, exist_ok=True)
    defaults, sources = [], []
    for layer_id, name, meters, atlas, box in LAYERS:
        source = args.source / "worldmap" / "textures" / atlas
        with Image.open(source) as image:
            if image.size != (2048, 2048):
                raise ValueError(f"图集尺寸异常：{atlas}")
            color = seamless(ImageEnhance.Color(image.crop(box).convert("RGB")).enhance(0.82))
        normal = normal_map(color)
        layer = {"id": layer_id, "name": name, "meters": meters}
        for kind, image in (("color", color), ("normal", normal)):
            data = png_bytes(image)
            digest = hashlib.sha256(data).hexdigest()
            (output / f"{layer_id}-{kind}.png").write_bytes(data)
            layer[kind] = {"file": f"surface/{layer_id}-{kind}.png", "hash": digest, "width": 1024, "height": 1024}
        color.resize((128, 128), Image.Resampling.LANCZOS).save(output / f"{layer_id}-thumb.png")
        thumbnail = output / f"{layer_id}-thumb.png"
        layer["thumbnail"] = {"file": f"surface/{layer_id}-thumb.png", "hash": hashlib.sha256(thumbnail.read_bytes()).hexdigest(), "width": 128, "height": 128}
        defaults.append(layer)
        sources.append({"id": layer_id, "atlas": atlas, "crop": box,
                        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    previous = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    manifest = {"scale": previous["scale"], "detail": previous["detail"], "slopeRock": previous["slopeRock"], "id": "sg8-local-research-v1", "version": 1,
                "source": "三国群英传8已提取资源 · 仅本机研究样板", "layers": defaults}
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"scope": "local-research-only", "sources": sources, "size": 1024,
              "seamBandPixels": 32, "saturation": 0.82,
              "normal": "luminance approximation; gaussian=1; centralDifference=1.5; tangent+Y",
              "files": manifest}
    (output / "provenance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已整理 {len(defaults)} 层，PNG 与清单统一保存到 editor-assets/surface")


if __name__ == "__main__":
    main()
