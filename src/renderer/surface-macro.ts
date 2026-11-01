import * as THREE from 'three';

const SIZE = 128;
let shared: { texture: THREE.DataTexture; refs: number } | undefined;

/** 固定种子的周期值噪声，只在 CPU 创建派生纹理，不修改地图或素材文件。 */
export function surfaceMacroPixels() {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const hash = (x: number, y: number, period: number) => {
    let value = Math.imul((x % period) + 17, 374761393) ^ Math.imul((y % period) + 83, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number, period: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, period),
      b = hash(ix + 1, iy, period);
    const c = hash(ix, iy + 1, period),
      d = hash(ix + 1, iy + 1, period);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  for (let row = 0; row < SIZE; row++)
    for (let col = 0; col < SIZE; col++) {
      const offset = (row * SIZE + col) * 4;
      // 纹素中心取样，周期采样使重复边界连续。
      data[offset] = Math.round(noise(((col + 0.5) * 4) / SIZE, ((row + 0.5) * 4) / SIZE, 4) * 255);
      data[offset + 1] = Math.round(
        noise(((col + 0.5) * 12) / SIZE, ((row + 0.5) * 12) / SIZE, 12) * 255,
      );
      data[offset + 2] = data[offset];
      data[offset + 3] = 255;
    }
  return data;
}

export function acquireSurfaceMacro() {
  if (!shared) {
    const texture = new THREE.DataTexture(surfaceMacroPixels(), SIZE, SIZE);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    shared = { texture, refs: 0 };
  }
  const entry = shared;
  entry.refs++;
  let released = false;
  return {
    texture: entry.texture,
    release: () => {
      if (released) return;
      released = true;
      if (--entry.refs === 0) {
        entry.texture.dispose();
        shared = undefined;
      }
    },
  };
}
