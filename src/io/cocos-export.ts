import { Color } from 'three';
import { zipSync, strToU8 } from 'fflate';
import type { MapDocument } from '../core/types';
import { validateDocument } from '../core/document';
import { hexWorld } from '../core/hex';
import { riverWaterMeshes } from '../core/river-water';
import { createRiverFlowSampler } from '../core/river-flow';
import { sampleHeight } from '../core/terrain';
import { vegetationFilter } from '../core/vegetation';
import { encodeHeightPng } from './heightmap';
import { imageHash } from './image-validation';
import { centerSiteGlb, meshGlb } from './engine-glb';
import { EngineFiles } from './engine-export-files';
import { validateEnginePackage } from './engine-export-validation';
import { captureSnapshot, ExportRegistry } from './export-adapter';
import type { ExportAdapter, ExportOptions, ExportSnapshot } from './export-adapter';
import type {
  EngineManifest,
  ExportInstance,
  ExportIssue,
  ExportReport,
  ModelDescription,
  WaterDescription,
} from './engine-export-types';
import contract from '../../.agent/docs/contracts/engine-export-v2.schema.json';

const referenceSources = import.meta.glob(
  '../../engine-adapters/cocos/{README.md,examples/*.mjs,examples/package.json}',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

export function preflightCocos(doc: MapDocument): string[] {
  validateDocument(doc);
  return [
    `协议 v2：${doc.settings.samples}² 单片地形、最终高度、PNG16 和四通道地表权重。`,
    `树木 ${doc.trees.length} 株、草层 ${doc.grass.length} 个、据点 ${doc.sites.length} 座、势力 ${doc.factions.length} 个；按所选内容导出。`,
    'JSON 数据通过稳定 ID 引用模型；附带原始模型、独立贴图和可读材质参数，游戏可自行替换。',
    '游戏负责加载、配置和呈现；不生成游戏场景，不要求还原编辑器专有材质效果。',
    '数据包会执行结构、文件、数组和引用校验；真实 Cocos 导入与运行尚未验收。',
  ];
}

async function run(snapshot: ExportSnapshot, input: ExportOptions) {
  const options: EngineManifest['options'] = {
    target: 'cocos-creator-3.8',
    mode: 'production',
    ...input,
  };
  if (options.target !== 'cocos-creator-3.8') throw new Error('E_TARGET：未实现此导出目标');
  const doc = snapshot.document,
    heights = snapshot.finalHeights,
    n = doc.settings.samples;
  validateDocument(doc);
  const files = new EngineFiles();
  const positions = new Float32Array(n * n * 3),
    colors = new Float32Array(n * n * 3),
    uvs = new Float32Array(n * n * 2),
    indices = new Uint32Array((n - 1) ** 2 * 6);
  const palette = [0x71835a, 0x958360, 0x88918a, 0xc2b182].map((value) => new Color(value));
  let cursor = 0;
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      positions.set(
        [
          (col / (n - 1) - 0.5) * doc.settings.width,
          heights[i],
          (row / (n - 1) - 0.5) * doc.settings.depth,
        ],
        i * 3,
      );
      uvs.set([col / (n - 1), 1 - row / (n - 1)], i * 2);
      for (let c = 0; c < 4; c++) {
        const weight = doc.surface[i * 4 + c] / 255;
        colors[i * 3] += palette[c].r * weight;
        colors[i * 3 + 1] += palette[c].g * weight;
        colors[i * 3 + 2] += palette[c].b * weight;
      }
      if (row < n - 1 && col < n - 1) {
        indices.set([i, i + n, i + 1, i + 1, i + n, i + n + 1], cursor);
        cursor += 6;
      }
    }
  files.add(
    'terrain/terrain.glb',
    meshGlb([{ name: 'ContinuousTerrain', positions, uvs, indices, colors }]),
    'model/gltf-binary',
    'resource',
  );
  files.binary('terrain/final.f32', heights, [n, n]);
  files.binary('terrain/surface.rgba', doc.surface, [n, n, 4]);
  const heightPng = encodeHeightPng(heights, n, n, doc.settings.minHeight, doc.settings.maxHeight);
  files.add('terrain/height16.png', heightPng, 'image/png', 'resource', {
    image: { width: n, height: n, bitDepth: 16, channels: 1 },
  });
  files.json('terrain/height16.terrain.json', {
    width: doc.settings.width,
    depth: doc.settings.depth,
    samplesX: n,
    samplesZ: n,
    minHeight: doc.settings.minHeight,
    maxHeight: doc.settings.maxHeight,
    origin: [-doc.settings.width / 2, 0, -doc.settings.depth / 2],
    unit: 'meter',
    heightEncoding: 'grayscale16',
    imageRight: '+X',
    imageDown: '+Z',
    includesRiverbed: true,
  });
  const surface = doc.surfaceMaterial;
  files.json('materials/surface.json', {
    kind: 'surface-four-layer',
    version: 1,
    layers: surface.layers.map((layer) => ({
      id: layer.id,
      meters: layer.meters,
      color: { path: files.image(layer.color.bytes!), colorSpace: 'srgb' },
      normal: { path: files.image(layer.normal.bytes!), colorSpace: 'linear' },
    })),
    scale: surface.scale,
    detail: surface.detail,
    slopeRock: surface.slopeRock,
    sampler: {
      wrap: 'repeat',
      minFilter: 'linear-mipmap-linear',
      magFilter: 'linear',
      anisotropy: 4,
    },
  });
  files.json('terrain/terrain.json', {
    mesh: 'terrain/terrain.glb',
    heights: 'terrain/final.f32',
    surface: 'terrain/surface.rgba',
    heightmap: 'terrain/height16.png',
    heightMetadata: 'terrain/height16.terrain.json',
    material: 'materials/surface.json',
  });
  const valid = vegetationFilter(doc, heights);
  const transform = (
    id: number,
    assetId: string,
    x: number,
    z: number,
    yaw: number,
    scale: number,
  ): ExportInstance => {
    const asset = doc.assets.find((asset) => asset.id === assetId)!;
    return {
      id,
      assetId,
      position: [x, sampleHeight(doc, heights, x, z) + asset.offset * scale, z],
      yaw: yaw + asset.yaw,
      scale: scale * asset.scale,
    };
  };
  const trees = options.trees
    ? doc.trees
        .filter((tree) => valid(tree, tree.maxSlope ?? 30))
        .map((tree) => transform(tree.id, tree.assetId, tree.x, tree.z, tree.yaw, tree.scale))
    : [];
  const sites = options.sites
    ? doc.sites.map((site) => {
        const point = hexWorld(doc.grid, site.center);
        return transform(site.id, site.assetId, point.x, point.z, site.yaw, site.scale);
      })
    : [];
  if (options.trees) files.json('instances/trees.json', trees);
  if (options.sites) files.json('instances/sites.json', sites);
  const refs = new Set([...trees, ...sites].map((instance) => instance.assetId));
  if (options.grass) doc.grass.forEach((layer) => refs.add(layer.assetId));
  const described = new Set(refs);
  if (options.logic) doc.sites.forEach((site) => described.add(site.assetId));
  const models: ModelDescription[] = [];
  for (const asset of doc.assets.filter((asset) => described.has(asset.id))) {
    let path: string | null = null,
      material: string | null = null;
    if (refs.has(asset.id)) {
      const source = asset.bytes!;
      if (imageHash(source) !== asset.hash)
        throw new Error(`E_HASH：模型 ${asset.id} 内容与哈希不符`);
      const bytes =
        asset.kind === 'city' || asset.kind === 'fortress' ? centerSiteGlb(source) : source;
      path = files.add(`models/${imageHash(bytes)}.glb`, bytes, 'model/gltf-binary', 'resource');
      material = files.modelMaterials(bytes);
    }
    models.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      size: [...asset.size],
      source: asset.source,
      included: path !== null,
      path,
      material,
    });
  }
  files.json('models/index.json', models);
  if (options.logic) {
    files.binary('logic/owners.u32', doc.owners, [doc.grid.rows, doc.grid.columns]);
    files.json('logic/logic.json', {
      sites: doc.sites.map(({ id, kind, name, assetId, center, factionId }) => ({
        id,
        kind,
        name,
        assetId,
        center,
        factionId,
      })),
      factions: doc.factions,
      owners: 'logic/owners.u32',
    });
  }
  const rivers = doc.rivers.map((river) => ({
    ...river,
    interpolation: river.interpolation ?? 'catmull-rom',
    clipped: river.clipped ?? false,
  }));
  if (options.water || options.grass) files.json('water/rivers.json', rivers);
  if (options.grass) {
    const layers = doc.grass.map(({ density, version, ...layer }) => {
      const asset = doc.assets.find((asset) => asset.id === layer.assetId)!;
      return {
        ...layer,
        seed: layer.seed >>> 0,
        generatorVersion: version,
        density: files.binary(`grass/${layer.id}.f32`, density, [n, n]),
        modelTransform: { yaw: asset.yaw, scale: asset.scale, offset: asset.offset },
      };
    });
    files.json('grass/layers.json', { layers, exclusions: 'grass/exclusions.json' });
    files.json('grass/exclusions.json', {
      sites: doc.sites.map((site) => {
        const asset = doc.assets.find((asset) => asset.id === site.assetId)!,
          point = hexWorld(doc.grid, site.center);
        return {
          center: [point.x, point.z],
          halfX: (asset.size[0] * asset.scale * site.scale) / 2 + 2,
          halfZ: (asset.size[2] * asset.scale * site.scale) / 2 + 2,
          yaw: site.yaw + asset.yaw,
        };
      }),
      rivers: 'water/rivers.json',
    });
  }
  if (options.water) {
    const water: WaterDescription = {
      rivers: 'water/rivers.json',
      mesh: null,
      material: 'materials/water.json',
      primitives: [],
    };
    const sampleFlow = createRiverFlowSampler(doc.rivers),
      widths = new Map(doc.rivers.map((river) => [river.id, river.width]));
    const meshes = riverWaterMeshes(doc.rivers, doc.settings, 4).filter(
      (mesh) => mesh.positions.length,
    );
    for (const [index, mesh] of meshes.entries()) {
      const count = mesh.positions.length / 3,
        depth = new Float32Array(count),
        shore = new Float32Array(count),
        flow = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const x = mesh.positions[i * 3],
          y = mesh.positions[i * 3 + 1],
          z = mesh.positions[i * 3 + 2];
        depth[i] = Math.max(0, y - sampleHeight(doc, heights, x, z));
        shore[i] = (mesh.shoreDistances[i] * widths.get(mesh.riverId)!) / 2;
        const direction = sampleFlow({ x, z }, y);
        flow.set([direction.x, direction.z], i * 2);
      }
      water.primitives.push({
        nodeName: `Water_${index}`,
        meshIndex: index,
        primitiveIndex: 0,
        vertexCount: count,
        depth: files.binary(`water/${index}-depth.f32`, depth, [count]),
        shore: files.binary(`water/${index}-shore.f32`, shore, [count]),
        flow: files.binary(`water/${index}-flow.f32`, flow, [count, 2]),
      });
    }
    if (meshes.length)
      water.mesh = files.add(
        'water/water.glb',
        meshGlb(
          meshes.map((mesh, index) => ({
            name: `Water_${index}`,
            positions: new Float32Array(mesh.positions),
            uvs: new Float32Array(mesh.uvs),
          })),
          true,
        ),
        'model/gltf-binary',
        'resource',
      );
    files.json('water/water.json', water);
    files.json('materials/water.json', {
      kind: 'river-water',
      version: 1,
      normal: {
        path: files.image(doc.waterMaterial.normal.bytes!),
        colorSpace: 'linear',
      },
      mask: {
        path: files.image(doc.waterMaterial.mask.bytes!),
        colorSpace: 'linear',
      },
      shallowColor: new Color(0x65968b).toArray(),
      deepColor: new Color(0x315565).toArray(),
      skyColor: new Color(0xb2c8cb).toArray(),
      roughness: doc.waterMaterial.material.roughness,
      opacity: doc.waterMaterial.material.opacity,
      metalness: doc.waterMaterial.material.metalness,
      flowSpeed: 0.8,
      phaseSeconds: 12,
    });
  }
  files.json('protocol/engine-export-v2.schema.json', contract, 'tooling');
  for (const [path, contents] of Object.entries(referenceSources)) {
    const relative = path.split('/engine-adapters/cocos/')[1];
    files.add(
      relative,
      strToU8(contents),
      relative.endsWith('.mjs')
        ? 'text/javascript'
        : relative.endsWith('.json')
          ? 'application/json'
          : 'text/plain',
      'tooling',
    );
  }
  const issues: ExportIssue[] = [
    {
      code: 'I_REFERENCE_ASSETS',
      severity: 'info',
      stage: 'capabilities',
      message:
        '模型、贴图与材质参数为可替换参考资源；游戏自行实现呈现，不要求复刻编辑器专有光影或动画。',
      path: null,
      objectId: null,
      capability: null,
    },
  ];
  const details: ExportReport = {
    mode: options.mode,
    issues,
    counts: {
      files: files.entries.length + 1,
      models: models.filter((model) => model.included).length,
      trees: trees.length,
      sites: sites.length,
      grassLayers: options.grass ? doc.grass.length : 0,
      rivers: options.water || options.grass ? rivers.length : 0,
      logicCells: options.logic ? doc.owners.length : 0,
    },
    listedBytes: files.entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    validation: { package: 'passed', import: 'not-run', engine: 'not-run' },
  };
  files.json('report.json', details, 'diagnostic');
  const { samples: _samples, ...settings } = doc.settings;
  const manifest: EngineManifest = {
    packageKind: 'map3d-engine-export',
    exportVersion: 2,
    name: doc.name,
    source: { projectFormatVersion: doc.formatVersion, generatorVersion: doc.generatorVersion },
    adapter: { id: options.target, version: '0.2.0', engine: 'Cocos Creator 3.8 LTS' },
    algorithms: { terrainSampling: 1, grassGenerator: 1, waterGeometry: 1, waterFlow: 1 },
    coordinates: {
      handedness: 'right',
      up: 'Y',
      unit: 'meter',
      imageRight: '+X',
      imageDown: '+Z',
      origin: 'map-center',
      arrayOrder: 'row-major',
      angleUnit: 'radian',
    },
    map: { ...settings, samplesX: n, samplesZ: n, grid: doc.grid },
    options,
    entries: {
      terrain: 'terrain/terrain.json',
      models: 'models/index.json',
      trees: options.trees ? 'instances/trees.json' : null,
      sites: options.sites ? 'instances/sites.json' : null,
      grass: options.grass ? 'grass/layers.json' : null,
      water: options.water ? 'water/water.json' : null,
      logic: options.logic ? 'logic/logic.json' : null,
    },
    files: files.entries,
    requiredCapabilities: [
      'continuous-terrain@1',
      ...(models.some((model) => model.included) ? ['static-model-pbr@1'] : []),
      ...(options.grass && doc.grass.length ? ['grass-generator@1'] : []),
      ...(options.logic ? ['hex-owners@1'] : []),
    ],
    omissions: [],
    validation: details.validation,
  };
  files.bytes['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  validateEnginePackage(files.bytes);
  const bytes = zipSync(files.bytes, { level: 6 });
  if (bytes.length > 256 * 1024 * 1024) throw new Error('E_BUDGET：导出 ZIP 超过 256 MiB');
  return {
    bytes,
    report: [
      `v2 数据包校验通过：${details.counts.files} 个清单文件，${details.counts.models} 种参考模型，${trees.length} 株有效树木。`,
      ...preflightCocos(doc).slice(2),
    ],
    details,
  };
}
export const cocosAdapter: ExportAdapter = {
  id: 'cocos-creator-3.8',
  label: 'Cocos Creator 3.8 LTS',
  export: run,
};
export const exportRegistry = new ExportRegistry();
exportRegistry.register(cocosAdapter);
export async function exportCocos(doc: MapDocument, options: ExportOptions) {
  return exportRegistry.get('cocos-creator-3.8').export(captureSnapshot(doc), options);
}
