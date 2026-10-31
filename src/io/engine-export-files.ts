import { strToU8 } from 'fflate';
import { imageHash } from './image-validation';
import { readGlb } from './engine-glb';
import type { ExportFile, ImageDescriptor } from './engine-export-types';

export function referenceImageInfo(bytes: Uint8Array, mediaType: string): ImageDescriptor {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mediaType === 'image/png' &&
    bytes.length >= 33 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a
  ) {
    const channels = ({ 0: 1, 2: 3, 6: 4 } as const)[bytes[25] as 0 | 2 | 6];
    if (![8, 16].includes(bytes[24]) || !channels) throw new Error('PNG 颜色或位深不支持');
    return {
      width: view.getUint32(16),
      height: view.getUint32(20),
      bitDepth: bytes[24] as 8 | 16,
      channels,
    };
  }
  if (
    mediaType === 'image/webp' &&
    bytes.length >= 30 &&
    view.getUint32(0) === 0x52494646 &&
    view.getUint32(8) === 0x57454250
  ) {
    const kind = new TextDecoder().decode(bytes.subarray(12, 16));
    if (kind === 'VP8 ')
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
        bitDepth: 8,
        channels: 3,
      };
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        bitDepth: 8,
        channels: bits & 0x10000000 ? 4 : 3,
      };
    }
    if (kind === 'VP8X')
      return {
        width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
        height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
        bitDepth: 8,
        channels: bytes[20] & 16 ? 4 : 3,
      };
  }
  if (mediaType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 255) {
      const marker = bytes[offset + 1],
        size = view.getUint16(offset + 2);
      if ([192, 193, 194].includes(marker) && offset + 9 <= bytes.length)
        return {
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
          bitDepth: 8,
          channels: bytes[offset + 9] === 1 ? 1 : 3,
        };
      if (size < 2) break;
      offset += size + 2;
    }
  }
  throw new Error(`参考贴图格式无效：${mediaType}`);
}

export class EngineFiles {
  readonly bytes: Record<string, Uint8Array> = {};
  readonly entries: ExportFile[] = [];
  add(
    path: string,
    bytes: Uint8Array,
    mediaType: string,
    purpose: ExportFile['purpose'] = 'data',
    extra: Pick<ExportFile, 'binary' | 'image'> = {},
  ) {
    const previous = this.bytes[path];
    const sha256 = imageHash(bytes);
    if (previous) {
      if (imageHash(previous) !== sha256) throw new Error(`导出文件冲突：${path}`);
      return path;
    }
    this.bytes[path] = bytes;
    this.entries.push({ path, purpose, mediaType, byteLength: bytes.length, sha256, ...extra });
    return path;
  }
  json(path: string, value: unknown, purpose: ExportFile['purpose'] = 'data') {
    return this.add(path, strToU8(JSON.stringify(value, null, 2)), 'application/json', purpose);
  }
  binary(path: string, values: Float32Array | Uint32Array | Uint8Array, dimensions: number[]) {
    const componentType =
      values instanceof Float32Array
        ? 'float32'
        : values instanceof Uint32Array
          ? 'uint32'
          : 'uint8';
    const bytes = new Uint8Array(values.byteLength),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) throw new Error(`非有限数组值：${path}`);
      if (componentType === 'float32') view.setFloat32(i * 4, values[i], true);
      else if (componentType === 'uint32') view.setUint32(i * 4, values[i], true);
      else bytes[i] = values[i];
    }
    return this.add(path, bytes, 'application/octet-stream', 'data', {
      binary: {
        componentType,
        byteOrder: componentType === 'uint8' ? 'none' : 'little',
        dimensions,
        elementCount: values.length,
      },
    });
  }
  image(bytes: Uint8Array, mediaType = 'image/png') {
    const extension =
      mediaType === 'image/webp' ? 'webp' : mediaType === 'image/jpeg' ? 'jpg' : 'png';
    return this.add(`textures/${imageHash(bytes)}.${extension}`, bytes, mediaType, 'resource', {
      image: referenceImageInfo(bytes, mediaType),
    });
  }
  modelMaterials(bytes: Uint8Array) {
    const { json, binary } = readGlb(bytes);
    const paths = (json.images ?? []).map((image) => {
      let data: Uint8Array;
      if (image.bufferView !== undefined) {
        const buffer = json.bufferViews[image.bufferView];
        if (
          !buffer ||
          buffer.buffer !== 0 ||
          (buffer.byteOffset ?? 0) + buffer.byteLength > binary.length
        )
          throw new Error('GLB 贴图范围无效');
        data = binary.slice(buffer.byteOffset ?? 0, (buffer.byteOffset ?? 0) + buffer.byteLength);
      } else if (image.uri?.match(/^data:image\/(png|jpeg|webp);base64,/)) {
        data = Uint8Array.from(atob(image.uri.split(',')[1]), (value) => value.charCodeAt(0));
      } else throw new Error('GLB 贴图必须内嵌');
      const mediaType = image.mimeType ?? image.uri!.slice(5, image.uri!.indexOf(';'));
      return this.image(data, mediaType);
    });
    const textures = (json.textures ?? []).map((texture) => {
      const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
      if (source === undefined || !paths[source]) throw new Error('GLB 纹理引用无效');
      return {
        path: paths[source],
        sampler: texture.sampler === undefined ? {} : (json.samplers?.[texture.sampler] ?? {}),
      };
    });
    return this.json(`materials/models/${imageHash(bytes)}.json`, {
      kind: 'reference-model-pbr',
      version: 1,
      materials: json.materials ?? [],
      textures,
    });
  }
}
