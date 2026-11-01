import { beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createDocument } from '../src/core/document';
import { deriveHeights, sampleHeight } from '../src/core/terrain';
import { hexIndex, hexWorld, worldHex } from '../src/core/hex';
import { vegetationFilter } from '../src/core/vegetation';
import { exportCocos, cocosAdapter } from '../src/io/cocos-export';
import { captureSnapshot } from '../src/io/export-adapter';
import { validateEnginePackage, validateExportPath } from '../src/io/engine-export-validation';
import { imageHash } from '../src/io/image-validation';
import { readGlb } from '../src/io/engine-glb';
import { readMap } from '../engine-adapters/cocos/examples/read-map.mjs';

const all = { trees: true, grass: true, water: true, sites: true, logic: true };
const none = { trees: false, grass: false, water: false, sites: false, logic: false };
const json = (files, name) => JSON.parse(strFromU8(files[name]));
const clone = (files) =>
  Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.slice()]));
function refresh(files) {
  const manifest = json(files, 'manifest.json');
  for (const entry of manifest.files)
    if (entry.path !== 'report.json' && files[entry.path]) {
      entry.byteLength = files[entry.path].length;
      entry.sha256 = imageHash(files[entry.path]);
    }
  const report = json(files, 'report.json');
  report.listedBytes = manifest.files
    .filter((entry) => entry.path !== 'report.json')
    .reduce((sum, entry) => sum + entry.byteLength, 0);
  files['report.json'] = strToU8(JSON.stringify(report));
  const entry = manifest.files.find((entry) => entry.path === 'report.json');
  entry.byteLength = files['report.json'].length;
  entry.sha256 = imageHash(files['report.json']);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
}
function fixture() {
  const doc = createDocument(513, 768, 384);
  doc.name = 'v2 矩形地图测试';
  for (let row = 0; row < 513; row++)
    for (let col = 0; col < 513; col++)
      doc.heights[row * 513 + col] = 32 + (col / 512) * 8 + Math.sin(row / 30);
  const factionId = doc.nextId++;
  doc.factions.push({ id: factionId, name: '初始势力', color: '#123456' });
  for (const [kind, assetId, x, z, faction] of [
    ['city', 'city-jade', -90, 10, factionId],
    ['fortress', 'fort-stone', 70, -40, null],
  ]) {
    const site = {
      id: doc.nextId++,
      kind,
      assetId,
      name: kind,
      center: worldHex(doc.grid, { x, z }),
      yaw: 0.3,
      scale: 1.2,
      factionId: faction,
    };
    doc.sites.push(site);
    doc.owners[hexIndex(doc.grid, site.center)] = site.id;
  }
  doc.owners[hexIndex(doc.grid, worldHex(doc.grid, { x: 0, z: 120 }))] = doc.sites[0].id;
  doc.rivers.push({
    id: doc.nextId++,
    name: '河流',
    points: [
      { x: -280, z: -100 },
      { x: 280, z: -100 },
    ],
    width: 18,
    depth: 6,
    waterLevel: 34,
  });
  doc.trees.push(
    { id: doc.nextId++, assetId: 'tree-pine', x: 240, z: 90, yaw: 0.4, scale: 1.1 },
    { id: doc.nextId++, assetId: 'tree-broad', x: 0, z: -100, yaw: 0, scale: 1 },
  );
  doc.grass.push({
    id: doc.nextId++,
    assetId: 'grass-reed',
    density: new Float32Array(doc.heights.length).fill(0.01),
    seed: -1,
    version: 1,
    minScale: 0.8,
    maxScale: 1.2,
    maxSlope: 30,
    wind: 1,
  });
  Object.assign(
    doc.assets.find((asset) => asset.id === 'tree-pine'),
    { scale: 1.3, yaw: 0.2, offset: 0.7 },
  );
  Object.assign(
    doc.assets.find((asset) => asset.id === 'city-jade'),
    { scale: 0.5, yaw: 0.4, offset: 1.5 },
  );
  return doc;
}
function saveFixture(files, suffix) {
  const directory = path.resolve('test-results/tests/engine-export-v2-' + suffix);
  mkdirSync(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  return directory;
}
let doc, files, manifest, directory;
beforeAll(async () => {
  doc = fixture();
  const before = doc.heights.slice();
  const result = await exportCocos(doc, all);
  expect(doc.heights).toEqual(before);
  files = unzipSync(result.bytes);
  manifest = json(files, 'manifest.json');
  directory = saveFixture(files, 'fixture');
  writeFileSync('test-results/tests/engine-export-v2.zip', result.bytes);
}, 120000);

describe('v2 实际数据包与独立读取', () => {
  it('默认正式导出，唯一数据入口，附带协议、独立读取示例而不包含场景生成器', () => {
    expect(validateEnginePackage(files)).toEqual(manifest);
    expect(manifest.exportVersion).toBe(2);
    expect(manifest.options.mode).toBe('production');
    expect(manifest.validation).toEqual({
      package: 'passed',
      import: 'not-run',
      engine: 'not-run',
    });
    expect(manifest.requiredCapabilities).not.toContain('grass-wind@1');
    expect(manifest.omissions).toEqual([]);
    expect(files['protocol/engine-export-v2.schema.json']).toBeDefined();
    expect(files['examples/read-map.mjs']).toBeDefined();
    expect(
      Object.keys(files).some(
        (name) =>
          name.startsWith('assets/') || name.includes('scene.cjs') || name.endsWith('.scene'),
      ),
    ).toBe(false);
    expect(manifest.files).toHaveLength(Object.keys(files).length - 1);
    expect(new Set(manifest.files.map((entry) => entry.path)).size).toBe(manifest.files.length);
  });
  it('独立脚本还原矩形地形三角面高度、据点和逐格初始势力', async () => {
    const map = await readMap(directory),
      expected = deriveHeights(doc);
    expect(map.heights).toEqual(expected);
    for (const [x, z] of [
      [-384, -192],
      [384, 192],
      [0.31, -100.2],
      [100.2, 45.3],
      [-62.8, 45.8],
    ])
      expect(map.getHeight(x, z)).toBeCloseTo(sampleHeight(doc, expected, x, z), 5);
    expect(map.owners).toEqual(doc.owners);
    for (let i = 0; i < doc.owners.length; i++) {
      const r = Math.floor(i / doc.grid.columns),
        q = (i % doc.grid.columns) - Math.floor(r / 2);
      expect(map.getCellOwner(q, r)?.id ?? 0).toBe(doc.owners[i]);
      const site = doc.sites.find((site) => site.id === doc.owners[i]);
      expect(map.getCellFaction(q, r)?.id ?? null).toBe(site?.factionId ?? null);
    }
    expect(map.getCellOwner(-9999, 0)).toBeNull();
    expect(() => map.getHeight(NaN, 0)).toThrow();
    expect(map.rivers[0].name).toBe('河流');
    expect(map.densities.get(doc.grass[0].id)).toEqual(doc.grass[0].density);
  });
  it('实例只合成一次默认变换，过滤树木不影响原地图，原始模型及贴图可独立使用', () => {
    const heights = deriveHeights(doc),
      valid = vegetationFilter(doc, heights);
    const trees = json(files, manifest.entries.trees),
      sites = json(files, manifest.entries.sites),
      models = json(files, manifest.entries.models);
    expect(trees).toHaveLength(doc.trees.filter((tree) => valid(tree, 30)).length);
    expect(trees).toHaveLength(1);
    expect(doc.trees).toHaveLength(2);
    const source = doc.trees[0],
      asset = doc.assets.find((asset) => asset.id === source.assetId);
    expect(trees[0]).toEqual({
      id: source.id,
      assetId: source.assetId,
      position: [
        source.x,
        sampleHeight(doc, heights, source.x, source.z) + asset.offset * source.scale,
        source.z,
      ],
      yaw: source.yaw + asset.yaw,
      scale: source.scale * asset.scale,
    });
    const city = doc.sites[0],
      point = hexWorld(doc.grid, city.center),
      visual = sites.find((site) => site.id === city.id);
    expect(visual.position[1]).toBe(
      sampleHeight(doc, heights, point.x, point.z) + 1.5 * city.scale,
    );
    expect(visual.yaw).toBeCloseTo(0.7);
    expect(visual.scale).toBeCloseTo(0.6);
    const pine = models.find((asset) => asset.id === 'tree-pine');
    expect(files[pine.path]).toEqual(
      new Uint8Array(readFileSync('editor-assets/models/pine-tree.glb')),
    );
    expect(models.some((asset) => asset.id === 'tree-broad')).toBe(false);
    const description = json(files, pine.material);
    expect(description.materials).toHaveLength(5);
    expect(description.textures.length).toBeGreaterThan(0);
    for (const texture of description.textures) expect(files[texture.path]).toBeDefined();
    const centered = readGlb(files[models.find((asset) => asset.id === 'city-jade').path]);
    expect(centered.json.nodes.at(-1).translation[1]).toBe(0);
    expect(Object.keys(visual).sort()).toEqual(['assetId', 'id', 'position', 'scale', 'yaw']);
    expect(JSON.stringify(json(files, 'logic/logic.json'))).not.toMatch(/uuid|prefab/i);
  });
  it('独立读取脚本不依赖编辑器或 Cocos API，损坏文件被拒绝', async () => {
    expect(strFromU8(files['examples/read-map.mjs'])).not.toMatch(/from ['"](?:cc|.*src\/)/);
    const broken = clone(files);
    broken['terrain/final.f32'][0] ^= 1;
    await expect(readMap(saveFixture(broken, 'corrupt'))).rejects.toThrow('哈希');
  });
  it('只导出草时仍保留水域和据点排除依赖，不附带逻辑或据点模型', async () => {
    const result = await exportCocos(doc, { ...none, grass: true });
    const pack = unzipSync(result.bytes),
      info = validateEnginePackage(pack),
      grass = json(pack, info.entries.grass);
    expect(info.entries.water).toBeNull();
    expect(info.entries.logic).toBeNull();
    expect(info.entries.sites).toBeNull();
    expect(json(pack, 'models/index.json').map((asset) => asset.kind)).toEqual(['grass']);
    expect(json(pack, grass.exclusions).sites).toHaveLength(2);
    expect(json(pack, 'water/rivers.json')).toHaveLength(1);
    expect(grass.layers[0].seed).toBe(4294967295);
    expect(pack['water/water.glb']).toBeUndefined();
  }, 120000);
  it('逻辑与视觉开关独立，逻辑资源可仅保留索引描述', async () => {
    const result = await exportCocos(doc, { ...none, logic: true });
    const pack = unzipSync(result.bytes),
      info = validateEnginePackage(pack);
    expect(info.entries.sites).toBeNull();
    expect(
      json(pack, info.entries.models).every(
        (asset) => !asset.included && asset.path === null && asset.material === null,
      ),
    ).toBe(true);
    expect(json(pack, info.entries.logic).sites).toHaveLength(2);
    expect(
      Object.keys(pack).some((name) => name.startsWith('models/') && name.endsWith('.glb')),
    ).toBe(false);
  }, 120000);
  it('空内容合法，水面没有伪造网格或空二进制；1025² 仍为单片地形', async () => {
    const empty = createDocument(1025, 384, 768);
    const result = await exportCocos(empty, all),
      pack = unzipSync(result.bytes),
      info = validateEnginePackage(pack);
    expect(json(pack, info.entries.water).mesh).toBeNull();
    expect(json(pack, info.entries.water).primitives).toEqual([]);
    expect(json(pack, info.entries.models)).toEqual([]);
    expect(readGlb(pack['terrain/terrain.glb']).json.meshes).toHaveLength(1);
    expect(
      info.files.find((entry) => entry.path === 'terrain/final.f32').binary.dimensions,
    ).toEqual([1025, 1025]);
  }, 120000);
  it('独立快照不被导出期间的新编辑修改，未知目标和模型哈希错误拒绝', async () => {
    const input = fixture(),
      captured = captureSnapshot(input);
    input.heights.fill(100);
    input.sites[0].name = '新编辑';
    expect(captured.document.sites[0].name).toBe('city');
    const result = await cocosAdapter.export(captured, none),
      pack = unzipSync(result.bytes);
    expect(new DataView(pack['terrain/final.f32'].buffer).getFloat32(0, true)).not.toBe(100);
    await expect(exportCocos(input, { ...all, target: 'unknown-engine' })).rejects.toThrow(
      'E_TARGET',
    );
    captured.document.assets.find((asset) => asset.id === 'tree-pine').hash = '0'.repeat(64);
    await expect(cocosAdapter.export(captured, all)).rejects.toThrow('E_HASH');
  }, 120000);
});

describe('包级失败保护', () => {
  it('拒绝 GLB 非有限顶点和 JSON BOM，不把重算哈希当成数据有效', () => {
    const badGeometry = clone(files);
    const glb = readGlb(badGeometry['terrain/terrain.glb']);
    const accessor = glb.json.accessors[glb.json.meshes[0].primitives[0].attributes.POSITION];
    const offset = glb.json.bufferViews[accessor.bufferView].byteOffset ?? 0;
    new DataView(glb.binary.buffer, glb.binary.byteOffset, glb.binary.byteLength).setFloat32(
      offset,
      NaN,
      true,
    );
    refresh(badGeometry);
    expect(() => validateEnginePackage(badGeometry)).toThrow('E_ARRAY');
    const badJson = clone(files);
    const text = badJson['manifest.json'];
    badJson['manifest.json'] = new Uint8Array(text.length + 3);
    badJson['manifest.json'].set([239, 187, 191]);
    badJson['manifest.json'].set(text, 3);
    expect(() => validateEnginePackage(badJson)).toThrow('E_SCHEMA');
  });
  it.each(['../bad', 'terrain/CON.txt', 'terrain/foo.', 'C:/bad', 'terrain\\bad', 'terrain//bad'])(
    '拒绝非法路径 %s',
    (name) => expect(() => validateExportPath(name)).toThrow('E_PATH'),
  );
  it.each([
    [
      '文件缺失',
      (pack) => {
        delete pack['terrain/final.f32'];
      },
      'E_REFERENCE',
    ],
    [
      '字节损坏',
      (pack) => {
        pack['terrain/final.f32'][0] ^= 1;
      },
      'E_HASH',
    ],
    [
      '未列入清单',
      (pack) => {
        pack['extra.json'] = strToU8('{}');
      },
      'E_REFERENCE',
    ],
    [
      '非有限高度',
      (pack) => {
        new DataView(pack['terrain/final.f32'].buffer).setFloat32(0, NaN, true);
        refresh(pack);
      },
      'E_ARRAY',
    ],
    [
      '权重未归一化',
      (pack) => {
        pack['terrain/surface.rgba'].fill(0, 0, 4);
        refresh(pack);
      },
      'E_ARRAY',
    ],
    [
      'PNG16 与高度不符',
      (pack) => {
        new DataView(pack['terrain/final.f32'].buffer).setFloat32(0, 50, true);
        refresh(pack);
      },
      'E_ARRAY',
    ],
    [
      '错误 owner',
      (pack) => {
        new DataView(pack['logic/owners.u32'].buffer).setUint32(0, 999999, true);
        refresh(pack);
      },
      'E_REFERENCE',
    ],
    [
      '中心保护错误',
      (pack) => {
        new DataView(pack['logic/owners.u32'].buffer).setUint32(
          hexIndex(doc.grid, doc.sites[0].center) * 4,
          0,
          true,
        );
        refresh(pack);
      },
      'E_CENTER_OWNER',
    ],
    [
      '失效资源引用',
      (pack) => {
        const trees = json(pack, 'instances/trees.json');
        trees[0].assetId = 'missing';
        pack['instances/trees.json'] = strToU8(JSON.stringify(trees));
        refresh(pack);
      },
      'E_REFERENCE',
    ],
    [
      '失效势力引用',
      (pack) => {
        const logic = json(pack, 'logic/logic.json');
        logic.sites[0].factionId = 999;
        pack['logic/logic.json'] = strToU8(JSON.stringify(logic));
        refresh(pack);
      },
      'E_REFERENCE',
    ],
    [
      '水面顶点数不符',
      (pack) => {
        const water = json(pack, 'water/water.json');
        water.primitives[0].vertexCount++;
        pack['water/water.json'] = strToU8(JSON.stringify(water));
        refresh(pack);
      },
      'E_REFERENCE',
    ],
    [
      '重复 JSON 键',
      (pack) => {
        pack['models/index.json'] = strToU8('[{"id":"a","id":"b"}]');
        refresh(pack);
      },
      'E_SCHEMA',
    ],
    [
      '未知算法',
      (pack) => {
        const value = json(pack, 'manifest.json');
        value.algorithms.waterFlow = 2;
        pack['manifest.json'] = strToU8(JSON.stringify(value));
      },
      'E_SCHEMA',
    ],
    [
      '旧版本',
      (pack) => {
        const value = json(pack, 'manifest.json');
        value.exportVersion = 1;
        pack['manifest.json'] = strToU8(JSON.stringify(value));
      },
      'E_SCHEMA',
    ],
  ])('拒绝%s', (_, change, code) => {
    const broken = clone(files);
    change(broken);
    expect(() => validateEnginePackage(broken)).toThrow(code);
  });
});
