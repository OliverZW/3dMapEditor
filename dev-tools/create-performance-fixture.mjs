import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const output = resolve('test-results/fixtures/performance-demo-1025.map3d');
const server = await createServer({ server: { middlewareMode: true } });
try {
  const resources = await server.ssrLoadModule('/src/io/builtin-resources.ts');
  resources.installBuiltinResources(
    Object.fromEntries(
      await Promise.all(
        resources.builtinResourceEntries.map(async (e) => [
          e.file,
          new Uint8Array(await readFile(resolve('editor-assets', e.file))),
        ]),
      ),
    ),
  );
  const { createDemo } = await server.ssrLoadModule('/src/core/demo.ts');
  const { createDocument, validateDocument } = await server.ssrLoadModule('/src/core/document.ts');
  const { sampleHeight } = await server.ssrLoadModule('/src/core/terrain.ts');
  const { encodeProject } = await server.ssrLoadModule('/src/io/project.ts');
  const old = createDemo(),
    n = 1025,
    doc = createDocument(n, old.settings.width, old.settings.depth);
  Object.assign(doc, {
    name: '固定示例1025（程序构造验收夹具）',
    nextId: old.nextId,
    assets: old.assets,
    trees: old.trees,
    rivers: old.rivers,
    sites: old.sites,
    factions: old.factions,
    owners: old.owners,
    grid: old.grid,
    surfaceMaterial: old.surfaceMaterial,
    waterMaterial: old.waterMaterial,
  });
  doc.grass = old.grass.map((layer) => ({ ...layer, density: new Float32Array(n * n) }));
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      doc.heights[i] = sampleHeight(
        old,
        old.heights,
        (col / (n - 1) - 0.5) * old.settings.width,
        (row / (n - 1) - 0.5) * old.settings.depth,
      );
      const nearest = Math.round((row * 512) / (n - 1)) * 513 + Math.round((col * 512) / (n - 1));
      doc.surface.set(old.surface.subarray(nearest * 4, nearest * 4 + 4), i * 4);
      doc.grass.forEach((layer, k) => (layer.density[i] = old.grass[k].density[nearest]));
    }
  validateDocument(doc);
  const bytes = encodeProject(doc);
  await mkdir(resolve('test-results/fixtures'), { recursive: true });
  await writeFile(output, bytes);
  await writeFile(
    output + '.json',
    JSON.stringify(
      {
        source:
          '既有固定示例的程序构造验收副本；高度按原三角面采样，权重和密度按最近原采样；不用于修改用户地图或作为正式地图作品',
        samples: n,
        width: doc.settings.width,
        depth: doc.settings.depth,
        trees: doc.trees.length,
        sites: doc.sites.length,
        rivers: doc.rivers.length,
        grassLayers: doc.grass.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      null,
      2,
    ),
  );
  const { ProjectRepository } = await server.ssrLoadModule('/src/io/project-storage.ts');
  const { NativeProjectStorage } = await server.ssrLoadModule('/desktop/native-project-storage.ts');
  const directory = resolve('test-results/fixtures/performance-demo-1025-project-' + Date.now());
  await new ProjectRepository(new NativeProjectStorage(directory)).create(doc);
  const entry = await readFile(resolve(directory, 'project.map3dproj'));
  await writeFile(
    resolve('test-results/fixtures/performance-demo-1025-project.json'),
    JSON.stringify(
      {
        directory,
        entrySha256: createHash('sha256').update(entry).digest('hex'),
        source: '程序构造的1025²固定示例，使用正式目录工程存储保留内置资源归属与相同LOD路径',
        samples: 1025,
        trees: doc.trees.length,
        sites: doc.sites.length,
        rivers: doc.rivers.length,
      },
      null,
      2,
    ),
  );
  console.log(output);
  console.log(directory);
} finally {
  await server.close();
}
