import { createDocument } from './document';
import { hexIndex, hexWorld, worldHex } from './hex';
import { rebuildGridCoverage } from './grid-coverage';
import { hashRandom } from './vegetation';
export function createDemo() {
  const doc = createDocument();
  const legacyGrid = {
    columns: 64,
    rows: 48,
    radius: 12,
    originX: -Math.sqrt(3) * 12 * 31.75,
    originZ: -1.5 * 12 * 23.5,
  };
  doc.grid = legacyGrid;
  doc.owners = new Uint32Array(64 * 48);
  rebuildGridCoverage(doc);
  doc.name = '山河初境';
  const n = doc.settings.samples;
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const x = (col / (n - 1) - 0.5) * 2048,
        z = (row / (n - 1) - 0.5) * 2048;
      let h = 32;
      for (const [cx, cz, amplitude, radius] of [
        [-500, -350, 150, 260],
        [-300, -590, 170, 210],
        [200, -650, 95, 280],
        [650, 330, 135, 230],
        [-750, 380, 70, 240],
      ]) {
        const d = Math.hypot(x - cx, z - cz);
        h +=
          amplitude *
          Math.exp((-d * d) / (radius * radius)) *
          (0.8 + 0.2 * Math.sin(x * 0.02) * Math.cos(z * 0.018));
      }
      doc.heights[row * n + col] = Math.min(doc.settings.maxHeight, h);
    }
  doc.rivers.push({
    id: doc.nextId++,
    name: '清水河',
    width: 32,
    depth: 10,
    waterLevel: 29,
    points: [
      { x: -900, z: 40 },
      { x: -460, z: 0 },
      { x: -160, z: 130 },
      { x: 180, z: 70 },
      { x: 520, z: -70 },
      { x: 900, z: -140 },
    ],
  });
  const factionA = doc.nextId++,
    factionB = doc.nextId++;
  doc.factions.push(
    { id: factionA, name: '青州', color: '#6895a3' },
    { id: factionB, name: '江陵', color: '#bc8b65' },
  );
  const cityId = doc.nextId++,
    fortId = doc.nextId++;
  doc.sites.push(
    {
      id: cityId,
      kind: 'city',
      name: '临江城',
      assetId: 'city-jade',
      center: worldHex(doc.grid, hexWorld(legacyGrid, { q: 17, r: 27 })),
      yaw: 0,
      scale: 1,
      factionId: factionA,
    },
    {
      id: fortId,
      kind: 'fortress',
      name: '北岭关',
      assetId: 'fort-stone',
      center: worldHex(doc.grid, hexWorld(legacyGrid, { q: 24, r: 17 })),
      yaw: 0,
      scale: 1,
      factionId: factionB,
    },
  );
  for (let row = 0; row < 48; row++)
    for (let col = 0; col < 64; col++) {
      const i = hexIndex(
        doc.grid,
        worldHex(doc.grid, hexWorld(legacyGrid, { q: col - Math.floor(row / 2), r: row })),
      );
      if (Math.hypot(col - 30, row - 27) < 6) doc.owners[i] = cityId;
      else if (Math.hypot(col - 32, row - 17) < 4) doc.owners[i] = fortId;
    }
  for (const site of doc.sites) doc.owners[hexIndex(doc.grid, site.center)] = site.id;
  for (let i = 0; i < 1100; i++) {
    const x = (hashRandom(i, 1, 19) - 0.5) * 1760,
      z = (hashRandom(i, 2, 19) - 0.5) * 1650;
    if (Math.abs(z - 60) < 110 || Math.hypot(x - 40, z - 180) < 110) continue;
    doc.trees.push({
      id: doc.nextId++,
      assetId: i % 4 ? 'tree-pine' : 'tree-broad',
      x,
      z,
      yaw: hashRandom(i, 3, 19) * Math.PI * 2,
      scale: 0.8 + hashRandom(i, 4, 19) * 0.5,
    });
  }
  const density = new Float32Array(n * n);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const x = (col / (n - 1) - 0.5) * 2048,
        z = (row / (n - 1) - 0.5) * 2048;
      if (Math.hypot(x, z - 160) < 160) density[row * n + col] = 1.5;
    }
  doc.grass.push({
    id: doc.nextId++,
    assetId: 'grass-reed',
    density,
    seed: 2026,
    version: 1,
    minScale: 0.8,
    maxScale: 1.2,
    maxSlope: 30,
    wind: 1,
  });
  return doc;
}
