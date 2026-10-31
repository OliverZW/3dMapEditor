import { zlibSync, unzlibSync } from 'fflate';
import type { MapDocument } from '../core/types';
import { deriveHeights, sampleHeight } from '../core/terrain';
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12),
    view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)));
  return result;
}
function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
export function encodeHeightPng(
  heights: Float32Array,
  width: number,
  height: number,
  min: number,
  max: number,
): Uint8Array {
  if (
    heights.length !== width * height ||
    max <= min ||
    !heights.every((v) => Number.isFinite(v) && v >= min && v <= max)
  )
    throw new Error('高度超出导出范围，请调整高度范围');
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 16;
  header[9] = 0;
  const raw = new Uint8Array((width * 2 + 1) * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const v = Math.round(((heights[row * width + col] - min) / (max - min)) * 65535),
        i = row * (width * 2 + 1) + 1 + col * 2;
      raw[i] = v >>> 8;
      raw[i + 1] = v & 255;
    }
  return join([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ]);
}
export interface DecodedHeight {
  width: number;
  height: number;
  bits: number;
  values: Float32Array;
}
export function decodeHeightPng(bytes: Uint8Array): DecodedHeight {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    throw new Error('文件不是 PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    parts: Uint8Array[] = [];
  let width = 0,
    height = 0,
    bits = 0,
    end = false;
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset),
      type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (offset + 12 + length > bytes.length) throw new Error('PNG 数据截断');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)
    )
      throw new Error('PNG 校验失败');
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bits = data[8];
      if (
        length !== 13 ||
        ![8, 16].includes(bits) ||
        data[9] !== 0 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0 ||
        width < 2 ||
        height < 2 ||
        width > 4096 ||
        height > 4096
      )
        throw new Error('仅支持 2–4096 像素、非交错的 8/16 位灰度 PNG');
    }
    if (type === 'IDAT') parts.push(data);
    if (type === 'IEND') {
      end = true;
      break;
    }
    offset += length + 12;
  }
  if (!end || !width || !parts.length) throw new Error('PNG 缺少必要数据');
  const stride = width * (bits / 8),
    expected = (stride + 1) * height;
  const raw = unzlibSync(join(parts), { out: new Uint8Array(expected) });
  if (raw.length !== expected) throw new Error('PNG 像素数据长度错误');
  const pixels = new Uint8Array(stride * height),
    bpp = bits / 8;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    if (filter > 4) throw new Error('PNG 过滤类型无效');
    for (let col = 0; col < stride; col++) {
      const i = row * stride + col,
        a = col >= bpp ? pixels[i - bpp] : 0,
        b = row ? pixels[i - stride] : 0,
        c = row && col >= bpp ? pixels[i - stride - bpp] : 0;
      pixels[i] =
        (raw[row * (stride + 1) + 1 + col] +
          (filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? Math.floor((a + b) / 2)
                  : paeth(a, b, c))) &
        255;
    }
  }
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++)
    values[i] =
      (bits === 16 ? (pixels[i * 2] << 8) | pixels[i * 2 + 1] : pixels[i]) /
      (bits === 16 ? 65535 : 255);
  return { width, height, bits, values };
}
export function importHeights(
  doc: MapDocument,
  image: DecodedHeight,
  min: number,
  max: number,
  flipZ: boolean,
) {
  const n = doc.settings.samples;
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const x = (col / (n - 1)) * (image.width - 1),
        z = (flipZ ? 1 - row / (n - 1) : row / (n - 1)) * (image.height - 1),
        x0 = Math.floor(x),
        z0 = Math.floor(z),
        u = x - x0,
        v = z - z0;
      const value = (xx: number, zz: number) =>
        image.values[Math.min(image.height - 1, zz) * image.width + Math.min(image.width - 1, xx)];
      doc.heights[row * n + col] =
        min +
        (max - min) *
          (value(x0, z0) * (1 - u) * (1 - v) +
            value(x0 + 1, z0) * u * (1 - v) +
            value(x0, z0 + 1) * (1 - u) * v +
            value(x0 + 1, z0 + 1) * u * v);
    }
}
export function heightFiles(doc: MapDocument) {
  const heights = deriveHeights(doc),
    s = doc.settings;
  return {
    png: encodeHeightPng(heights, s.samples, s.samples, s.minHeight, s.maxHeight),
    metadata: {
      ...s,
      samplesX: s.samples,
      samplesZ: s.samples,
      unit: 'meter',
      heightEncoding: 'grayscale16',
      imageRight: '+X',
      imageDown: '+Z',
      origin: [-s.width / 2, 0, -s.depth / 2],
      includesRiverbed: true,
    },
  };
}
export { sampleHeight };
