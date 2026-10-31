// 加工完成后刷新清单；不复制素材到源码或测试目录。
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../editor-assets/', import.meta.url);
const readJson = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const writeJson = async (file, data) =>
  writeFile(new URL(file, root), JSON.stringify(data, null, 2) + '\n');
const image = async (file) => {
  const bytes = await readFile(new URL(file, root));
  return {
    file,
    hash: createHash('sha256').update(bytes).digest('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

const assets = [];
const previous = await readJson('models/manifest.json');
for (const file of (await readdir(new URL('models/', root)))
  .filter((name) => name.endsWith('.glb'))
  .sort()) {
  const meta = await readJson('models/' + file.replace(/\.glb$/, '.json'));
  const bytes = await readFile(new URL('models/' + file, root));
  assets.push({
    id: meta.assetId,
    name: meta.name,
    kind: meta.kind,
    builtin: meta.builtin,
    file: 'models/' + file,
    hash: createHash('sha256').update(bytes).digest('hex'),
    size: meta.sizeThreeMeters,
    triangles: meta.triangles,
    materials: meta.materials.length,
    scale: 1,
    yaw: 0,
    offset: meta.groundOffset,
    source: meta.source,
    ...(previous.assets.find((asset) => asset.id === meta.assetId)?.lod?.sourceHash ===
    createHash('sha256').update(bytes).digest('hex')
      ? { lod: previous.assets.find((asset) => asset.id === meta.assetId).lod }
      : {}),
  });
}
const order = [
  'city-jade',
  'fort-stone',
  'tree-pine',
  'tree-broad',
  'tree-cypress',
  'tree-maple',
  'tree-willow',
  'grass-reed',
];
assets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
await writeJson('models/manifest.json', { version: 1, assets });
const surface = await readJson('surface/manifest.json');
for (const layer of surface.layers) {
  for (const kind of ['color', 'normal']) layer[kind] = await image(layer[kind].file);
  layer.thumbnail = await image(layer.thumbnail.file);
}
await writeJson('surface/manifest.json', surface);
const water = await readJson('water/provenance.json');
const waterPreset = await readJson('water/manifest.json');
await writeJson('water/manifest.json', {
  version: 1,
  source: water.scope,
  material: waterPreset.material,
  normal: await image('water/ripple-normal.png'),
  mask: await image('water/ripple-mask.png'),
});
console.log('已更新模型、地表、水面资源清单。');
