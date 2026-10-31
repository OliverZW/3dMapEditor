"""将既有河流打包图的 R 通道作为视觉噪声；不是原游戏着色器解码。"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]


def seamless(values):
    values = values.copy()
    for axis in (0, 1):
        moved = np.swapaxes(values, 0, axis)
        for i in range(16):
            weight = (1 - i / 16) ** 2
            a, b = moved[i].copy(), moved[-1 - i].copy()
            mean = (a + b) / 2
            moved[i] = a * (1 - weight) + mean * weight
            moved[-1 - i] = b * (1 - weight) + mean * weight
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path(r'F:\cocosProject\sanguo'))
    args = parser.parse_args()
    relative = Path('map-objects/textures/T_Mobile_River__-801972329829235631.png')
    source = args.source / relative
    with Image.open(source) as image:
        if image.size != (1024, 1024) or image.mode != 'RGBA':
            raise ValueError('河流源图片规格异常')
        red = image.getchannel('R').resize((512, 512), Image.Resampling.LANCZOS)
    height = seamless(np.asarray(red.filter(ImageFilter.GaussianBlur(3.0)), dtype=np.float32) / 255)
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 5.0
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 5.0
    normals = np.stack((-dx, dy, np.ones_like(height)), axis=2)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    normals = seamless(normals)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    mask = seamless(np.clip((np.asarray(red, dtype=np.float32) / 255 - .25) / .6, 0, 1))
    output = ROOT / 'editor-assets/water'
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, data in [('ripple-normal.png', (normals * .5 + .5) * 255), ('ripple-mask.png', mask * 255)]:
        image = Image.fromarray(np.rint(np.clip(data, 0, 255)).astype(np.uint8))
        target = output / name
        image.save(target, format='PNG', compress_level=9)
        files[name] = {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                       'width': image.width, 'height': image.height, 'mode': image.mode}
    report = {
        'version': 1, 'scope': 'local-research-only', 'source': relative.as_posix(),
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'interpretation': 'R chosen as scalar artistic noise, not a claim about original packed encoding',
        'size': 512, 'seamBandPixels': 16,
        'normal': {'gaussianRadius': 3.0, 'centralDifferenceScale': 5.0, 'tangent': '+Y'},
        'mask': {'offset': .25, 'range': .6},
        'materialReferences': ['map_water_301', 'm_worldmap_river'],
        'missingOriginalResources': ['_WaterNormal', '_Foam', 'original shader'], 'files': files,
    }
    (output / 'provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    previous = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    manifest = {'version': 1, 'source': report['scope'], 'material': previous['material']}
    for kind, name in [('normal', 'ripple-normal.png'), ('mask', 'ripple-mask.png')]:
        entry = files[name]
        manifest[kind] = {'file': 'water/' + name, 'hash': entry['sha256'], 'width': entry['width'], 'height': entry['height']}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Water resources prepared: 2 x 512 PNG, R-channel visual approximation.')


if __name__ == '__main__':
    main()
