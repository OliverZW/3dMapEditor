from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent / "textures"
OUT.mkdir(parents=True, exist_ok=True)


def noise(size, cells, seed):
    rng = np.random.default_rng(seed)
    small = (rng.random((cells, cells)) * 255).astype(np.uint8)
    base = Image.fromarray(small, "L").resize((size, size), Image.Resampling.BICUBIC)
    tiled = Image.fromarray(np.tile(np.asarray(base), (3, 3)), "L")
    tiled = tiled.filter(ImageFilter.GaussianBlur(max(1, size / cells * 0.08)))
    a = np.asarray(tiled)[size:size * 2, size:size * 2].astype(np.float32) / 255.0
    return a


def save_set(name, color, height, roughness, normal_strength=2.0):
    color = np.clip(color, 0, 255).astype(np.uint8)
    Image.fromarray(color, "RGB").save(OUT / f"{name}-color.png", optimize=True)
    Image.fromarray(np.clip(roughness * 255, 0, 255).astype(np.uint8), "L").save(
        OUT / f"{name}-roughness.png", optimize=True
    )
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * normal_strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * normal_strength
    normal = np.stack((-dx, -dy, np.ones_like(height)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal = ((normal * 0.5 + 0.5) * 255).astype(np.uint8)
    Image.fromarray(normal, "RGB").save(OUT / f"{name}-normal.png", optimize=True)


def masonry(name, size, rows, columns, base, seed, irregular=False):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    row = np.floor(yy / (size / rows)).astype(int)
    row_h = size / rows
    brick_w = size / columns
    shift = (row % 2) * brick_w * 0.5
    bx = (xx + shift) % size
    col = np.floor(bx / brick_w).astype(int)
    u = (bx % brick_w) / brick_w
    v = (yy % row_h) / row_h
    edge = np.minimum(np.minimum(u, 1 - u) * brick_w, np.minimum(v, 1 - v) * row_h)
    is_brick = name == "brick"
    # 城墙砖采用窄灰缝和浅倒角，避免粗大黑缝与斑驳色块抢过建筑细节。
    mortar_start, mortar_softness = (1.0, 2.2) if is_brick else (2.0, 4.0)
    mortar = np.clip((edge - mortar_start) / mortar_softness, 0, 1)
    bevel = np.clip(edge / (5.0 if is_brick else 12.0), 0, 1)
    variation = np.zeros((size, size), dtype=np.float32)
    variation_range = 6 if is_brick else 12
    for r in range(rows):
        for c in range(columns + 1):
            variation[(row == r) & (col == c)] = rng.uniform(-variation_range, variation_range)
    broad = noise(size, 8, seed + 1) * (8 if is_brick else 14) - (4 if is_brick else 7)
    fine = noise(size, 80 if is_brick else 64, seed + 2) * (5 if is_brick else 9) - (2.5 if is_brick else 4.5)
    color = np.zeros((size, size, 3), dtype=np.float32)
    for k in range(3):
        color[:, :, k] = base[k] + variation + broad + fine
    color *= (0.965 + 0.035 * bevel)[:, :, None]
    mortar_color = np.array([121, 116, 105] if is_brick else [82, 79, 70])
    color = color * mortar[:, :, None] + mortar_color * (1 - mortar[:, :, None])
    grain = noise(size, 160, seed + 3) * (0.035 if is_brick else 0.06)
    height = 0.35 + 0.55 * bevel + grain
    rough = (0.86 if is_brick else 0.82) + noise(size, 32, seed + 4) * 0.09
    save_set(name, color, height, rough, 2.2 if is_brick else 2.6)


def roof_tiles():
    size = 1024
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cols, rows = 12, 8
    u = (xx / size * cols) % 1
    v = (yy / size * rows) % 1
    phase = u * 2 * np.pi
    ridge = (np.cos(phase) * 0.5 + 0.5)
    seam = np.clip((np.minimum(u, 1 - u) - 0.018) * 38, 0, 1)
    row_lip = np.clip((v - 0.025) * 32, 0, 1)
    n = noise(size, 40, 330) * 6 - 3
    shade = 0.82 + ridge * 0.22
    base = np.array([65, 70, 69], dtype=np.float32)
    color = base[None, None, :] * shade[:, :, None] + n[:, :, None]
    color *= (0.90 + 0.10 * seam * row_lip)[:, :, None]
    height = ridge * 0.5 + 0.25 + 0.10 * row_lip
    rough = 0.72 + noise(size, 48, 331) * 0.14
    save_set("roof", color, height, rough, 2.4)


def wood():
    size = 1024
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    n1 = noise(size, 8, 440)
    n2 = noise(size, 56, 441)
    grain = np.sin((xx / size * 9 + n1 * 0.42) * 2 * np.pi)
    fine = np.sin((xx / size * 72 + n1 * 0.65) * 2 * np.pi)
    pores = noise(size, 180, 442) - 0.5
    board = np.floor(xx / (size / 4))
    seams = np.clip((np.minimum((xx % (size / 4)), size / 4 - (xx % (size / 4))) - 2) / 4, 0, 1)
    value = grain * 7 + fine * 2.2 + (n2 - 0.5) * 9 + pores * 4 + board * 1.5
    base = np.array([105, 65, 47])
    color = base[None, None, :] + value[:, :, None]
    color *= (0.76 + seams * 0.24)[:, :, None]
    height = 0.5 + grain * 0.05 + fine * 0.018 + pores * 0.025
    save_set("wood", color, height, 0.62 + n2 * 0.18, 2.0)


def plaster():
    size = 1024
    n = noise(size, 7, 550) * 10 + noise(size, 48, 551) * 5 + noise(size, 180, 554) * 2
    base = np.array([202, 194, 174])
    color = base[None, None, :] + (n - 8.5)[:, :, None]
    height = 0.45 + noise(size, 40, 552) * 0.08 + noise(size, 180, 555) * 0.045
    save_set("plaster", color, height, 0.88 + noise(size, 48, 553) * 0.08, 2.2)


def fabric():
    size = 256
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    weave = np.sin(xx * np.pi) * 0 + ((xx.astype(int) % 4 == 0) * 5) + ((yy.astype(int) % 4 == 0) * 4)
    n = noise(size, 16, 660) * 8
    base = np.array([131, 57, 47])
    color = base[None, None, :] + (weave + n - 8)[:, :, None]
    save_set("fabric", color, 0.5 + weave / 50, 0.82 + n / 160, 0.8)


masonry("brick", 1024, 16, 8, np.array([154, 148, 133]), 110)
masonry("stone", 1024, 5, 3, np.array([116, 111, 99]), 220, True)
masonry("paving", 1024, 6, 6, np.array([135, 128, 109]), 225)
roof_tiles()
wood()
plaster()
fabric()

manifest = {
    "generator": "generate_textures.py",
    "license": "工程自制，可随工程使用",
    "tiles": {
        "brick": "4 米", "stone": "4 米", "paving": "4 米",
        "roof": "2 米", "wood": "2 米", "plaster": "3 米", "fabric": "1 米"
    },
}
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Generated textures in {OUT}")
