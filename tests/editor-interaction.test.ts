import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EditorSession } from '../src/application/editor-session';
import { createDocument } from '../src/core/document';
import { hexWorld, worldHex, hexIndex } from '../src/core/hex';
import { pickTerrain } from '../src/core/terrain-picking';
import { sampleHeight } from '../src/core/terrain';
import { ModelLibrary } from '../src/renderer/models';
import { placeSiteModel } from '../src/renderer/site-transform';
import { buildLogicOverlay } from '../src/renderer/logic-overlay';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { DEFAULT_VIEW } from '../src/core/types';
import type { ModelAsset } from '../src/core/types';

describe('合并据点与辖区的编辑会话', () => {
  it('列表切换保留绘制模式与半径，首笔和拖动不受植被擦除状态影响', () => {
    const session = new EditorSession();
    const [first, second] = session.doc.sites;
    session.selectSite(first.id);
    session.setSiteMode('add');
    session.brush.hexRadius = 0;
    session.brush.erase = true;
    session.selectSite(second.id);
    expect(session.tool).toBe('sites');
    expect(session.siteMode).toBe('add');
    expect(session.brush.hexRadius).toBe(0);
    const a = { q: 5, r: 20 },
      b = { q: 6, r: 20 };
    session.pointerDown(hexWorld(session.doc.grid, a), false);
    session.pointerMove(hexWorld(session.doc.grid, b), false);
    session.endStroke();
    expect(session.doc.owners[hexIndex(session.doc.grid, a)]).toBe(second.id);
    expect(session.doc.owners[hexIndex(session.doc.grid, b)]).toBe(second.id);
    session.setSiteMode('erase');
    session.brush.erase = false;
    session.pointerDown(hexWorld(session.doc.grid, a), false);
    session.endStroke();
    expect(session.doc.owners[hexIndex(session.doc.grid, a)]).toBe(0);
    session.undo();
    expect(session.doc.owners[hexIndex(session.doc.grid, a)]).toBe(second.id);
  });
  it('势力点选不切换面板，转移与移除保留逐格归属且可撤销', () => {
    const session = new EditorSession();
    session.setTool('factions');
    const site = session.doc.sites[0];
    const target = session.doc.factions.find((f) => f.id !== site.factionId)!;
    const before = site.factionId,
      owners = session.doc.owners.slice();
    session.selectFaction(target.id);
    session.setFactionMode('assign');
    session.pickSite(site.id);
    expect(session.tool).toBe('factions');
    expect(session.selectedFaction).toBe(target.id);
    expect(session.factionMode).toBe('assign');
    expect(session.doc.sites[0].factionId).toBe(target.id);
    expect(session.doc.owners).toEqual(owners);
    session.undo();
    expect(session.doc.sites[0].factionId).toBe(before);
    session.assignSiteFaction(site.id, null);
    expect(session.doc.sites[0].factionId).toBeNull();
    expect(session.doc.owners).toEqual(owners);
  });
  it('势力添加方式互斥，切换不修改地图或历史，列表模式不接受地图点选', () => {
    const session = new EditorSession();
    session.setTool('factions');
    const site = session.doc.sites[0];
    const faction = session.doc.factions.find((f) => f.id !== site.factionId)!;
    session.selectFaction(faction.id);
    const before = JSON.stringify(session.doc, (key, value) =>
      key === 'bytes' ? undefined : value,
    );
    for (const mode of ['list', 'assign', 'list', 'inspect'] as const) {
      session.setFactionMode(mode);
      expect(session.factionMode).toBe(mode);
      if (mode === 'list') session.pickSite(site.id);
      expect(site.factionId).not.toBe(faction.id);
      expect(session.dirty).toBe(false);
      expect(session.history.canUndo).toBe(false);
    }
    expect(JSON.stringify(session.doc, (key, value) => (key === 'bytes' ? undefined : value))).toBe(
      before,
    );
  });
  it('地图模式连续加入多个据点，每次成员变化独立撤销且保留逐格归属', () => {
    const session = new EditorSession();
    session.setTool('factions');
    const faction = session.doc.factions[0];
    const sites = session.doc.sites.slice(0, 2);
    sites.forEach((site) => (site.factionId = null));
    expect(sites).toHaveLength(2);
    const original = sites.map((site) => site.factionId);
    const owners = session.doc.owners.slice();
    session.selectFaction(faction.id);
    session.setFactionMode('assign');
    for (const site of sites) {
      session.pickSite(site.id);
      expect(session.factionMode).toBe('assign');
      expect(session.doc.sites.find((s) => s.id === site.id)!.factionId).toBe(faction.id);
    }
    session.undo();
    expect(session.doc.sites.find((s) => s.id === sites[0].id)!.factionId).toBe(faction.id);
    expect(session.doc.sites.find((s) => s.id === sites[1].id)!.factionId).toBe(original[1]);
    session.undo();
    expect(session.doc.sites.find((s) => s.id === sites[0].id)!.factionId).toBe(original[0]);
    expect(session.doc.owners).toEqual(owners);
  });
  it.each(['list', 'assign'] as const)('清理 %s 添加状态并阻止无有效势力时进入添加', (mode) => {
    const session = new EditorSession();
    session.setFactionMode(mode);
    expect(session.factionMode).toBe('inspect');
    session.setTool('factions');
    session.setFactionMode(mode);
    expect(session.factionMode).toBe('inspect');
    const [first, second] = session.doc.factions;
    session.selectFaction(first.id);
    session.setFactionMode(mode);
    session.selectFaction(second.id);
    expect(session.factionMode).toBe('inspect');
    session.setFactionMode(mode);
    session.setTool('terrain');
    session.setTool('factions');
    expect(session.factionMode).toBe('inspect');
    session.setFactionMode(mode);
    session.deleteFaction(second.id);
    expect(session.factionMode).toBe('inspect');
    expect(session.selectedFaction).toBeNull();
    session.selectFaction(first.id);
    session.setFactionMode(mode);
    session.replace(createDocument());
    expect(session.factionMode).toBe('inspect');
    expect(session.selectedFaction).toBeNull();
  });
  it('点击锁定格心，悬停不漂移，确认和取消保持一致', () => {
    const session = new EditorSession();
    session.replace(createDocument());
    session.beginSite('city');
    session.hoverAt({ x: 20, z: 30 });
    session.commitSite();
    expect(session.doc.sites).toHaveLength(0);
    const point = { x: 125.2, z: -145.7 };
    session.pointerDown(point, false);
    const locked = { ...session.sitePreview! };
    session.hoverAt({ x: 400, z: 500 });
    expect(session.sitePreview).toEqual(locked);
    session.commitSite();
    expect(session.doc.sites[0].center).toEqual(worldHex(session.doc.grid, point));
    expect(session.sitePreview).toBeNull();
    session.beginSite('fortress');
    session.pointerDown({ x: 400, z: 500 }, false);
    session.clearSiteCandidate();
    session.commitSite();
    expect(session.sitePreviewLocked).toBe(false);
    session.pointerDown({ x: 400, z: 500 }, false);
    expect(session.error).toBe('');
    expect(session.sitePreviewLocked).toBe(true);
    session.cancelPreview();
    expect(session.doc.sites).toHaveLength(1);
  });
});

describe('地面射线与模型锚点', () => {
  it('拾取与可见三角面一致，覆盖窄山脊、掠射、垂直射线和边界', () => {
    const settings = {
      ...createDocument().settings,
      samples: 17,
      width: 64,
      depth: 64,
      minHeight: -10,
    };
    const heights = Float32Array.from(
      { length: 17 * 17 },
      (_, i) => (i % 17 === 8 ? 80 : 0) + Math.sin(i * 0.7) * 8,
    );
    const geometry = new THREE.BufferGeometry(),
      positions: number[] = [],
      indices: number[] = [];
    for (let row = 0; row < 17; row++)
      for (let col = 0; col < 17; col++) {
        const i = row * 17 + col;
        positions.push(-32 + col * 4, heights[i], -32 + row * 4);
        if (row < 16 && col < 16) indices.push(i, i + 17, i + 1, i + 1, i + 17, i + 18);
      }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
      mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    const rays: THREE.Ray[] = [];
    for (let i = 0; i < 80; i++) {
      const origin = new THREE.Vector3(Math.sin(i * 2.1) * 70, 120, Math.cos(i * 0.7) * 60);
      const target = new THREE.Vector3(Math.sin(i) * 30, 0, Math.cos(i * 1.3) * 30);
      rays.push(new THREE.Ray(origin, target.sub(origin).normalize()));
    }
    rays.push(new THREE.Ray(new THREE.Vector3(0, 150, 0), new THREE.Vector3(0, -1, 0)));
    rays.push(new THREE.Ray(new THREE.Vector3(-32, 150, 32), new THREE.Vector3(0, -1, 0)));
    rays.push(
      new THREE.Ray(new THREE.Vector3(-60, 20, 0), new THREE.Vector3(1, -0.03, 0).normalize()),
    );
    rays.push(new THREE.Ray(new THREE.Vector3(80, 100, 0), new THREE.Vector3(0, -1, 0)));
    for (const ray of rays) {
      const actual = new THREE.Raycaster(ray.origin, ray.direction).intersectObject(mesh)[0]?.point;
      const point = pickTerrain(settings, heights, ray);
      if (!actual) expect(point).toBeNull();
      else {
        expect(point).not.toBeNull();
        expect(point!.x).toBeCloseTo(actual.x, 5);
        expect(point!.z).toBeCloseTo(actual.z, 5);
        expect(
          sampleHeight(
            { settings } as ReturnType<typeof createDocument>,
            heights,
            point!.x,
            point!.z,
          ),
        ).toBeCloseTo(actual.y, 4);
      }
    }
    geometry.dispose();
    material.dispose();
  });
  it('透视与正交相机投影往返准确，覆盖不同画布宽高比', () => {
    const doc = createDocument(),
      heights = doc.heights;
    for (const aspect of [1, 1.6, 2.1])
      for (const orthographic of [false, true]) {
        const camera = orthographic
          ? new THREE.OrthographicCamera(-1200 * aspect, 1200 * aspect, 1200, -1200, 0.1, 12000)
          : new THREE.PerspectiveCamera(43, aspect, 0.1, 12000);
        camera.position.set(700, 1200, 950);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        for (const point of [
          new THREE.Vector3(0, heights[0], 0),
          new THREE.Vector3(300, heights[0], -400),
        ]) {
          const screen = point.clone().project(camera);
          const caster = new THREE.Raycaster();
          caster.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
          const hit = pickTerrain(doc.settings, heights, caster.ray)!;
          expect(hit.x).toBeCloseTo(point.x, 5);
          expect(hit.z).toBeCloseTo(point.z, 5);
        }
      }
  });
  it('偏心 GLB 据点水平居中，预览与正式变换一致', async () => {
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ translation: [40, 0, -20], children: [1] }, { mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-1, 0, -1],
          max: [1, 2, 1],
        },
      ],
    };
    const encoded = new TextEncoder().encode(JSON.stringify(json)),
      size = Math.ceil(encoded.length / 4) * 4;
    const bytes = new Uint8Array(12 + 8 + size + 8 + 36),
      view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, size, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + size);
    bytes.set(encoded, 20);
    view.setUint32(20 + size, 36, true);
    view.setUint32(24 + size, 0x004e4942, true);
    new Float32Array(bytes.buffer, 28 + size, 9).set([-1, 0, -1, 1, 0, -1, 0, 2, 1]);
    const asset: ModelAsset = {
      id: 'offcenter',
      name: '偏心城池',
      kind: 'city',
      bytes,
      hash: 'test',
      source: 'test',
      size: [2, 2, 2],
      triangles: 1,
      materials: 1,
      scale: 1,
      yaw: 0.4,
      offset: 0,
    };
    const library = new ModelLibrary(),
      model = await library.get(asset);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
    const doc = createDocument(),
      hex = worldHex(doc.grid, { x: 100, z: 100 });
    const ghost = model.clone(true),
      committed = model.clone(true);
    placeSiteModel(ghost, doc, doc.heights, asset, hex, 0.7, 2);
    placeSiteModel(committed, doc, doc.heights, asset, hex, 0.7, 2);
    ghost.updateMatrixWorld(true);
    committed.updateMatrixWorld(true);
    expect(ghost.matrixWorld.elements).toEqual(committed.matrixWorld.elements);
    library.dispose();
  });
});

describe('六边形覆盖层', () => {
  it('相邻两格仅有十一条共享边去重后的外观边，开关关闭不产生格线', () => {
    const doc = createDocument();
    doc.grid = { columns: 2, rows: 1, radius: 12, originX: 0, originZ: 0 };
    doc.owners = new Uint32Array(2);
    const view = { ...DEFAULT_VIEW, hex: true, factions: false, territories: false };
    const group = buildLogicOverlay(doc, doc.heights, view, null);
    const lines = group.children.find((child) => child instanceof LineSegments2) as LineSegments2;
    const spacing = doc.settings.width / (doc.settings.samples - 1) / 2;
    expect(lines.geometry.instanceCount).toBe(11 * Math.ceil(12 / spacing));
    expect(lines.material.linewidth).toBe(1.25);
    expect(lines.material.opacity).toBeGreaterThan(0.42);
    const hidden = buildLogicOverlay(doc, doc.heights, { ...view, hex: false }, null);
    expect(hidden.children).toHaveLength(0);
    lines.geometry.dispose();
    lines.material.dispose();
  });
});
