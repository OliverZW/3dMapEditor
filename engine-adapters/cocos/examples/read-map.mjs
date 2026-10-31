// 独立 Node.js 读取示例：不导入编辑器源码，不创建任何引擎场景或节点。
import { readFile, realpath, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';

export async function readMap(directory) {
  const root = await realpath(directory);
  const safePath = async (name) => {
    if (
      typeof name !== 'string' ||
      name.length > 240 ||
      /\s/.test(name) ||
      !/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name) ||
      name
        .split('/')
        .some(
          (part) =>
            part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw Error(`非法路径：${name}`);
    let file = root;
    for (const part of name.split('/')) {
      file = path.join(file, part);
      if ((await lstat(file)).isSymbolicLink()) throw Error(`禁止符号链接：${name}`);
    }
    const resolved = await realpath(file),
      relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error(`路径越界：${name}`);
    return resolved;
  };
  const manifestPath = await safePath('manifest.json');
  if ((await stat(manifestPath)).size > 16 * 1024 * 1024) throw Error('清单超过预算');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.packageKind !== 'map3d-engine-export' || manifest.exportVersion !== 2)
    throw Error('仅支持 v2；旧包请从 .map3d 重新导出');
  if (!Array.isArray(manifest.files) || manifest.files.length > 10000)
    throw Error('清单文件数量无效');
  const files = new Map(),
    metadata = new Map(),
    folded = new Set();
  let total = 0;
  for (const entry of manifest.files) {
    const name = entry.path;
    if (typeof name !== 'string' || folded.has(name.toLowerCase()) || name === 'manifest.json')
      throw Error('清单路径重复');
    folded.add(name.toLowerCase());
    const file = await safePath(name),
      size = (await stat(file)).size;
    if (
      !size ||
      size > 128 * 1024 * 1024 ||
      size !== entry.byteLength ||
      (total += size) > 512 * 1024 * 1024
    )
      throw Error(`文件预算或长度不符：${name}`);
    const bytes = await readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw Error(`哈希不符：${name}`);
    files.set(name, bytes);
    metadata.set(name, entry);
  }
  const schema = JSON.parse(files.get('protocol/engine-export-v2.schema.json').toString('utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
  ajv.addSchema(schema);
  const validate = (value, name = '') => {
    const check = ajv.getSchema(schema.$id + (name ? '#/definitions/' + name : ''));
    if (!check?.(value)) throw Error(`字段校验失败 ${name}：${ajv.errorsText(check?.errors)}`);
    return value;
  };
  validate(manifest);
  const json = (name, definition) => {
    if (
      metadata.get(name)?.mediaType !== 'application/json' ||
      files.get(name).length > 16 * 1024 * 1024
    )
      throw Error(`JSON 引用无效：${name}`);
    return validate(JSON.parse(files.get(name).toString('utf8')), definition);
  };
  const array = (name, type, dimensions) => {
    const info = metadata.get(name)?.binary,
      bytes = files.get(name);
    if (
      !info ||
      info.componentType !== type ||
      JSON.stringify(info.dimensions) !== JSON.stringify(dimensions) ||
      info.elementCount !== dimensions.reduce((a, b) => a * b, 1)
    )
      throw Error(`数组描述不符：${name}`);
    const width = type === 'uint8' ? 1 : 4;
    if (
      bytes.length !== info.elementCount * width ||
      info.byteOrder !== (width === 1 ? 'none' : 'little')
    )
      throw Error(`数组字节数或字节序不符：${name}`);
    const values =
      type === 'float32'
        ? new Float32Array(info.elementCount)
        : type === 'uint32'
          ? new Uint32Array(info.elementCount)
          : new Uint8Array(info.elementCount);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < values.length; i++) {
      values[i] =
        type === 'float32'
          ? data.getFloat32(i * 4, true)
          : type === 'uint32'
            ? data.getUint32(i * 4, true)
            : bytes[i];
      if (!Number.isFinite(values[i])) throw Error(`数组存在非有限值：${name}`);
    }
    return values;
  };
  const terrain = json(manifest.entries.terrain, 'terrain'),
    models = json(manifest.entries.models, 'models');
  const n = manifest.map.samplesX,
    grid = manifest.map.grid;
  const heights = array(terrain.heights, 'float32', [n, n]);
  const surface = array(terrain.surface, 'uint8', [n, n, 4]);
  const trees = manifest.entries.trees ? json(manifest.entries.trees, 'instances') : [];
  const sites = manifest.entries.sites ? json(manifest.entries.sites, 'instances') : [];
  const logic = manifest.entries.logic ? json(manifest.entries.logic, 'logic') : null;
  const owners = logic ? array(logic.owners, 'uint32', [grid.rows, grid.columns]) : null;
  const grass = manifest.entries.grass ? json(manifest.entries.grass, 'grass') : null;
  const densities = new Map(
    (grass?.layers ?? []).map((layer) => [layer.id, array(layer.density, 'float32', [n, n])]),
  );
  const water = manifest.entries.water ? json(manifest.entries.water, 'water') : null;
  const exclusions = grass ? json(grass.exclusions, 'exclusions') : null;
  const rivers = water || exclusions ? json(water?.rivers ?? exclusions.rivers, 'rivers') : [];
  for (const primitive of water?.primitives ?? []) {
    array(primitive.depth, 'float32', [primitive.vertexCount]);
    array(primitive.shore, 'float32', [primitive.vertexCount]);
    array(primitive.flow, 'float32', [primitive.vertexCount, 2]);
  }
  const modelIds = new Map(models.map((model) => [model.id, model]));
  if (modelIds.size !== models.length) throw Error('重复资源 ID');
  for (const instance of [...trees, ...sites, ...(grass?.layers ?? [])]) {
    const model = modelIds.get(instance.assetId);
    if (!model?.included || !files.has(model.path))
      throw Error(`模型引用无效：${instance.assetId}`);
  }
  for (const model of models)
    if (model.included) {
      const material = json(model.material, 'modelMaterials');
      for (const texture of material.textures)
        if (!metadata.get(texture.path)?.image) throw Error(`贴图引用无效：${texture.path}`);
    }
  const siteIds = new Map((logic?.sites ?? []).map((site) => [site.id, site]));
  const factionIds = new Map((logic?.factions ?? []).map((faction) => [faction.id, faction]));
  if (owners)
    for (const owner of owners)
      if (owner && !siteIds.has(owner)) throw Error(`无效据点归属：${owner}`);
  for (const site of siteIds.values())
    if (site.factionId !== null && !factionIds.has(site.factionId))
      throw Error(`无效初始势力：${site.factionId}`);
  const getCellOwner = (q, r) => {
    if (!Number.isInteger(q) || !Number.isInteger(r)) throw Error('六边形坐标必须为整数');
    const col = q + Math.floor(r / 2);
    return !owners || col < 0 || col >= grid.columns || r < 0 || r >= grid.rows
      ? null
      : (siteIds.get(owners[r * grid.columns + col]) ?? null);
  };
  const getHeight = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw Error('世界坐标必须为有限数值');
    const sx = Math.max(0, Math.min(n - 1, (x / manifest.map.width + 0.5) * (n - 1)));
    const sz = Math.max(0, Math.min(n - 1, (z / manifest.map.depth + 0.5) * (n - 1)));
    const col = Math.min(n - 2, Math.floor(sx)),
      row = Math.min(n - 2, Math.floor(sz));
    const u = sx - col,
      v = sz - row,
      i = row * n + col;
    return u + v <= 1
      ? heights[i] + u * (heights[i + 1] - heights[i]) + v * (heights[i + n] - heights[i])
      : heights[i + n + 1] +
          (1 - u) * (heights[i + n] - heights[i + n + 1]) +
          (1 - v) * (heights[i + 1] - heights[i + n + 1]);
  };
  return {
    manifest,
    terrain,
    models,
    trees,
    sites,
    logic,
    rivers,
    grass,
    densities,
    water,
    heights,
    surface,
    owners,
    getHeight,
    getCellOwner,
    getCellFaction: (q, r) => factionIds.get(getCellOwner(q, r)?.factionId) ?? null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('用法：node examples/read-map.mjs <解压后的地图包目录>');
  const map = await readMap(process.argv[2]);
  console.log(
    JSON.stringify(
      {
        name: map.manifest.name,
        models: map.models.length,
        trees: map.trees.length,
        sites: map.logic?.sites.length ?? 0,
        factions: map.logic?.factions.length ?? 0,
        centerHeight: map.getHeight(0, 0),
        validation: map.manifest.validation,
      },
      null,
      2,
    ),
  );
}
