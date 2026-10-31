import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { CameraNavigation } from './camera-navigation';
import type { EditorSession } from '../application/editor-session';
import type { ModelAsset, Point, Tree } from '../core/types';
import { hexDisk, hexWorld, worldHex } from '../core/hex';
import { riverCurve, sampleHeight } from '../core/terrain';
import { generateGrass, vegetationFilter } from '../core/vegetation';
import { ModelLibrary } from './models';
import { ModelBatches } from './model-batches';
import { ModelRenderCounter } from './model-render-counter';
import type { ModelInstance } from './model-batches';
import { pickTerrain } from '../core/terrain-picking';
import { buildLogicOverlay } from './logic-overlay';
import { buildResizeOverlay } from './resize-overlay';
import { placeSiteModel } from './site-transform';
import { SurfaceMaterial } from './surface-material';
import { TerrainGeometry } from './terrain-geometry';
import { SurfacePageCache } from './surface-page-cache';
import { WaterSurface } from './water-surface';
import type { RenderBounds } from '../application/render-invalidation';
export interface ViewportRenderOptions {
  surfaceMode?: 'original' | 'optimized' | 'cached';
  modelMode?: 'original' | 'optimized';
  /** 开发对照：baseline 保留第二轮之前的渲染和上传路径。 */
  performanceMode?: 'baseline' | 'candidate';
}
interface RenderStats {
  fps: number;
  calls: number;
  triangles: number;
  modelTriangles: number;
  grass: number;
  trees: number;
  terrainMeshes: number;
}
export class EditorViewport {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly library = new ModelLibrary();
  readonly navigation: CameraNavigation;
  get camera() {
    return this.navigation.rig.camera;
  }
  private inputBlocked = false;
  private ground: THREE.Mesh;
  private terrainGeometry = new TerrainGeometry();
  private terrainDirty = true;
  private terrainBounds: RenderBounds | undefined;
  private sun: THREE.DirectionalLight;
  private shadowLightKey = '';
  private surfaceMaterial: SurfaceMaterial;
  private surfaceCache?: SurfacePageCache;
  surfaceCacheEnabled = true;
  private seenTerrainRevision = -1;
  private vegetation = new THREE.Group();
  private sites = new THREE.Group();
  private treeModels: ModelBatches;
  private siteModels: ModelBatches;
  private modelRenderCounter = new ModelRenderCounter();
  private grassModels = new THREE.Group();
  private treeModelKey = '';
  private siteModelKey = '';
  private grassModelKey = '';
  private grassRevision = 0;
  private waterSurface: WaterSurface;
  private water: THREE.Group;
  private logic = new THREE.Group();
  private gridLines = new THREE.Group();
  private gridKey = '';
  private preview = new THREE.Group();
  private siteGhost = new THREE.Group();
  private ghostGeneration = 0;
  private cursor = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x80c8fc,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  private previewKey = '';
  private logicKey = '';
  private frame = 0;
  private disposed = false;
  private seenRevision = -1;
  private seenDoc: unknown;
  private riverKey = '';
  private instanceTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private instanceBuilds = 0;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private unsubscribeRender: () => void;
  private surfaceDirty = true;
  private surfaceBounds: RenderBounds | undefined;
  private instancesDirty = true;
  private shadowVisibility = '';
  private cursorKey = '';
  private pressed = false;
  private lastGrassCenter = new THREE.Vector3(Infinity, 0, 0);
  private clock = new THREE.Clock();
  private fpsTime = 0;
  private frames = 0;
  private lastStats = 0;
  private grassTime = { value: 0 };
  stats: RenderStats = {
    fps: 0,
    calls: 0,
    triangles: 0,
    modelTriangles: 0,
    grass: 0,
    trees: 0,
    terrainMeshes: 1,
  };
  onStats?: (stats: RenderStats) => void;
  constructor(
    private container: HTMLElement,
    private session: EditorSession,
    readonly renderOptions: ViewportRenderOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = renderOptions.surfaceMode === 'original';
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '三维地图编辑视口');
    this.renderer.domElement.dataset.testid = 'map-canvas';
    this.scene.background = new THREE.Color(0xa5b6af);
    this.scene.fog = new THREE.Fog(0xa5b6af, 1900, 5500);
    this.scene.add(new THREE.HemisphereLight(0xd8e6de, 0x62634d, 2.3));
    const sun = new THREE.DirectionalLight(0xffe8bd, 3);
    sun.position.set(-400, 800, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -1000,
      right: 1000,
      top: 1000,
      bottom: -1000,
      near: 10,
      far: 2000,
    });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 1.5;
    this.sun = sun;
    this.scene.add(sun);
    this.surfaceMaterial = new SurfaceMaterial(
      (error) => this.session.message(error, true),
      renderOptions.surfaceMode === 'original',
      renderOptions.performanceMode === 'candidate',
    );
    if (renderOptions.surfaceMode === 'cached') {
      this.surfaceCache = new SurfacePageCache(this.renderer, this.surfaceMaterial);
      this.surfaceMaterial.useCache(this.surfaceCache);
    }
    this.waterSurface = new WaterSurface((error) => this.session.message(error, true));
    this.water = this.waterSurface.group;
    this.ground = new THREE.Mesh(this.terrainGeometry, this.surfaceMaterial.material);
    this.ground.name = 'ContinuousTerrain';
    this.ground.receiveShadow = true;
    const modelChanged = () => {
      this.renderer.shadowMap.needsUpdate = true;
    };
    const modelError = (error: unknown) => {
      if (!this.disposed) this.session.message(`模型渲染失败：${String(error)}`, true);
    };
    this.treeModels = new ModelBatches(
      this.library,
      'TreeBatch',
      renderOptions.modelMode === 'original',
      modelChanged,
      modelError,
      this.modelRenderCounter,
      renderOptions.performanceMode,
    );
    this.siteModels = new ModelBatches(
      this.library,
      'SiteBatch',
      renderOptions.modelMode === 'original',
      modelChanged,
      modelError,
      this.modelRenderCounter,
      renderOptions.performanceMode,
    );
    this.vegetation.add(this.treeModels.group, this.grassModels);
    this.sites.add(this.siteModels.group);
    this.scene.add(
      this.ground,
      this.vegetation,
      this.sites,
      this.water,
      this.logic,
      this.gridLines,
      this.preview,
      this.siteGhost,
      this.cursor,
    );
    this.cursor.renderOrder = 20;
    this.navigation = new CameraNavigation(this.renderer.domElement, {
      focus: () => this.focusSelection(),
      frameAll: () => this.frameMap(),
      toggleGrid: () => this.session.setViewLayer('hex', !this.session.view.hex),
      editing: () => this.pressed,
      cancelEditing: () => this.pointerCancel(),
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    window.addEventListener('blur', this.pointerCancel);
    this.unsubscribe = session.subscribeView(() => {
      this.updateVisibility();
    });
    this.unsubscribeRender = session.subscribeRender((change) => {
      if (change.documentVersion !== session.documentVersion) return;
      if (change.kind !== 'instances') this.surfaceCache?.invalidate(change);
      if (change.kind === 'terrain' || change.kind === 'all') {
        if (!this.terrainDirty) this.terrainBounds = change.bounds;
        else if (this.terrainBounds && change.bounds) {
          this.terrainBounds = {
            minX: Math.min(this.terrainBounds.minX, change.bounds.minX),
            minZ: Math.min(this.terrainBounds.minZ, change.bounds.minZ),
            maxX: Math.max(this.terrainBounds.maxX, change.bounds.maxX),
            maxZ: Math.max(this.terrainBounds.maxZ, change.bounds.maxZ),
          };
        } else this.terrainBounds = undefined;
        this.terrainDirty = true;
      }
      if (change.kind === 'all' || change.kind === 'terrain' || change.kind === 'instances') {
        this.instancesDirty = true;
        this.generation++;
        this.treeModels.invalidate();
        this.siteModels.invalidate();
        if (change.kind !== 'instances' || !change.models || change.models.includes('grass'))
          this.grassRevision++;
      }
      if (change.kind === 'all' || change.kind === 'terrain')
        this.renderer.shadowMap.needsUpdate = true;
      if (change.kind === 'all' || change.kind === 'surface') {
        if (!this.surfaceDirty) this.surfaceBounds = change.bounds;
        else if (this.surfaceBounds && change.bounds) {
          this.surfaceBounds = {
            minX: Math.min(this.surfaceBounds.minX, change.bounds.minX),
            minZ: Math.min(this.surfaceBounds.minZ, change.bounds.minZ),
            maxX: Math.max(this.surfaceBounds.maxX, change.bounds.maxX),
            maxZ: Math.max(this.surfaceBounds.maxZ, change.bounds.maxZ),
          };
        } else this.surfaceBounds = undefined;
        this.surfaceDirty = true;
      }
    });
    this.animate();
  }
  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.navigation.rig.resize(w, h);
  }
  setInputBlocked(blocked: boolean) {
    this.inputBlocked = blocked;
    this.navigation.setBlocked(blocked);
  }
  focusSelection() {
    const site =
      this.session.tool === 'sites'
        ? this.session.doc.sites.find((item) => item.id === this.session.selectedSite)
        : undefined;
    if (site) {
      this.focusSite(site.id);
      return;
    }
    const tree =
      this.session.tool === 'trees'
        ? this.session.doc.trees.find((item) => item.id === this.session.selectedTree)
        : undefined;
    if (tree) {
      const asset = this.session.doc.assets.find((item) => item.id === tree.assetId)!;
      this.navigation.frame(
        new THREE.Vector3(
          tree.x,
          sampleHeight(this.session.doc, this.session.heights, tree.x, tree.z),
          tree.z,
        ),
        Math.max(...asset.size) * asset.scale * tree.scale * 3,
      );
      return;
    }
    this.frameMap();
  }
  frameMap() {
    const { width, depth, minHeight, maxHeight } = this.session.doc.settings;
    const bounds = new THREE.Box3(
      new THREE.Vector3(-width / 2, minHeight, -depth / 2),
      new THREE.Vector3(width / 2, maxHeight, depth / 2),
    );
    this.navigation.frame(
      bounds.getCenter(new THREE.Vector3()),
      bounds.getBoundingSphere(new THREE.Sphere()).radius * 2.1,
    );
  }
  focusSite(id: number) {
    const site = this.session.doc.sites.find((item) => item.id === id);
    if (!site) return;
    const point = hexWorld(this.session.doc.grid, site.center);
    const asset = this.session.doc.assets.find((item) => item.id === site.assetId)!;
    this.navigation.frame(
      new THREE.Vector3(
        point.x,
        sampleHeight(this.session.doc, this.session.heights, point.x, point.z),
        point.z,
      ),
      Math.max(...asset.size) * asset.scale * site.scale * 3,
    );
  }
  private rebuildTerrain() {
    this.terrainGeometry.update(
      this.session.doc,
      this.session.heights,
      this.terrainDirty ? this.terrainBounds : undefined,
      this.renderOptions.performanceMode !== 'baseline',
    );
    this.terrainDirty = false;
    this.terrainBounds = undefined;
    this.surfaceCache?.setTerrain(this.session.doc, this.terrainGeometry);
  }
  private clearOwned(group: THREE.Group) {
    for (const child of [...group.children]) {
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
        }
      });
      group.remove(child);
    }
  }
  private clearInstances(group: THREE.Group) {
    for (const child of [...group.children]) {
      child.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) {
          obj.dispose();
          if (obj.userData.ownedMaterial)
            for (const material of Array.isArray(obj.material) ? obj.material : [obj.material])
              material.dispose();
        }
      });
      group.remove(child);
    }
  }
  private rebuildWater() {
    this.waterSurface.rebuild(this.session.doc, this.session.heights);
  }
  private rebuildLogic() {
    this.clearOwned(this.logic);
    this.logic.add(
      buildLogicOverlay(
        this.session.doc,
        this.session.heights,
        this.session.view,
        this.session.tool === 'sites' ? this.session.selectedSite : null,
        'ranges',
      ),
    );
  }
  private async rebuildInstances(grassOnly = false) {
    const generation = ++this.generation,
      doc = this.session.doc,
      heights = this.session.heights;
    const current = () =>
      !this.disposed && generation === this.generation && doc === this.session.doc;
    const transform = new THREE.Object3D();
    const assetKey = (kind: ModelAsset['kind']) =>
      doc.assets
        .filter((asset) => asset.kind === kind)
        .map(({ id, hash, scale, yaw, offset }) => ({ id, hash, scale, yaw, offset }));
    const sites = doc.sites.map(({ id, assetId, center, yaw, scale }) => ({
      id,
      assetId,
      center,
      yaw,
      scale,
    }));
    const siteKey = JSON.stringify([
      this.session.documentVersion,
      this.session.terrainRevision,
      sites,
      assetKey('city'),
      assetKey('fortress'),
    ]);
    const treeKey = JSON.stringify([
      this.session.documentVersion,
      this.session.terrainRevision,
      doc.trees,
      sites,
      assetKey('tree'),
      assetKey('city'),
      assetKey('fortress'),
    ]);
    const grassKey = JSON.stringify([
      this.session.documentVersion,
      this.session.terrainRevision,
      this.grassRevision,
      sites,
      assetKey('grass'),
      assetKey('city'),
      assetKey('fortress'),
      doc.grass.map(({ density: _density, ...metadata }) => metadata),
    ]);
    if (!grassOnly && treeKey !== this.treeModelKey) {
      const valid = vegetationFilter(doc, heights);
      const groups = doc.assets
        .filter((asset) => asset.kind === 'tree')
        .map((asset) => {
          const instances = doc.trees
            .filter((tree) => tree.assetId === asset.id && valid(tree, tree.maxSlope ?? 30))
            .map((tree) => {
              transform.position.set(
                tree.x,
                sampleHeight(doc, heights, tree.x, tree.z) + asset.offset * tree.scale,
                tree.z,
              );
              transform.rotation.set(0, tree.yaw + asset.yaw, 0);
              transform.scale.setScalar(tree.scale * asset.scale);
              transform.updateMatrix();
              return { id: tree.id, matrix: transform.matrix.clone() };
            });
          return { asset, instances };
        });
      await this.treeModels.rebuild(groups);
      if (!current()) return;
      this.stats.trees = groups.reduce((sum, group) => sum + group.instances.length, 0);
      this.treeModelKey = treeKey;
    }
    if (!grassOnly && siteKey !== this.siteModelKey) {
      const groups = doc.assets
        .filter((asset) => asset.kind === 'city' || asset.kind === 'fortress')
        .map((asset) => {
          const instances: ModelInstance[] = doc.sites
            .filter((site) => site.assetId === asset.id)
            .map((site) => {
              placeSiteModel(transform, doc, heights, asset, site.center, site.yaw, site.scale);
              transform.updateMatrix();
              return { id: site.id, matrix: transform.matrix.clone() };
            });
          return { asset, instances };
        });
      await this.siteModels.rebuild(groups);
      if (!current()) return;
      this.siteModelKey = siteKey;
    }
    if (grassOnly || grassKey !== this.grassModelKey) {
      const group = new THREE.Group();
      let grass = 0,
        committed = false;
      const center = this.navigation.rig.target.clone();
      try {
        for (const asset of doc.assets.filter((asset) => asset.kind === 'grass')) {
          const instances: Tree[] = [];
          for (const layer of doc.grass.filter((layer) => layer.assetId === asset.id))
            instances.push(
              ...generateGrass(
                doc,
                heights,
                layer,
                { x: center.x, z: center.z },
                80,
                50000 - grass - instances.length,
              ),
            );
          if (!instances.length) continue;
          const source = await this.library.get(asset);
          if (!current()) return;
          this.addGrassInstances(group, source, asset, instances, heights);
          grass += instances.length;
        }
        if (!current()) return;
        this.clearInstances(this.grassModels);
        this.grassModels.add(group);
        committed = true;
        this.stats.grass = grass;
        this.grassModelKey = grassKey;
        this.lastGrassCenter.copy(center);
      } finally {
        if (!committed) this.clearInstances(group);
      }
    }
    if (current()) {
      this.library.retainAssets(doc.assets);
      this.updateVisibility();
    }
  }
  private addGrassInstances(
    target: THREE.Group,
    model: THREE.Group,
    asset: ModelAsset,
    instances: Tree[],
    heights: Float32Array,
  ) {
    const doc = this.session.doc,
      transform = new THREE.Object3D(),
      matrix = new THREE.Matrix4();
    model.updateMatrixWorld(true);
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      let material = part.material;
      {
        const mats = (Array.isArray(material) ? material : [material]).map((m) => {
          const clone = m.clone();
          clone.transparent = true;
          clone.onBeforeCompile = (shader: Parameters<THREE.Material['onBeforeCompile']>[0]) => {
            shader.uniforms.uGrassTime = this.grassTime;
            shader.vertexShader = shader.vertexShader
              .replace(
                '#include <common>',
                '#include <common>\nuniform float uGrassTime;varying float vGrassDistance;',
              )
              .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\ntransformed.x+=sin(uGrassTime*1.8+instanceMatrix[3].x*.4+instanceMatrix[3].z*.2)*.09*position.y*position.y;vGrassDistance=length((modelViewMatrix*instanceMatrix*vec4(position,1.)).xyz);',
              );
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', '#include <common>\nvarying float vGrassDistance;')
              .replace(
                '#include <color_fragment>',
                '#include <color_fragment>\ndiffuseColor.a*=1.-smoothstep(60.,80.,vGrassDistance);',
              );
          };
          return clone;
        });
        material = Array.isArray(material) ? mats : mats[0];
      }
      const mesh = new THREE.InstancedMesh(part.geometry, material, instances.length);
      mesh.name = 'GrassBatch';
      this.modelRenderCounter.track(mesh);
      mesh.userData.ownedMaterial = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      instances.forEach((item, index) => {
        transform.position.set(
          item.x,
          sampleHeight(doc, heights, item.x, item.z) + asset.offset * item.scale,
          item.z,
        );
        transform.rotation.set(0, item.yaw + asset.yaw, 0);
        transform.scale.setScalar(item.scale * asset.scale);
        transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, part.matrixWorld);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.computeBoundingSphere();
      target.add(mesh);
    });
  }
  private refreshPreview() {
    this.clearOwned(this.preview);
    const s = this.session,
      river = s.riverPreview;
    if (s.resizePreview) {
      const settings = s.resizePreview.document.settings;
      this.preview.add(buildResizeOverlay(s.doc, s.heights, settings.width, settings.depth));
    }
    if (river) {
      const points = riverCurve(river);
      if (points.length) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          points.map(
            (p) =>
              new THREE.Vector3(
                p.x,
                Math.max(sampleHeight(s.doc, s.heights, p.x, p.z) + 2, river.waterLevel + 2),
                p.z,
              ),
          ),
        );
        const line = new THREE.Line(
          geo,
          new THREE.LineDashedMaterial({
            color: 0xf2b76d,
            dashSize: 8,
            gapSize: 5,
            depthTest: false,
          }),
        );
        line.computeLineDistances();
        this.preview.add(line);
      }
      river.points.forEach((p, i) => {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(3.5, 10, 8),
          new THREE.MeshBasicMaterial({
            color: i === s.riverPoint ? 0xffffff : 0x6cbafa,
            depthTest: false,
          }),
        );
        sphere.position.set(p.x, sampleHeight(s.doc, s.heights, p.x, p.z) + 4, p.z);
        sphere.renderOrder = 10;
        this.preview.add(sphere);
      });
    }
    if (s.tool === 'trees' && s.treeMode === 'select' && s.selectedTree) {
      const tree = s.doc.trees.find((item) => item.id === s.selectedTree);
      if (tree) {
        const asset = s.doc.assets.find((item) => item.id === tree.assetId)!;
        const radius = Math.max(asset.size[0], asset.size[2]) * asset.scale * tree.scale * 0.55;
        const points = Array.from({ length: 65 }, (_, index) => {
          const angle = (index / 64) * Math.PI * 2,
            x = tree.x + Math.cos(angle) * radius,
            z = tree.z + Math.sin(angle) * radius;
          return new THREE.Vector3(x, sampleHeight(s.doc, s.heights, x, z) + 0.8, z);
        });
        this.preview.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0x8acbff, depthTest: false }),
          ),
        );
      }
    }
    if (s.sitePreview) {
      const p = hexWorld(s.doc.grid, s.sitePreview),
        valid = s.siteCandidateValid;
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(7, 10, 6),
        new THREE.MeshBasicMaterial({
          color: valid ? 0x7bc6ff : 0xe97070,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(p.x, sampleHeight(s.doc, s.heights, p.x, p.z) + 2, p.z);
      this.preview.add(mesh);
    }
  }
  private async rebuildSiteGhost() {
    const generation = ++this.ghostGeneration;
    this.clearOwned(this.siteGhost);
    const session = this.session;
    if (!session.sitePreview || !(session.sitePlacement || session.movingSite)) return;
    const center = { ...session.sitePreview };
    const site = session.movingSite
      ? session.doc.sites.find((s) => s.id === session.selectedSite)
      : undefined;
    const asset = session.doc.assets.find((a) => a.id === (site?.assetId ?? session.assetId));
    if (!asset) return;
    const source = await this.library.get(asset);
    if (this.disposed || generation !== this.ghostGeneration) return;
    const ghost = source.clone(true);
    ghost.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry = object.geometry.clone();
      const clone = (material: THREE.Material) => {
        const result = material.clone();
        result.transparent = true;
        result.opacity = 0.45;
        result.depthWrite = false;
        return result;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(clone)
        : clone(object.material);
      object.castShadow = false;
    });
    placeSiteModel(
      ghost,
      session.doc,
      session.heights,
      asset,
      center,
      site?.yaw ?? 0,
      site?.scale ?? 1,
    );
    this.siteGhost.add(ghost);
  }
  private updateVisibility() {
    const key = `${this.session.view.trees}:${this.session.view.sites}`;
    if (key !== this.shadowVisibility) {
      this.shadowVisibility = key;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.water.visible = this.session.view.water;
    this.sites.visible = this.session.view.sites;
    this.treeModels.group.visible = this.session.view.trees;
    this.grassModels.visible = this.session.view.grass;
  }
  private updateShadowState() {
    const sun = this.sun,
      shadow = sun.shadow;
    const key = JSON.stringify([
      sun.visible,
      sun.castShadow,
      sun.position.toArray(),
      sun.target.position.toArray(),
      shadow.mapSize.toArray(),
      shadow.bias,
      shadow.normalBias,
      shadow.radius,
      shadow.camera.projectionMatrix.elements,
    ]);
    if (key !== this.shadowLightKey) {
      this.shadowLightKey = key;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
  private updateSceneDistances() {
    const settings = this.session.doc.settings;
    const bounds = new THREE.Box3(
      new THREE.Vector3(-settings.width / 2, settings.minHeight, -settings.depth / 2),
      new THREE.Vector3(settings.width / 2, settings.maxHeight, settings.depth / 2),
    );
    const distance = this.camera.position.distanceTo(bounds.getCenter(new THREE.Vector3()));
    const diameter = bounds.getSize(new THREE.Vector3()).length();
    const near = Math.max(0.5, bounds.distanceToPoint(this.camera.position) / 256);
    const far = Math.max(12000, distance + diameter * 2);
    if (
      Math.abs(this.camera.near - near) > Math.max(0.1, near * 0.05) ||
      Math.abs(this.camera.far - far) > far * 0.05
    ) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = Math.max(1900, distance - diameter * 0.5);
      this.scene.fog.far = Math.max(5500, distance + diameter * 2);
    }
  }
  private updateGridReadability() {
    if (!this.session.view.hex) return;
    const target = this.navigation.rig.target;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const a = target.clone().project(this.camera);
    const b = target
      .clone()
      .addScaledVector(right, Math.sqrt(3) * this.session.doc.grid.radius)
      .project(this.camera);
    const pixels = (Math.abs(b.x - a.x) * this.container.clientWidth) / 2;
    const blend = THREE.MathUtils.smoothstep(pixels, 4, 16);
    this.gridLines.traverse((object) => {
      if (object instanceof LineSegments2) {
        object.material.opacity = THREE.MathUtils.lerp(0.12, 0.72, blend);
        object.material.linewidth = THREE.MathUtils.lerp(0.75, 1.25, blend);
      }
    });
  }
  private updateCursor() {
    const s = this.session,
      p = s.hover;
    this.cursor.visible =
      !!p &&
      this.navigation.getSnapshot().gesture === 'idle' &&
      !this.navigation.rig.animating &&
      !(s.tool === 'trees' && s.treeMode === 'select') &&
      (['terrain', 'surface', 'trees', 'grass'].includes(s.tool) || s.paintingTerritory);
    if (!p || !this.cursor.visible) return;
    const key = JSON.stringify([
      p,
      s.paintingTerritory,
      s.brush.radius,
      s.brush.hexRadius,
      s.terrainRevision,
      s.documentVersion,
      s.doc.grid,
    ]);
    if (this.cursorKey === key && this.renderOptions.surfaceMode !== 'original') return;
    this.cursorKey = key;
    const positions: number[] = [];
    if (s.paintingTerritory) {
      const hex = worldHex(s.doc.grid, p);
      for (const cell of hexDisk(hex, s.brush.hexRadius)) {
        const c = hexWorld(s.doc.grid, cell);
        for (let k = 0; k < 7; k++) {
          const a = ((60 * (k % 6) - 30) * Math.PI) / 180,
            x = c.x + Math.cos(a) * s.doc.grid.radius,
            z = c.z + Math.sin(a) * s.doc.grid.radius;
          positions.push(x, sampleHeight(s.doc, s.heights, x, z) + 1.5, z);
        }
      }
    } else
      for (let k = 0; k < 80; k++) {
        const a = (k / 80) * Math.PI * 2,
          x = p.x + Math.cos(a) * s.brush.radius,
          z = p.z + Math.sin(a) * s.brush.radius;
        positions.push(x, sampleHeight(s.doc, s.heights, x, z) + 1, z);
      }
    this.cursor.geometry.dispose();
    this.cursor.geometry = new THREE.BufferGeometry();
    this.cursor.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }
  private pointerRay(event: PointerEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    // 相机刚切换、旋转或尺寸改变时也使用同一套最新矩阵。
    this.camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }
  private rayPoint(event: PointerEvent): Point | null {
    return pickTerrain(this.session.doc.settings, this.session.heights, this.pointerRay(event).ray);
  }
  private modelPickDistance(raycaster: THREE.Raycaster, groundPoint: Point | null) {
    return groundPoint
      ? new THREE.Vector3(
          groundPoint.x,
          sampleHeight(this.session.doc, this.session.heights, groundPoint.x, groundPoint.z),
          groundPoint.z,
        ).distanceTo(raycaster.ray.origin)
      : Infinity;
  }
  private pickSite(event: PointerEvent, groundPoint: Point | null): number | null {
    if (!this.session.view.sites) return null;
    const ray = this.pointerRay(event);
    this.siteModels.update(this.camera, this.container.clientHeight, this.session.selectedSite);
    return this.siteModels.pick(ray, this.modelPickDistance(ray, groundPoint));
  }
  private pickTree(event: PointerEvent, groundPoint: Point | null): number | null {
    if (!this.session.view.trees) return null;
    const ray = this.pointerRay(event);
    this.treeModels.update(this.camera, this.container.clientHeight, this.session.selectedTree);
    return this.treeModels.pick(ray, this.modelPickDistance(ray, groundPoint));
  }
  private pointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.altKey || this.inputBlocked || this.navigation.rig.animating) return;
    this.pressed = true;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    const p = this.rayPoint(e);
    const session = this.session;
    if (session.tool === 'trees' && session.treeMode === 'select') {
      const treeId = this.pickTree(e, p);
      if (treeId !== null) {
        session.pickTree(treeId);
        return;
      }
    }
    if (
      !session.sitePlacement &&
      !session.movingSite &&
      !session.paintingTerritory &&
      ['sites', 'factions'].includes(session.tool)
    ) {
      const siteId = this.pickSite(e, p);
      if (siteId !== null) {
        session.pickSite(siteId);
        return;
      }
    }
    if (p) session.pointerDown(p, e.shiftKey);
    else if (session.sitePlacement || session.movingSite) session.clearSiteCandidate();
  };
  private pointerMove = (e: PointerEvent) => {
    const p = this.rayPoint(e);
    if (this.pressed && p) this.session.pointerMove(p, e.shiftKey);
    else this.session.hoverAt(p);
  };
  private pointerUp = (e: PointerEvent) => {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    this.session.endStroke();
  };
  private pointerCancel = () => {
    this.pressed = false;
    this.session.cancelStroke();
  };
  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta(),
      elapsed = this.clock.elapsedTime;
    this.navigation.update(delta);
    this.waterSurface.setTime(elapsed);
    this.grassTime.value = elapsed;
    if (this.seenRevision !== this.session.revision || this.seenDoc !== this.session.doc) {
      // 工程切换、失败回滚也可能只替换文档对象，不能继续引用旧权重数组。
      if (this.seenDoc !== this.session.doc) {
        this.surfaceDirty = true;
        this.surfaceBounds = undefined;
        this.terrainDirty = true;
        this.terrainBounds = undefined;
        this.instancesDirty = true;
        this.surfaceCache?.invalidate();
      }
      const geometryChanged =
        this.seenDoc !== this.session.doc ||
        this.seenTerrainRevision !== this.session.terrainRevision;
      this.seenRevision = this.session.revision;
      this.seenTerrainRevision = this.session.terrainRevision;
      this.seenDoc = this.session.doc;
      if (geometryChanged) {
        this.rebuildTerrain();
        this.renderer.shadowMap.needsUpdate = true;
      }
      if (this.surfaceDirty || this.renderOptions.surfaceMode === 'original') {
        this.surfaceMaterial.update(this.session.doc, this.surfaceBounds);
        this.surfaceDirty = false;
        this.surfaceBounds = undefined;
      } else this.surfaceMaterial.updateResources(this.session.doc);
      const key = JSON.stringify([
        this.session.doc.rivers.map(({ name: _name, ...geometry }) => geometry),
        this.session.doc.settings,
      ]);
      if (key !== this.riverKey) {
        this.riverKey = key;
        this.rebuildWater();
      } else if (geometryChanged)
        this.waterSurface.updateDepth(this.session.doc, this.session.heights);
      if (this.instancesDirty || this.renderOptions.surfaceMode === 'original') {
        this.instancesDirty = false;
        if (!this.instanceTimer)
          this.instanceTimer = setTimeout(() => {
            this.instanceTimer = null;
            this.instanceBuilds++;
            void this.rebuildInstances()
              .catch(
                (e) => !this.disposed && this.session.message(`模型渲染失败：${String(e)}`, true),
              )
              .finally(() => {
                this.instanceBuilds--;
              });
          }, 50);
      }
    }
    if (
      !this.instanceTimer &&
      !this.instanceBuilds &&
      !this.instancesDirty &&
      this.navigation.rig.target.distanceTo(this.lastGrassCenter) > 15
    ) {
      this.lastGrassCenter.copy(this.navigation.rig.target);
      this.instanceTimer = setTimeout(() => {
        this.instanceTimer = null;
        void this.rebuildInstances(true).catch((e) => {
          if (!this.disposed) this.session.message(String(e), true);
        });
      }, 200);
    }
    const previewKey = JSON.stringify([
      this.session.riverPreview,
      this.session.resizePreview?.document.settings,
      this.session.riverPoint,
      this.session.sitePreview,
      this.session.siteMode,
      this.session.tool,
      this.session.treeMode,
      this.session.selectedTree,
      this.session.assetId,
      this.session.selectedSite,
      this.session.revision,
    ]);
    if (previewKey !== this.previewKey) {
      this.previewKey = previewKey;
      this.refreshPreview();
      void this.rebuildSiteGhost().catch((e) => {
        if (!this.disposed) this.session.message(String(e), true);
      });
    }
    const gridKey = JSON.stringify([
      this.session.terrainRevision,
      this.session.doc.settings,
      this.session.doc.grid,
    ]);
    if (this.session.view.hex && gridKey !== this.gridKey) {
      this.gridKey = gridKey;
      this.clearOwned(this.gridLines);
      this.gridLines.add(
        buildLogicOverlay(this.session.doc, this.session.heights, this.session.view, null, 'grid'),
      );
    }
    this.gridLines.visible = this.session.view.hex;
    const logicKey = JSON.stringify([
      this.session.revision,
      this.session.selectedSite,
      this.session.tool,
      this.session.view.territories,
      this.session.view.factions,
    ]);
    if (logicKey !== this.logicKey) {
      this.logicKey = logicKey;
      this.rebuildLogic();
    }
    this.surfaceMaterial.updateSettings(
      this.session.surfacePreview ?? this.session.doc.surfaceMaterial,
    );
    this.updateShadowState();
    this.updateSceneDistances();
    this.updateGridReadability();
    this.updateCursor();
    if (this.surfaceCacheEnabled)
      this.surfaceCache?.update(
        this.camera,
        this.navigation.rig.target,
        this.renderer.domElement.height,
      );
    this.treeModels.update(this.camera, this.container.clientHeight, this.session.selectedTree);
    this.siteModels.update(this.camera, this.container.clientHeight, this.session.selectedSite);
    this.modelRenderCounter.reset();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (elapsed - this.lastStats > 1) {
      this.stats.fps = Math.round(this.frames / (elapsed - this.fpsTime));
      this.fpsTime = elapsed;
      this.frames = 0;
      this.lastStats = elapsed;
      this.stats.calls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      this.stats.modelTriangles = this.modelRenderCounter.triangles;
      this.onStats?.({ ...this.stats });
    }
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    if (this.instanceTimer) clearTimeout(this.instanceTimer);
    this.generation++;
    this.ghostGeneration++;
    this.unsubscribe();
    this.unsubscribeRender();
    this.resizeObserver.disconnect();
    this.navigation.dispose();
    this.treeModels.dispose();
    this.siteModels.dispose();
    this.clearInstances(this.grassModels);
    this.waterSurface.dispose();
    this.clearOwned(this.logic);
    this.clearOwned(this.gridLines);
    this.clearOwned(this.preview);
    this.clearOwned(this.siteGhost);
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
    this.terrainGeometry.dispose();
    this.surfaceCache?.dispose();
    this.surfaceMaterial.dispose();
    this.library.dispose();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.DirectionalLight ||
        object instanceof THREE.SpotLight ||
        object instanceof THREE.PointLight
      )
        object.shadow.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    window.removeEventListener('blur', this.pointerCancel);
  }
}
