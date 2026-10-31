import { unzlibSync } from 'fflate';

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let k = 0; k < 8; k++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

const shaConstants = new Uint32Array(64);
const shaInitial: number[] = [];
for (let candidate = 2, index = 0; index < 64; candidate++) {
  let prime = true;
  for (let divisor = 2; divisor * divisor <= candidate; divisor++)
    if (candidate % divisor === 0) {
      prime = false;
      break;
    }
  if (prime) {
    if (index < 8) shaInitial.push(((Math.sqrt(candidate) % 1) * 4294967296) >>> 0);
    shaConstants[index++] = ((Math.cbrt(candidate) % 1) * 4294967296) >>> 0;
  }
}
const rotate = (v: number, n: number) => (v >>> n) | (v << (32 - n));
export function imageHash(bytes: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 536870912));
  view.setUint32(padded.length - 4, bytes.length * 8);
  const state = [...shaInitial],
    words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2];
      words[i] =
        words[i - 16] +
        (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
        words[i - 7] +
        (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          shaConstants[i] +
          words[i]) >>>
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      state[i] = (state[i] + value) >>> 0;
    });
  }
  return state.map((v) => v.toString(16).padStart(8, '0')).join('');
}

const checked = new WeakMap<Uint8Array, { hash: string; width: number; height: number }>();
export function validateSurfacePng(
  bytes: Uint8Array,
  hash: string,
  width: number,
  height: number,
  allowGrayscale = false,
) {
  if (![width, height].every((value) => Number.isInteger(value) && value >= 2 && value <= 4096))
    throw new Error('PNG 尺寸无效或超限');
  const previous = checked.get(bytes);
  if (
    previous?.hash === hash &&
    previous.width === width &&
    previous.height === height &&
    (allowGrayscale || [2, 6].includes(bytes[25]))
  )
    return;
  if (
    bytes.length < 45 ||
    bytes.length > 16 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
  )
    throw new Error('地表贴图不是有效 PNG 或超过预算');
  if (imageHash(bytes) !== hash) throw new Error('地表贴图内容哈希不符');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    channels = 0,
    header = false,
    end = false;
  const parts: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset),
      type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset + length + 12 > bytes.length) throw new Error('地表 PNG 数据截断');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + length + 8)
    )
      throw new Error('地表 PNG 校验失败');
    if (!header && type !== 'IHDR') throw new Error('地表 PNG 缺少头部');
    if (type === 'IHDR') {
      if (
        header ||
        length !== 13 ||
        view.getUint32(offset + 8) !== width ||
        view.getUint32(offset + 12) !== height ||
        data[8] !== 8 ||
        !(allowGrayscale ? [0, 2, 4, 6] : [2, 6]).includes(data[9]) ||
        data[10] ||
        data[11] ||
        data[12]
      )
        throw new Error('地表 PNG 须为尺寸匹配、非交错的 RGB/RGBA8 图片');
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[data[9]];
      header = true;
    } else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') {
      if (length !== 0 || offset + 12 !== bytes.length) throw new Error('地表 PNG 尾部错误');
      end = true;
      break;
    } else if (type[0] === type[0].toUpperCase()) throw new Error('地表 PNG 包含不支持的关键块');
    offset += length + 12;
  }
  if (!end || !parts.length) throw new Error('地表 PNG 缺少图像数据');
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  const stride = width * channels + 1,
    expected = stride * height;
  const raw = unzlibSync(joined, { out: new Uint8Array(expected) });
  if (raw.length !== expected) throw new Error('地表 PNG 解码长度错误');
  let s1 = 1,
    s2 = 0;
  for (const byte of raw) {
    s1 = (s1 + byte) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const zView = new DataView(joined.buffer);
  if (((s2 << 16) | s1) >>> 0 !== zView.getUint32(joined.length - 4))
    throw new Error('地表 PNG 压缩数据损坏');
  for (let row = 0; row < height; row++)
    if (raw[row * stride] > 4) throw new Error('地表 PNG 过滤类型无效');
  checked.set(bytes, { hash, width, height });
}
