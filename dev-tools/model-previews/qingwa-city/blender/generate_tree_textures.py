from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUTPUT = Path(__file__).resolve().parent / "textures"
OUTPUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261025)


def noise(width, height):
    image = Image.fromarray(np.uint8(rng.random((height, width)) * 255), "L")
    return np.asarray(image.resize((SIZE, SIZE), Image.Resampling.BICUBIC), dtype=np.float32) / 255


def save(name, array):
    Image.fromarray(np.uint8(np.clip(array, 0, 255)), "RGB" if array.ndim == 3 else "L").save(OUTPUT / name)


# 纵向纤维、断续裂隙和少量横向弯折构成树皮，避免砖墙式规则纹理。
broad = noise(18, 5)
fiber = noise(105, 14)
fine = noise(360, 90)
grain = noise(512, 512)
y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
warp = np.sin(y / 83 + broad * 4.2) * 0.09
ridges = np.abs(np.sin((x / SIZE * 44 + fiber * 2.6 + warp) * np.pi))
fissures = np.clip((0.31 - ridges) * 5.2, 0, 1) * np.clip((fiber - 0.28) * 2.2, 0, 1)
height = 0.38 + broad * 0.24 + fiber * 0.22 + fine * 0.1 + grain * 0.06 - fissures * 0.34
color = np.empty((SIZE, SIZE, 3), dtype=np.float32)
base = np.array([103, 82, 60], dtype=np.float32)
color[:] = base
color += (height[..., None] - 0.5) * np.array([74, 66, 55])
color -= fissures[..., None] * np.array([29, 25, 20])
color += (grain[..., None] - 0.5) * 8

bark = Image.fromarray(np.uint8(np.clip(color, 0, 255)), "RGB")
draw = ImageDraw.Draw(bark, "RGBA")
for _ in range(18):
    cx = int(rng.integers(30, SIZE - 30))
    cy = int(rng.integers(20, SIZE - 20))
    rx = int(rng.integers(8, 20))
    ry = int(rng.integers(20, 52))
    for ring in range(3):
        draw.ellipse((cx - rx - ring * 3, cy - ry - ring * 5, cx + rx + ring * 3, cy + ry + ring * 5), outline=(46, 35, 25, 65 - ring * 12), width=2)
bark = bark.filter(ImageFilter.GaussianBlur(0.35))
bark.save(OUTPUT / "tree-bark-color.png")

roughness = 218 + (fine - 0.5) * 24 + fissures * 20
save("tree-bark-roughness.png", roughness)
dy, dx = np.gradient(height)
normal = np.stack((-dx * 4.8, -dy * 3.2, np.ones_like(height)), axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
save("tree-bark-normal.png", (normal * 0.5 + 0.5) * 255)
print("TREE_TEXTURES_READY", OUTPUT)
