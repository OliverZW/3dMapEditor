import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createDocument, validateDocument } from '../src/core/document';
import { snapshot } from '../src/core/history';
import { applySurfaceBrush } from '../src/core/terrain';
import { DEFAULT_BRUSH } from '../src/core/types';
import { EditorSession } from '../src/application/editor-session';
import { encodeProject, decodeProject } from '../src/io/project';
import { imageHash, validateSurfacePng } from '../src/io/image-validation';
import { prepareSurfaceDocument } from '../src/io/surface-resources';
import { encodeProjectFiles, decodeProjectFiles } from '../src/io/project-codec';
import { resourcePath } from '../src/io/project-resources';

describe('四层地表材质、历史与工程 v4', () => {
  it('图片 SHA-256 与标准向量一致', () => {
    expect(imageHash(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('四层固定顺序、预算及显示参数受校验，预设图片可完整解码', () => {
    const doc = prepareSurfaceDocument(createDocument());
    expect(doc.surfaceMaterial.layers.map((layer) => layer.id)).toEqual([
      'grass',
      'soil',
      'rock',
      'sand',
    ]);
    expect(doc.surfaceMaterial.layers.map((layer) => layer.meters)).toEqual([16, 16, 32, 24]);
    for (const layer of doc.surfaceMaterial.layers)
      for (const kind of ['color', 'normal'] as const) {
        const image = layer[kind];
        expect(image.bytes!.length).toBeGreaterThan(1000);
        expect(() =>
          validateSurfacePng(image.bytes!, image.hash, image.width, image.height),
        ).not.toThrow();
      }
    const invalid = snapshot(doc);
    invalid.surfaceMaterial.scale = NaN;
    expect(() => validateDocument(invalid)).toThrow('材质');
    invalid.surfaceMaterial.scale = 1;
    invalid.surfaceMaterial.layers.forEach((layer) => {
      layer.color.width = 4096;
      layer.color.height = 4096;
    });
    expect(() => validateDocument(invalid)).toThrow('尺寸');
  });
  it('一轮连续调参只提交一条历史，预览取消不修改文档，撤销重做保持权重和高度', () => {
    const session = new EditorSession();
    const heights = session.doc.heights.slice(),
      surface = session.doc.surface.slice();
    session.previewSurface({ scale: 1.5 });
    session.previewSurface({ scale: 2 });
    expect(session.doc.surfaceMaterial.scale).toBe(1);
    expect(session.history.canUndo).toBe(false);
    session.commitSurface();
    expect(session.doc.surfaceMaterial.scale).toBe(2);
    session.undo();
    expect(session.doc.surfaceMaterial.scale).toBe(1);
    expect(session.history.canUndo).toBe(false);
    session.redo();
    expect(session.doc.surfaceMaterial.scale).toBe(2);
    session.previewSurface({ detail: 1, slopeRock: false });
    session.cancelSurface();
    expect(session.doc.surfaceMaterial.detail).toBe(0.25);
    expect(session.doc.heights).toEqual(heights);
    expect(session.doc.surface).toEqual(surface);
  });
  it('过期参数预览不能写入新工程或覆盖较新编辑', () => {
    const session = new EditorSession();
    session.previewSurface({ scale: 3 });
    session.newMap(513, 512, 256);
    session.commitSurface();
    expect(session.doc.surfaceMaterial.scale).toBe(1);
    session.previewSurface({ scale: 3 });
    session.change('较新编辑', (doc) => {
      doc.name = '较新地图';
    });
    session.commitSurface();
    expect(session.doc.surfaceMaterial.scale).toBe(1);
  });
  it('工程材质可用于四层，撤销重做和目录、备份往返保持权重与资源', () => {
    const session = new EditorSession();
    const weights = session.doc.surface.slice();
    const original = session.doc.surfaceMaterial.layers[0];
    const projectImage = (image: typeof original.color) => ({
      ...image,
      resource: { origin: 'project' as const, path: resourcePath(image.hash, false) },
    });
    const asset = {
      id: 'surface-test',
      name: '自定义地面',
      meters: 23,
      color: projectImage(original.color),
      normal: projectImage(original.normal),
    };
    session.previewSurfaceLayer(0, asset);
    expect(session.doc.surfaceMaterial.layers[0].name).not.toBe(asset.name);
    expect(session.history.canUndo).toBe(false);
    session.cancelSurfaceLayer();
    expect(session.surfaceLayerPreview).toBeNull();
    session.change('导入并使用材质', (doc) => {
      doc.surfaceMaterial.library = [asset];
      doc.surfaceMaterial.layers = doc.surfaceMaterial.layers.map((layer) => ({
        ...layer,
        ...asset,
        id: layer.id,
        materialId: asset.id,
      }));
    });
    expect(session.error).toBe('');
    expect(session.doc.surface).toEqual(weights);
    session.undo();
    expect(session.doc.surfaceMaterial.library).toBeUndefined();
    session.redo();
    expect(session.doc.surfaceMaterial.layers.every((layer) => layer.materialId === asset.id)).toBe(
      true,
    );
    const files = encodeProjectFiles(session.doc);
    expect(files[resourcePath(asset.color.hash, false)]).toBeDefined();
    const restored = decodeProjectFiles(files, session.doc.name);
    expect(restored.surfaceMaterial.library?.[0].meters).toBe(23);
    expect(restored.surface).toEqual(weights);
    const backup = decodeProject(encodeProject(session.doc));
    expect(backup.surfaceMaterial.layers.map((layer) => layer.materialId)).toEqual(
      Array(4).fill(asset.id),
    );
    expect(backup.surfaceMaterial.library?.[0].color.bytes).toEqual(asset.color.bytes);
    expect(backup.surface).toEqual(weights);
  }, 120000);
  it('四种画刷不改高度，权重归一化，手绘覆盖不依赖自动显岩', () => {
    const doc = createDocument(),
      heights = doc.heights.slice();
    for (let surfaceLayer = 0; surfaceLayer < 4; surfaceLayer++) {
      applySurfaceBrush(doc, { x: 0, z: 0 }, { ...DEFAULT_BRUSH, surfaceLayer, strength: 1 });
      expect(doc.surface[256 * 513 * 4 + 256 * 4 + surfaceLayer]).toBe(255);
    }
    for (let i = 0; i < doc.surface.length; i += 4)
      expect(doc.surface[i] + doc.surface[i + 1] + doc.surface[i + 2] + doc.surface[i + 3]).toBe(
        255,
      );
    expect(doc.heights).toEqual(heights);
  });
  it('v4 包内包含地表和水面图片，往返保留字节和参数，缺失或损坏资源拒绝', () => {
    const doc = createDocument();
    doc.surfaceMaterial.scale = 2;
    doc.surfaceMaterial.detail = 0.5;
    doc.surfaceMaterial.slopeRock = false;
    const files = unzipSync(encodeProject(doc));
    const images = Object.keys(files).filter((name) => name.startsWith('assets/textures/'));
    expect(images).toHaveLength(10);
    const candidate = decodeProject(zipSync(files, { level: 0 }));
    expect(candidate.formatVersion).toBe(3);
    expect(candidate.surfaceMaterial.scale).toBe(2);
    expect(candidate.surfaceMaterial.detail).toBe(0.5);
    expect(candidate.surfaceMaterial.slopeRock).toBe(false);
    expect(candidate.surface).toEqual(doc.surface);
    const layer = candidate.surfaceMaterial.layers[0];
    expect(imageHash(layer.color.bytes!)).toBe(layer.color.hash);
    const name = images[0],
      original = files[name];
    delete files[name];
    expect(() => decodeProject(zipSync(files, { level: 0 }))).toThrow('缺少');
    files[name] = original.slice();
    files[name][50] ^= 1;
    expect(() => decodeProject(zipSync(files, { level: 0 }))).toThrow('哈希');
  }, 20000);
  it.each([1, 2, 3])('拒绝旧版 v%i，不迁移或补齐数据', (version) => {
    const files = unzipSync(encodeProject(createDocument()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.formatVersion = version;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeProject(zipSync(files))).toThrow('不兼容旧版');
  });
  it('损坏候选工程不会切换当前地图，错误图片尺寸及路径受校验', () => {
    const session = new EditorSession(),
      current = session.doc,
      invalid = snapshot(current);
    invalid.surfaceMaterial.layers[0].color = {
      ...invalid.surfaceMaterial.layers[0].color,
      bytes: new Uint8Array(40),
    };
    expect(() => session.replace(invalid)).toThrow('地表');
    expect(session.doc).toBe(current);
    const image = current.surfaceMaterial.layers[0].color;
    expect(() => validateSurfacePng(image.bytes!, image.hash, 512, 1024)).toThrow('尺寸');
  });
});
