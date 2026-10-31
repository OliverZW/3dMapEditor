import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/renderer/camera-rig';
import type { AxisView } from '../src/renderer/camera-rig';
import { EditorSession } from '../src/application/editor-session';
import { createDocument } from '../src/core/document';
import { pickTerrain } from '../src/core/terrain-picking';
import { virtualRange } from '../src/ui/virtual-range';
import { assetReferenceCounts } from '../src/core/assets';
import { ModelLibrary } from '../src/renderer/models';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

describe('方向坐标系与相机数学', () => {
  it('三个正方向都朝向观察中心，保留目标与投影', () => {
    const rig = new CameraRig(),
      target = rig.target.clone(),
      radius = rig.camera.position.distanceTo(target);
    const axes: Record<AxisView, THREE.Vector3> = {
      '+x': new THREE.Vector3(1, 0, 0),
      '+y': new THREE.Vector3(0, 1, 0),
      '+z': new THREE.Vector3(0, 0, 1),
    };
    for (const axis of Object.keys(axes) as AxisView[]) {
      rig.snap(axis);
      rig.update(0.2);
      expect(
        rig.camera.position.clone().sub(target).normalize().distanceTo(axes[axis]),
      ).toBeLessThan(1e-8);
      expect(rig.camera.getWorldDirection(new THREE.Vector3()).dot(axes[axis])).toBeCloseTo(-1, 8);
      expect(rig.camera.position.distanceTo(target)).toBeCloseTo(radius, 8);
      expect(rig.target.equals(target)).toBe(true);
      expect(rig.projection).toBe('perspective');
    }
  });
  it('切换投影和调整窗口后保留观察方向与画面尺度', () => {
    const rig = new CameraRig();
    rig.resize(1600, 900);
    const target = rig.target.clone(),
      quaternion = rig.camera.quaternion.clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const point = target.clone().addScaledVector(right, 70);
    const before = point.clone().project(rig.camera);
    rig.toggleProjection();
    expect(point.clone().project(rig.camera).x).toBeCloseTo(before.x, 7);
    expect(rig.camera.quaternion.angleTo(quaternion)).toBeCloseTo(0, 7);
    rig.resize(1280, 720);
    rig.toggleProjection();
    expect(point.clone().project(rig.camera).x).toBeCloseTo(before.x, 7);
    expect(rig.target.equals(target)).toBe(true);
  });
  it('斜向恢复、动画打断及取景不会残留过渡或重置投影', () => {
    const rig = new CameraRig();
    rig.snap('+x');
    rig.update(0.07);
    const pose = rig.camera.position.clone();
    rig.interrupt();
    rig.update(0.2);
    expect(rig.camera.position.distanceTo(pose)).toBe(0);
    rig.toggleProjection();
    rig.snap('+y');
    rig.update(0.2);
    const quaternion = rig.camera.quaternion.clone();
    rig.frame(new THREE.Vector3(20, 30, 40), 200);
    expect(rig.projection).toBe('orthographic');
    expect(rig.camera.quaternion.angleTo(quaternion)).toBeCloseTo(0, 7);
    rig.resetPerspective();
    rig.update(0.2);
    expect(rig.projection).toBe('perspective');
    expect(rig.orientation).toBe('free');
    expect(rig.target.toArray()).toEqual([20, 30, 40]);
  });
  it('不同更新频率移动距离相同，斜向归一化，正交沿屏幕方向平移', () => {
    const first = new CameraRig(),
      second = new CameraRig();
    const origin = first.camera.position.clone();
    for (let i = 0; i < 30; i++) first.move(new THREE.Vector3(0, 0, 1), 100 / 30);
    for (let i = 0; i < 60; i++) second.move(new THREE.Vector3(1, 0, 1), 100 / 60);
    expect(first.camera.position.distanceTo(origin)).toBeCloseTo(100, 7);
    expect(second.camera.position.distanceTo(origin)).toBeCloseTo(100, 7);
    const ortho = new CameraRig();
    ortho.snap('+x');
    ortho.update(0.2);
    ortho.toggleProjection();
    const before = ortho.camera.position.clone();
    ortho.move(new THREE.Vector3(0, 1, 1), 20);
    expect(ortho.camera.position.x).toBeCloseTo(before.x, 7);
    expect(ortho.camera.position.distanceTo(before)).toBeCloseTo(20, 7);
  });
  it('大地图全图取景扩展远裁剪面，滚轮不会跳回旧距离上限', () => {
    const rig = new CameraRig();
    rig.frame(new THREE.Vector3(), 25000);
    const distance = rig.camera.position.length();
    expect(rig.camera.far).toBeGreaterThan(distance + 12500);
    rig.dolly(0.01);
    expect(rig.camera.position.length()).toBeGreaterThan(distance);
    expect(rig.camera.position.length()).toBeLessThan(distance * 1.1);
  });
  it('底视不会拾取单面地形的不可见背面', () => {
    const doc = createDocument();
    expect(
      pickTerrain(doc.settings, doc.heights, {
        origin: { x: 0, y: -100, z: 0 },
        direction: { x: 0, y: 1, z: 0 },
      }),
    ).toBeNull();
  });
});
describe('工具选择和资源列表', () => {
  it('离开据点清除选择，返回不恢复；势力地图添加不重新选中据点', () => {
    const session = new EditorSession(),
      site = session.doc.sites[0];
    const owners = session.doc.owners.slice();
    session.selectSite(site.id);
    session.setTool('terrain');
    expect(session.selectedSite).toBeNull();
    session.setTool('sites');
    expect(session.selectedSite).toBeNull();
    expect(session.dirty).toBe(false);
    expect(session.history.undo(session.doc)).toBeUndefined();
    expect(session.doc.owners).toEqual(owners);
    session.setTool('factions');
    session.selectFaction(session.doc.factions[0].id);
    session.setFactionMode('assign');
    session.pickSite(site.id);
    expect(session.selectedSite).toBeNull();
  });
  it('树草分别记住模型和擦除模式，单击模型不替换实例也不退出实例选择', () => {
    const session = new EditorSession();
    session.setTool('trees');
    session.setVegetationMode('erase');
    session.brush.radius = 80;
    const tree = session.doc.trees[0],
      originalAsset = tree.assetId;
    session.selectBrushAsset('tree', 'tree-broad');
    expect(session.brush.erase).toBe(true);
    expect(session.brush.radius).toBe(80);
    session.setTool('grass');
    expect(session.assetId).toBe('grass-reed');
    expect(session.brush.erase).toBe(false);
    session.setTool('trees');
    expect(session.assetId).toBe('tree-broad');
    expect(session.brush.erase).toBe(true);
    session.setVegetationMode('select');
    session.pickTree(tree.id);
    session.selectBrushAsset('tree', 'tree-pine');
    expect(session.treeMode).toBe('select');
    expect(session.selectedTree).toBe(tree.id);
    expect(session.doc.trees[0].assetId).toBe(originalAsset);
    expect(session.dirty).toBe(false);
  });
  it('实例选择不运行笔刷，清除选择不改变树木数据', () => {
    const session = new EditorSession();
    session.setTool('trees');
    session.setVegetationMode('select');
    const count = session.doc.trees.length;
    session.pointerDown({ x: 0, z: 0 }, false);
    session.pointerMove({ x: 20, z: 20 }, false);
    session.endStroke();
    expect(session.doc.trees).toHaveLength(count);
    expect(session.dirty).toBe(false);
  });
  it('过期导入不写入新工程，引用资源不可删除', () => {
    const session = new EditorSession(),
      version = session.documentVersion;
    const asset = { ...session.doc.assets.find((item) => item.kind === 'tree')!, id: 'late-model' };
    session.replace(createDocument());
    expect(() => session.addAsset(asset, version)).toThrow('工程已切换');
    expect(session.doc.assets.some((item) => item.id === asset.id)).toBe(false);
    const demo = new EditorSession(),
      referenced = demo.doc.trees[0].assetId;
    expect(demo.deleteAsset(referenced)).toBe(false);
    expect(demo.doc.assets.some((item) => item.id === referenced)).toBe(true);
  });
  it('空植被分类不创建笔触，重新导入模型后可恢复刷入', () => {
    const session = new EditorSession();
    const doc = createDocument();
    doc.assets = doc.assets.filter((asset) => asset.kind !== 'tree' && asset.kind !== 'grass');
    session.replace(doc);
    for (const tool of ['trees', 'grass'] as const) {
      session.setTool(tool);
      session.pointerDown({ x: 0, z: 0 }, false);
      session.pointerMove({ x: 10, z: 10 }, false);
      session.endStroke();
      expect(session.error).toContain('先导入模型');
      expect(session.dirty).toBe(false);
    }
    const grass = createDocument().assets.find((asset) => asset.kind === 'grass')!;
    session.addAsset(grass, session.documentVersion);
    session.selectBrushAsset('grass', grass.id);
    session.pointerDown({ x: 0, z: 0 }, false);
    session.endStroke();
    expect(session.doc.grass).toHaveLength(1);
  });
  it('引用按资源汇总，虚拟窗口有界且能定位最后一项', () => {
    const session = new EditorSession(),
      counts = assetReferenceCounts(session.doc);
    const id = session.doc.trees[0].assetId;
    expect(counts.get(id)).toBe(session.doc.trees.filter((item) => item.assetId === id).length);
    const range = virtualRange(10000, 6400, 256);
    expect(range.end - range.start).toBeLessThanOrEqual(12);
    expect(range.start).toBe(96);
    expect(virtualRange(10000, 999999, 256).end).toBe(10000);
    expect(virtualRange(0, 0, 256)).toEqual({ start: 0, end: 0, totalHeight: 0 });
  });
});

describe('导航输入生命周期', () => {
  it('右键飞行按键互斥，松开、失焦和销毁后不持续移动或响应快捷键', async () => {
    const { CameraNavigation } = await import('../src/renderer/camera-navigation');
    class Surface extends EventTarget {
      tabIndex = 0;
      clientHeight = 800;
      captured = new Set<number>();
      closest() {
        return null;
      }
      focus() {
        documentStub.activeElement = this;
      }
      setPointerCapture(id: number) {
        this.captured.add(id);
      }
      hasPointerCapture(id: number) {
        return this.captured.has(id);
      }
      releasePointerCapture(id: number) {
        this.captured.delete(id);
      }
    }
    const canvas = new Surface(),
      windowStub = new Surface();
    const documentStub = Object.assign(new EventTarget(), {
      activeElement: null as EventTarget | null,
      hidden: false,
    });
    vi.stubGlobal('window', windowStub);
    vi.stubGlobal('document', documentStub);
    const commands = {
      focus: vi.fn(),
      frameAll: vi.fn(),
      toggleGrid: vi.fn(),
      editing: () => false,
      cancelEditing: vi.fn(),
    };
    const navigation = new CameraNavigation(canvas as unknown as HTMLCanvasElement, commands);
    function event(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
      const value = new Event(type, { cancelable: true });
      Object.assign(value, properties);
      target.dispatchEvent(value);
      return value;
    }
    try {
      const plain = event(canvas, 'pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      });
      expect(plain.defaultPrevented).toBe(false);
      const origin = navigation.rig.camera.position.clone();
      event(canvas, 'pointerdown', {
        button: 2,
        pointerId: 2,
        clientX: 0,
        clientY: 0,
        shiftKey: false,
      });
      event(windowStub, 'keydown', { code: 'KeyW', key: 'w' });
      for (let index = 0; index < 60; index++) navigation.update(1 / 60);
      expect(navigation.rig.camera.position.distanceTo(origin)).toBeCloseTo(100, 6);
      event(canvas, 'wheel', { deltaY: -100 });
      expect(navigation.getSnapshot().speed).toBe(120);
      event(canvas, 'pointerup', { pointerId: 2 });
      const stopped = navigation.rig.camera.position.clone();
      navigation.update(0.1);
      expect(navigation.rig.camera.position.distanceTo(stopped)).toBe(0);
      event(canvas, 'pointerdown', {
        button: 2,
        pointerId: 3,
        clientX: 0,
        clientY: 0,
        shiftKey: false,
      });
      event(windowStub, 'keydown', { code: 'KeyW', key: 'w' });
      event(windowStub, 'blur');
      navigation.update(0.1);
      expect(navigation.rig.camera.position.distanceTo(stopped)).toBe(0);
      navigation.setBlocked(true);
      event(windowStub, 'keydown', { code: 'KeyV', key: 'v' });
      expect(navigation.rig.projection).toBe('perspective');
      navigation.setBlocked(false);
      event(windowStub, 'keydown', { code: 'KeyF', key: 'f', ctrlKey: true });
      expect(commands.focus).not.toHaveBeenCalled();
      navigation.dispose();
      event(windowStub, 'keydown', { code: 'KeyF', key: 'f' });
      expect(commands.focus).not.toHaveBeenCalled();
    } finally {
      navigation.dispose();
      vi.unstubAllGlobals();
    }
  });
});

describe('模型资源生命周期', () => {
  it('重复请求共用模型，移除资源与重复销毁不会重复释放', async () => {
    const library = new ModelLibrary(),
      asset = createDocument().assets.find((item) => item.kind === 'grass')!;
    const [first, second] = await Promise.all([library.get(asset), library.get(asset)]);
    expect(first).toBe(second);
    const geometries = new Set<THREE.BufferGeometry>();
    first.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    let released = 0;
    geometries.forEach((geometry) => geometry.addEventListener('dispose', () => released++));
    library.retainAssets([]);
    await Promise.resolve();
    expect(released).toBe(geometries.size);
    const replacement = await library.get(asset);
    expect(replacement).not.toBe(first);
    library.dispose();
    library.dispose();
    await Promise.resolve();
    expect(released).toBe(geometries.size);
    await expect(library.get(asset)).rejects.toThrow('已释放');
  });
  it('关闭时仍在解析的 GLB 返回后释放，不重新写回已销毁缓存', async () => {
    let finish!: (value: GLTF) => void;
    const pending = new Promise<GLTF>((resolve) => {
      finish = resolve;
    });
    const parser = vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockReturnValue(pending);
    const geometry = new THREE.BoxGeometry(),
      material = new THREE.MeshBasicMaterial(),
      group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    let released = 0;
    geometry.addEventListener('dispose', () => released++);
    const library = new ModelLibrary(),
      asset = { ...createDocument().assets[0], builtin: undefined, bytes: new Uint8Array(8) };
    try {
      const assertion = expect(library.get(asset)).rejects.toThrow('已释放');
      library.dispose();
      finish({ scene: group } as unknown as GLTF);
      await assertion;
      expect(released).toBe(1);
    } finally {
      parser.mockRestore();
      library.dispose();
    }
  });
});
