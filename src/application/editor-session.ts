import { availableBuiltinModels, prepareModelDocument } from '../io/builtin-resources';
import { prepareWaterDocument } from '../io/project-resources';
import type { RenderBounds, RenderInvalidation } from './render-invalidation';
import type {
  BrushSettings,
  Hex,
  MapDocument,
  Point,
  River,
  Tool,
  ViewSettings,
  SurfaceMaterialPack,
  SurfaceAsset,
} from '../core/types';
import { DEFAULT_BRUSH, DEFAULT_VIEW } from '../core/types';
import { createDocument, validateDocument } from '../core/document';
import { createDemo } from '../core/demo';
import { History, snapshot } from '../core/history';
import { hexDisk, hexIndex, hexLine, moveSite, paintTerritory, worldHex } from '../core/hex';
import {
  applySurfaceBrush,
  applyTerrainBrush,
  deriveHeights,
  forBrush,
  interpolateStroke,
  validateRiver,
} from '../core/terrain';
import { prepareResize } from '../core/map-resize';
import { riverConfluence } from '../core/river-water';
import type { ResizeCandidate } from '../core/map-resize';
import { containsPoint } from '../core/map-bounds';
import { prepareSurfaceDocument } from '../io/surface-resources';
import { hexWorld } from '../core/hex';
import { hashRandom, vegetationFilter } from '../core/vegetation';
type FactionMode = 'inspect' | 'list' | 'assign';
export class EditorSession {
  doc: MapDocument;
  heights: Float32Array;
  history = new History();
  tool: Tool = 'sites';
  showInputHints = true;
  terrainRevision = 0;
  resizePreview: (ResizeCandidate & { revision: number; documentVersion: number }) | null = null;
  brush: BrushSettings = { ...DEFAULT_BRUSH };
  view: ViewSettings = { ...DEFAULT_VIEW };
  assetId = 'city-jade';
  treeMode: 'paint' | 'select' = 'paint';
  documentVersion = 0;
  private brushAssets = { tree: 'tree-pine', grass: 'grass-reed' };
  private eraseModes = { tree: false, grass: false };
  siteKind: 'city' | 'fortress' = 'city';
  selectedSite: number | null = null;
  selectedTree: number | null = null;
  selectedFaction: number | null = null;
  selectedRiver: number | null = null;
  riverPreview: River | null = null;
  riverPoint: number | null = null;
  siteMode: 'select' | 'add' | 'erase' | 'place' | 'move' = 'select';
  factionMode: FactionMode = 'inspect';
  sitePreviewLocked = false;
  get sitePlacement() {
    return this.siteMode === 'place';
  }
  get movingSite() {
    return this.siteMode === 'move';
  }
  get siteCandidateValid() {
    const center = this.sitePreview;
    if (
      !center ||
      hexIndex(this.doc.grid, center) < 0 ||
      !containsPoint(this.doc.settings, hexWorld(this.doc.grid, center))
    )
      return false;
    return !this.doc.sites.some(
      (site) =>
        site.id !== this.selectedSite &&
        hexIndex(this.doc.grid, site.center) === hexIndex(this.doc.grid, center),
    );
  }
  get paintingTerritory() {
    return this.tool === 'sites' && (this.siteMode === 'add' || this.siteMode === 'erase');
  }
  sitePreview: Hex | null = null;
  dirty = false;
  revision = 0;
  uiRevision = 0;
  status = '欢迎来到山河。示例地图可直接编辑，也可新建空白地图。';
  error = '';
  hover: Point | null = null;
  busy = false;
  private before: MapDocument | null = null;
  private previous: Point | null = null;
  private listeners = new Set<() => void>();
  private viewListeners = new Set<() => void>();
  private uiTimer: ReturnType<typeof setTimeout> | null = null;
  private surfaceEdit: {
    documentVersion: number;
    revision: number;
    values: Pick<SurfaceMaterialPack, 'scale' | 'detail' | 'slopeRock'>;
  } | null = null;
  surfacePreview: Pick<SurfaceMaterialPack, 'scale' | 'detail' | 'slopeRock'> | null = null;
  surfaceLayerPreview: { index: number; asset: SurfaceAsset } | null = null;
  constructor(initial = createDemo()) {
    this.doc = prepareWaterDocument(prepareModelDocument(prepareSurfaceDocument(initial)));
    this.heights = deriveHeights(this.doc);
  }
  previewSurface(values: Partial<Pick<SurfaceMaterialPack, 'scale' | 'detail' | 'slopeRock'>>) {
    if (!this.surfaceEdit) {
      this.cancelStroke();
      const { scale, detail, slopeRock } = this.doc.surfaceMaterial;
      this.surfaceEdit = {
        documentVersion: this.documentVersion,
        revision: this.revision,
        values: { scale, detail, slopeRock },
      };
    }
    this.surfacePreview = { ...(this.surfacePreview ?? this.surfaceEdit.values), ...values };
    this.invalidateRender('material');
    this.notify();
  }
  commitSurface() {
    const edit = this.surfaceEdit,
      values = this.surfacePreview;
    this.surfaceEdit = null;
    this.surfacePreview = null;
    if (!edit || !values) return;
    if (edit.documentVersion !== this.documentVersion || edit.revision !== this.revision) {
      this.notify();
      return;
    }
    this.change('调整地表材质', (doc) => Object.assign(doc.surfaceMaterial, values));
  }
  cancelSurface() {
    if (this.surfacePreview) this.invalidateRender('material');
    this.surfaceEdit = null;
    this.surfacePreview = null;
    this.notify();
  }
  previewSurfaceLayer(index: number, asset: SurfaceAsset) {
    this.surfaceLayerPreview = { index, asset };
    this.invalidateRender('material');
    this.notify();
  }
  cancelSurfaceLayer() {
    if (!this.surfaceLayerPreview) return;
    this.surfaceLayerPreview = null;
    this.invalidateRender('material');
    this.notify();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  subscribeView = (fn: () => void) => {
    this.viewListeners.add(fn);
    return () => {
      this.viewListeners.delete(fn);
    };
  };
  private renderListeners = new Set<(change: RenderInvalidation) => void>();
  subscribeRender = (listener: (change: RenderInvalidation) => void) => {
    this.renderListeners.add(listener);
    return () => {
      this.renderListeners.delete(listener);
    };
  };
  private invalidateRender(
    kind: RenderInvalidation['kind'],
    bounds?: RenderBounds,
    models?: RenderInvalidation['models'],
  ) {
    const change = {
      documentVersion: this.documentVersion,
      revision: this.revision,
      kind,
      bounds,
      models,
    };
    this.renderListeners.forEach((listener) => listener(change));
  }
  getSnapshot = () => this.uiRevision;
  notify(immediate = true) {
    this.viewListeners.forEach((fn) => fn());
    if (immediate) {
      if (this.uiTimer) clearTimeout(this.uiTimer);
      this.uiTimer = null;
      this.uiRevision++;
      this.listeners.forEach((fn) => fn());
    } else if (!this.uiTimer)
      this.uiTimer = setTimeout(() => {
        this.uiTimer = null;
        this.uiRevision++;
        this.listeners.forEach((fn) => fn());
      }, 100);
  }
  message(text: string, error = false) {
    this.status = text;
    this.error = error ? text : '';
    this.notify();
  }
  private contentChanged(
    rebuildHeight = true,
    kind: RenderInvalidation['kind'] | null = 'all',
    models?: RenderInvalidation['models'],
  ) {
    if (rebuildHeight) {
      this.heights = deriveHeights(this.doc);
      this.terrainRevision++;
    }
    this.resizePreview = null;
    this.revision++;
    if (kind) this.invalidateRender(kind, undefined, models);
    this.dirty = true;
    this.error = '';
    this.notify();
  }
  change(label: string, fn: (doc: MapDocument) => void) {
    this.cancelStroke();
    const before = snapshot(this.doc);
    try {
      fn(this.doc);
      validateDocument(this.doc);
      if (this.history.commit(before, this.doc, label)) {
        this.status = label;
        const heightChanged =
          JSON.stringify(before.settings) !== JSON.stringify(this.doc.settings) ||
          JSON.stringify(before.rivers.map(({ name: _name, ...geometry }) => geometry)) !==
            JSON.stringify(this.doc.rivers.map(({ name: _name, ...geometry }) => geometry)) ||
          before.heights.length !== this.doc.heights.length ||
          before.heights.some((value, index) => value !== this.doc.heights[index]);
        const weightsChanged =
          before.surface.length !== this.doc.surface.length ||
          before.surface.some((value, index) => value !== this.doc.surface[index]);
        const materialChanged =
          JSON.stringify(before.surfaceMaterial, (key, value) =>
            key === 'bytes' ? undefined : value,
          ) !==
          JSON.stringify(this.doc.surfaceMaterial, (key, value) =>
            key === 'bytes' ? undefined : value,
          );
        const grassChanged =
          before.grass.length !== this.doc.grass.length ||
          before.grass.some(
            (layer, index) =>
              layer.density.length !== this.doc.grass[index].density.length ||
              layer.density.some((value, i) => value !== this.doc.grass[index].density[i]),
          );
        const models: NonNullable<RenderInvalidation['models']> = [];
        const assetState = (doc: MapDocument, kinds: string[]) =>
          doc.assets
            .filter((asset) => kinds.includes(asset.kind))
            .map(({ id, hash, scale, yaw, offset }) => ({ id, hash, scale, yaw, offset }));
        if (
          JSON.stringify([before.trees, assetState(before, ['tree'])]) !==
          JSON.stringify([this.doc.trees, assetState(this.doc, ['tree'])])
        )
          models.push('trees');
        const siteState = (doc: MapDocument) =>
          doc.sites.map(({ id, assetId, center, yaw, scale }) => ({
            id,
            assetId,
            center,
            yaw,
            scale,
          }));
        if (
          JSON.stringify([siteState(before), assetState(before, ['city', 'fortress'])]) !==
          JSON.stringify([siteState(this.doc), assetState(this.doc, ['city', 'fortress'])])
        )
          models.push('sites');
        const grassState = (doc: MapDocument) =>
          doc.grass.map(({ density: _density, ...metadata }) => metadata);
        if (
          grassChanged ||
          JSON.stringify([grassState(before), assetState(before, ['grass'])]) !==
            JSON.stringify([grassState(this.doc), assetState(this.doc, ['grass'])])
        )
          models.push('grass');
        const instancesChanged = models.length > 0;
        this.contentChanged(
          heightChanged,
          heightChanged ||
            Number(weightsChanged) + Number(materialChanged) + Number(instancesChanged) > 1
            ? 'all'
            : weightsChanged
              ? 'surface'
              : materialChanged
                ? 'material'
                : instancesChanged
                  ? 'instances'
                  : null,
          models,
        );
      } else this.notify();
    } catch (e) {
      this.doc = before;
      this.heights = deriveHeights(this.doc);
      this.terrainRevision++;
      this.invalidateRender('all');
      this.message(e instanceof Error ? e.message : '操作失败', true);
    }
  }
  replace(doc: MapDocument, includeBuiltinCatalog = false) {
    const candidate = prepareWaterDocument(prepareModelDocument(prepareSurfaceDocument(doc)));
    if (includeBuiltinCatalog) {
      const ids = new Set(candidate.assets.map((asset) => asset.id));
      candidate.assets = [
        ...candidate.assets,
        ...availableBuiltinModels().filter((asset) => !ids.has(asset.id)),
      ];
    }
    validateDocument(candidate);
    this.cancelStroke();
    this.surfaceEdit = null;
    this.surfacePreview = null;
    this.surfaceLayerPreview = null;
    this.doc = candidate;
    this.resizePreview = null;
    this.terrainRevision++;
    this.documentVersion++;
    this.heights = deriveHeights(candidate);
    this.history.clear();
    this.selectedSite = null;
    this.selectedTree = null;
    this.selectedFaction = null;
    this.selectedRiver = null;
    this.riverPreview = null;
    this.siteMode = 'select';
    this.factionMode = 'inspect';
    this.sitePreviewLocked = false;
    this.dirty = false;
    this.revision++;
    this.invalidateRender('all');
    this.message('地图已载入');
  }
  newMap(samples: number, width = 2048, depth = 2048) {
    this.replace(createDocument(samples, width, depth));
  }
  previewResize(width: number, depth: number) {
    if (this.riverPreview || this.sitePlacement || this.movingSite) {
      this.message('请先确认或取消当前预览', true);
      return;
    }
    try {
      const candidate = prepareResize(this.doc, width, depth);
      this.resizePreview = {
        ...candidate,
        revision: this.revision,
        documentVersion: this.documentVersion,
      };
      this.message('尺寸调整尚未应用，请核对预览与裁除统计。');
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error), true);
    }
  }
  commitResize() {
    const preview = this.resizePreview;
    if (!preview) return;
    if (preview.revision !== this.revision || preview.documentVersion !== this.documentVersion) {
      this.resizePreview = null;
      this.message('地图已变化，请重新生成尺寸预览。', true);
      return;
    }
    this.change('调整地面尺寸并裁剪内容', (doc) => Object.assign(doc, snapshot(preview.document)));
    this.resizePreview = null;
    this.selectedSite = null;
    this.selectedTree = null;
    this.selectedRiver = null;
    this.notify();
  }
  cancelResize() {
    this.resizePreview = null;
    this.message('已取消尺寸调整');
  }
  setViewLayer(layer: keyof ViewSettings, visible: boolean) {
    this.view[layer] = visible;
    this.notify();
  }
  setTool(tool: Tool) {
    this.commitSurface();
    this.cancelStroke();
    if (this.riverPreview && tool !== 'river') {
      this.message('请先确认或取消河流预览', true);
      return;
    }
    if (this.resizePreview && tool !== 'overview') {
      this.message('请先确认或取消地面尺寸调整。', true);
      return;
    }
    this.tool = tool;
    if (tool !== 'sites') this.selectedSite = null;
    if (tool !== 'trees') this.selectedTree = null;
    if (tool === 'trees' || tool === 'grass') {
      const kind = tool === 'trees' ? 'tree' : 'grass';
      this.assetId = this.brushAsset(kind)?.id ?? '';
      this.brush.erase = this.eraseModes[kind];
    }
    this.siteMode = 'select';
    this.factionMode = 'inspect';
    this.sitePreviewLocked = false;
    this.sitePreview = null;
    if (tool === 'grass' && this.brush.radius === 40) this.brush.radius = 20;
    this.error = '';
    this.notify();
  }
  selectSite(id: number) {
    if (!this.doc.sites.some((site) => site.id === id)) return;
    this.cancelStroke();
    const mode = this.paintingTerritory ? this.siteMode : 'select';
    this.selectedSite = id;
    this.selectedTree = null;
    this.selectedRiver = null;
    this.siteMode = mode;
    this.factionMode = 'inspect';
    this.sitePreview = null;
    this.sitePreviewLocked = false;
    this.tool = 'sites';
    this.notify();
  }
  setSiteMode(mode: 'select' | 'add' | 'erase') {
    this.cancelStroke();
    this.tool = 'sites';
    this.siteMode = mode;
    this.factionMode = 'inspect';
    this.sitePreview = null;
    this.sitePreviewLocked = false;
    this.notify();
  }
  beginMoveSite() {
    if (!this.selectedSite) return;
    this.cancelStroke();
    this.tool = 'sites';
    this.siteMode = 'move';
    this.sitePreview = null;
    this.sitePreviewLocked = false;
    this.message('点击新格心锁定位置，辖区保留原坐标；确认后提交。');
  }
  selectFaction(id: number) {
    this.cancelStroke();
    this.selectedFaction = id;
    this.selectedSite = null;
    this.factionMode = 'inspect';
    this.notify();
  }
  setFactionMode(mode: FactionMode) {
    if (
      mode !== 'inspect' &&
      (this.tool !== 'factions' || !this.doc.factions.some((f) => f.id === this.selectedFaction))
    )
      return;
    this.factionMode = mode;
    this.message(
      {
        inspect: '已结束势力添加',
        list: '从列表选择据点加入当前势力；再次点击添加据点或按 Esc 退出。',
        assign: '点击地图上的城池或要塞加入当前势力；完成或 Esc 退出。',
      }[mode],
    );
  }
  assignSiteFaction(siteId: number, factionId: number | null) {
    const site = this.doc.sites.find((s) => s.id === siteId);
    if (!site) return;
    if (site.factionId === factionId) {
      this.message('该据点已属于此势力');
      return;
    }
    const previous = this.doc.factions.find((f) => f.id === site.factionId)?.name ?? '未分配势力';
    this.change('设置据点所属势力', (doc) => {
      if (factionId !== null && !doc.factions.some((f) => f.id === factionId))
        throw new Error('目标势力不存在');
      doc.sites.find((s) => s.id === siteId)!.factionId = factionId;
    });
    if (!this.error)
      this.message(
        factionId === null
          ? '已移出势力，保留据点与辖区'
          : site.name +
              '：' +
              previous +
              ' → ' +
              this.doc.factions.find((f) => f.id === factionId)!.name,
      );
  }
  brushAsset(kind: 'tree' | 'grass') {
    return (
      this.doc.assets.find((asset) => asset.id === this.brushAssets[kind] && asset.kind === kind) ??
      this.doc.assets.find((asset) => asset.kind === kind)
    );
  }
  selectBrushAsset(kind: 'tree' | 'grass', id: string) {
    if (!this.doc.assets.some((asset) => asset.id === id && asset.kind === kind)) return;
    this.brushAssets[kind] = id;
    if ((kind === 'tree' && this.tool === 'trees') || (kind === 'grass' && this.tool === 'grass'))
      this.assetId = id;
    this.notify();
  }
  setVegetationMode(mode: 'paint' | 'erase' | 'select') {
    if (this.tool !== 'trees' && this.tool !== 'grass') return;
    if (mode === 'select' && this.tool !== 'trees') return;
    this.cancelStroke();
    this.treeMode = mode === 'select' ? 'select' : 'paint';
    if (mode !== 'select') {
      const kind = this.tool === 'trees' ? 'tree' : 'grass';
      this.eraseModes[kind] = this.brush.erase = mode === 'erase';
      this.selectedTree = null;
    }
    this.notify();
  }
  pickTree(id: number) {
    if (
      this.tool !== 'trees' ||
      this.treeMode !== 'select' ||
      !this.doc.trees.some((tree) => tree.id === id)
    )
      return;
    this.selectedTree = id;
    this.selectedSite = null;
    this.notify();
  }
  addAsset(asset: MapDocument['assets'][number], version: number) {
    if (version !== this.documentVersion) throw new Error('工程已切换，请重新导入模型');
    this.change('导入模型资源', (doc) => doc.assets.push(asset));
    if (this.error) throw new Error(this.error);
  }
  deleteAsset(id: string) {
    if (this.assetReferences(id)) {
      this.message('请先处理此资源的全部引用，再删除资源。', true);
      return false;
    }
    this.change('删除模型资源', (doc) => {
      doc.assets = doc.assets.filter((asset) => asset.id !== id);
    });
    if (this.error) return false;
    if (this.tool === 'trees' || this.tool === 'grass')
      this.assetId = this.brushAsset(this.tool === 'trees' ? 'tree' : 'grass')?.id ?? '';
    this.notify();
    return true;
  }
  setAsset(id: string) {
    const asset = this.doc.assets.find((item) => item.id === id);
    if (!asset) return;
    if (asset.kind === 'tree' || asset.kind === 'grass') {
      this.setTool(asset.kind === 'tree' ? 'trees' : 'grass');
      this.selectBrushAsset(asset.kind, id);
    } else {
      this.beginSite(asset.kind);
      this.assetId = id;
      this.notify();
    }
  }
  beginSite(kind: 'city' | 'fortress') {
    this.cancelStroke();
    this.tool = 'sites';
    this.siteKind = kind;
    this.assetId =
      this.doc.assets.find((a) => a.id === this.assetId && a.kind === kind)?.id ??
      this.doc.assets.find((a) => a.kind === kind)!.id;
    this.siteMode = 'place';
    this.sitePreviewLocked = false;
    this.selectedSite = null;
    this.sitePreview = null;
    this.message(`在地图上选择${kind === 'city' ? '城池' : '要塞'}中心，按 Enter 或确认放置`);
  }
  commitSite() {
    if (!this.sitePreview || !this.sitePreviewLocked) return;
    if (!this.siteCandidateValid) {
      this.message('候选中心越界或已被其他据点占用，请重新选择。', true);
      return;
    }
    const center = { ...this.sitePreview };
    if (this.movingSite && this.selectedSite) {
      this.change('移动据点', (doc) => moveSite(doc, this.selectedSite!, center));
      if (!this.error) {
        this.siteMode = 'select';
        this.sitePreview = null;
        this.sitePreviewLocked = false;
      }
    } else if (this.sitePlacement) {
      const assetId = this.assetId,
        kind = this.siteKind;
      let id = 0;
      this.change(`放置${kind === 'city' ? '城池' : '要塞'}`, (doc) => {
        const i = hexIndex(doc.grid, center);
        if (i < 0 || !containsPoint(doc.settings, hexWorld(doc.grid, center)))
          throw new Error('中心超出地图地面');
        if (doc.sites.some((s) => hexIndex(doc.grid, s.center) === i))
          throw new Error('此中心已被占用');
        id = doc.nextId++;
        doc.sites.push({
          id,
          kind,
          name: `${kind === 'city' ? '城池' : '要塞'} ${id}`,
          assetId,
          center,
          yaw: 0,
          scale: 1,
          factionId: null,
        });
        doc.owners[i] = id;
      });
      if (!this.error) {
        this.selectedSite = id;
        this.siteMode = 'select';
        this.sitePreview = null;
        this.sitePreviewLocked = false;
      }
    }
    this.notify();
  }
  deleteSite() {
    if (!this.selectedSite) return;
    const id = this.selectedSite;
    this.change('删除据点及其辖区', (doc) => {
      doc.sites = doc.sites.filter((s) => s.id !== id);
      doc.owners.forEach((owner, i) => {
        if (owner === id) doc.owners[i] = 0;
      });
    });
    this.selectedSite = null;
    this.siteMode = 'select';
    this.notify();
  }
  deleteFaction(id: number) {
    this.change('删除势力，保留成员据点与辖区', (doc) => {
      doc.factions = doc.factions.filter((f) => f.id !== id);
      doc.sites.forEach((s) => {
        if (s.factionId === id) s.factionId = null;
      });
    });
    if (this.selectedFaction === id) this.selectedFaction = null;
    this.factionMode = 'inspect';
    this.notify();
  }
  startRiver(id?: number) {
    this.cancelStroke();
    this.tool = 'river';
    const existing = this.doc.rivers.find((r) => r.id === id);
    this.riverPreview = existing
      ? structuredClone(existing)
      : { id: 0, name: `河流 ${this.doc.nextId}`, points: [], width: 24, depth: 6, waterLevel: 24 };
    this.riverPoint = null;
    this.message(
      existing
        ? '点击控制点选择；拖动修改，确认后应用。'
        : '依次点击添加河流控制点，确认后生成河床与水面。',
    );
  }
  renameRiver(id: number, value: string) {
    const name = value.trim();
    if (!name) {
      this.message('河流名称不能为空', true);
      return;
    }
    if (this.doc.rivers.find((river) => river.id === id)?.name === name) {
      this.error = '';
      this.notify();
      return;
    }
    this.change('重命名河流', (doc) => {
      const river = doc.rivers.find((item) => item.id === id);
      if (river) river.name = name;
    });
  }
  get riverConfluencePreview() {
    return this.riverPreview && !validateRiver(this.doc, this.riverPreview)
      ? riverConfluence(this.doc.rivers, this.riverPreview, this.doc.settings)
      : [];
  }
  get riverPreviewError(): string | null {
    if (!this.riverPreview) return null;
    const error = validateRiver(this.doc, this.riverPreview);
    if (error) return error;
    for (const river of this.riverConfluencePreview) {
      const invalid = validateRiver(this.doc, {
        ...river,
        waterLevel: this.riverPreview.waterLevel,
      });
      if (invalid) return `${river.name}：${invalid}`;
    }
    return null;
  }
  commitRiver() {
    if (!this.riverPreview) return;
    const candidate = structuredClone(this.riverPreview),
      error = this.riverPreviewError;
    if (error) {
      this.message(error, true);
      return;
    }
    candidate.name = candidate.name.trim();
    const connectedIds = new Set(this.riverConfluencePreview.map((river) => river.id));
    this.change('确认河流及交汇水位', (doc) => {
      if (!candidate.id) {
        candidate.id = doc.nextId++;
        doc.rivers.push(candidate);
      } else doc.rivers = doc.rivers.map((r) => (r.id === candidate.id ? candidate : r));
      for (const river of doc.rivers)
        if (connectedIds.has(river.id)) river.waterLevel = candidate.waterLevel;
    });
    if (!this.error) {
      this.selectedRiver = candidate.id;
      this.riverPreview = null;
      this.riverPoint = null;
      this.notify();
    }
  }
  cancelPreview() {
    this.cancelStroke();
    this.resizePreview = null;
    this.riverPreview = null;
    this.riverPoint = null;
    this.siteMode = 'select';
    this.factionMode = 'inspect';
    this.sitePreviewLocked = false;
    this.sitePreview = null;
    this.error = '';
    this.notify();
  }
  undo() {
    this.cancelSurface();
    this.cancelStroke();
    this.cancelPreview();
    const label = this.history.undo(this.doc);
    if (label) {
      this.status = `撤销：${label}`;
      this.contentChanged();
    }
  }
  redo() {
    this.cancelSurface();
    this.cancelStroke();
    this.cancelPreview();
    const label = this.history.redo(this.doc);
    if (label) {
      this.status = `重做：${label}`;
      this.contentChanged();
    }
  }
  clearSiteCandidate() {
    this.sitePreview = null;
    this.sitePreviewLocked = false;
    this.message('未命中地面，请在地图地面上重新选择位置', true);
  }
  hoverAt(point: Point | null) {
    this.hover = point;
    if ((this.sitePlacement || this.movingSite) && !this.sitePreviewLocked)
      this.sitePreview = point ? worldHex(this.doc.grid, point) : null;
    this.notify(false);
  }
  pickSite(id: number) {
    if (!this.doc.sites.some((site) => site.id === id)) return;
    if (this.tool === 'factions') {
      if (this.factionMode === 'assign') this.assignSiteFaction(id, this.selectedFaction);
      else this.notify();
    } else this.selectSite(id);
  }
  pointerDown(point: Point, shift: boolean) {
    if (this.busy) return;
    if (this.tool === 'river' && this.riverPreview) {
      const closest = this.riverPreview.points.findIndex(
        (p) => Math.hypot(p.x - point.x, p.z - point.z) < 14,
      );
      if (closest >= 0) {
        this.riverPoint = closest;
      } else {
        this.riverPreview.points.push(point);
        this.riverPoint = null;
      }
      this.notify();
      return;
    }
    if (this.sitePlacement || this.movingSite) {
      this.sitePreview = worldHex(this.doc.grid, point);
      this.sitePreviewLocked = true;
      this.message('已锁定中心，确认后提交；可再次点击改选位置。');
      return;
    }
    if (this.tool === 'factions') {
      this.message(
        this.factionMode === 'assign'
          ? '请点击可见的城池或要塞模型'
          : '点击添加据点，或使用列表选择',
      );
      return;
    }
    if (this.tool === 'sites' && !this.paintingTerritory) {
      this.selectedSite = null;
      this.notify();
      return;
    }
    if (this.tool === 'trees' && this.treeMode === 'select') {
      this.selectedTree = null;
      this.notify();
      return;
    }
    if (!['terrain', 'surface', 'trees', 'grass'].includes(this.tool) && !this.paintingTerritory)
      return;
    if (this.paintingTerritory && !this.selectedSite) {
      this.message('请先从据点列表选择城池或要塞', true);
      return;
    }
    if (this.tool === 'trees' || this.tool === 'grass') {
      const asset = this.brushAsset(this.tool === 'trees' ? 'tree' : 'grass');
      if (!asset) {
        this.message('当前分类没有模型，请先导入模型。', true);
        return;
      }
      this.assetId = asset.id;
    }
    this.before = snapshot(this.doc);
    this.previous = point;
    this.applyBrush(point, shift);
    this.notify(false);
  }
  pointerMove(point: Point, shift: boolean) {
    this.hover = point;
    if (this.tool === 'river' && this.riverPreview && this.riverPoint !== null) {
      this.riverPreview.points[this.riverPoint] = point;
      this.notify(false);
      return;
    }
    if (!this.before || !this.previous) {
      this.notify(false);
      return;
    }
    if (this.paintingTerritory) {
      const a = worldHex(this.doc.grid, this.previous),
        b = worldHex(this.doc.grid, point);
      for (const cell of hexLine(a, b))
        paintTerritory(
          this.doc,
          this.selectedSite!,
          hexDisk(cell, this.brush.hexRadius),
          this.siteMode === 'erase',
        );
    } else
      for (const p of interpolateStroke(
        this.previous,
        point,
        Math.max(1, this.brush.radius * 0.18),
      ))
        this.applyBrush(p, shift);
    this.previous = point;
    this.revision++;
    this.notify(false);
  }
  private applyBrush(point: Point, shift: boolean) {
    const b = this.brush,
      doc = this.doc;
    if (this.tool === 'terrain') {
      applyTerrainBrush(doc, point, b, shift);
      this.heights = deriveHeights(doc);
      this.terrainRevision++;
    } else if (this.tool === 'surface') applySurfaceBrush(doc, point, b);
    else if (this.paintingTerritory)
      paintTerritory(
        doc,
        this.selectedSite!,
        hexDisk(worldHex(doc.grid, point), b.hexRadius),
        this.siteMode === 'erase',
      );
    else if (this.tool === 'trees') {
      if (b.erase || shift) {
        doc.trees = doc.trees.filter(
          (t) => t.assetId !== this.assetId || Math.hypot(t.x - point.x, t.z - point.z) > b.radius,
        );
      } else {
        const asset =
          doc.assets.find((a) => a.id === this.assetId && a.kind === 'tree') ??
          doc.assets.find((a) => a.kind === 'tree')!;
        const valid = vegetationFilter(doc, this.heights),
          attempts = Math.min(
            300,
            Math.max(1, Math.round(((Math.PI * b.radius * b.radius * b.treeDensity) / 100) * 0.12)),
          );
        const seed = doc.nextId;
        for (let i = 0; i < attempts; i++) {
          const angle = hashRandom(i, 1, seed) * Math.PI * 2,
            radius = Math.sqrt(hashRandom(i, 2, seed)) * b.radius,
            p = { x: point.x + Math.cos(angle) * radius, z: point.z + Math.sin(angle) * radius };
          if (
            !valid(p, b.maxSlope) ||
            doc.trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < b.spacing)
          )
            continue;
          doc.trees.push({
            id: doc.nextId++,
            assetId: asset.id,
            maxSlope: b.maxSlope,
            ...p,
            yaw: hashRandom(i, 3, seed) * Math.PI * 2,
            scale: b.minScale + hashRandom(i, 4, seed) * (b.maxScale - b.minScale),
          });
        }
      }
    } else if (this.tool === 'grass') {
      const asset =
        doc.assets.find((a) => a.id === this.assetId && a.kind === 'grass') ??
        doc.assets.find((a) => a.kind === 'grass')!;
      let layer = doc.grass.find((g) => g.assetId === asset.id);
      if (!layer) {
        layer = {
          id: doc.nextId++,
          assetId: asset.id,
          density: new Float32Array(doc.heights.length),
          seed: doc.nextId * 271,
          version: 1,
          minScale: b.minScale,
          maxScale: b.maxScale,
          maxSlope: b.maxSlope,
          wind: 1,
        };
        doc.grass.push(layer);
      }
      const active = layer;
      forBrush(doc, point, b.radius, (i, d) => {
        const target = b.erase || shift ? 0 : b.grassDensity;
        active.density[i] += (target - active.density[i]) * Math.max(0.2, 1 - d / b.radius);
      });
    }
    this.revision++;
    const kind =
      this.tool === 'terrain'
        ? 'terrain'
        : this.tool === 'surface'
          ? 'surface'
          : this.tool === 'trees' || this.tool === 'grass'
            ? 'instances'
            : undefined;
    if (kind)
      this.invalidateRender(
        kind,
        {
          minX: point.x - b.radius,
          minZ: point.z - b.radius,
          maxX: point.x + b.radius,
          maxZ: point.z + b.radius,
        },
        this.tool === 'trees' ? ['trees'] : this.tool === 'grass' ? ['grass'] : undefined,
      );
  }
  endStroke() {
    if (!this.before) return;
    const labels: Partial<Record<Tool, string>> = {
      terrain: '地形雕刻',
      surface: '地表涂刷',
      trees: '树木笔刷',
      grass: '草丛笔刷',
      sites: '辖区绘制',
    };
    if (this.history.commit(this.before, this.doc, labels[this.tool] ?? '编辑地图')) {
      this.dirty = true;
      this.status = labels[this.tool] ?? '编辑地图';
    }
    this.before = null;
    this.previous = null;
    this.notify();
  }
  cancelStroke() {
    if (this.before) {
      this.doc = this.before;
      this.before = null;
      this.previous = null;
      this.heights = deriveHeights(this.doc);
      this.terrainRevision++;
      this.revision++;
      this.invalidateRender('all');
      this.notify();
    }
  }
  replaceModel(assetId: string, allTrees = false) {
    const asset = this.doc.assets.find((a) => a.id === assetId);
    if (!asset) return;
    this.change('替换模型', (doc) => {
      const site = doc.sites.find((s) => s.id === this.selectedSite);
      if (site) {
        if (site.kind !== asset.kind) throw new Error('据点模型类别不匹配');
        site.assetId = assetId;
        return;
      }
      const tree = doc.trees.find((t) => t.id === this.selectedTree);
      if (tree && asset.kind === 'tree') {
        const old = tree.assetId;
        for (const t of doc.trees)
          if (t.id === tree.id || (allTrees && t.assetId === old)) t.assetId = assetId;
      }
    });
  }
  assetReferences(id: string) {
    return (
      this.doc.trees.filter((t) => t.assetId === id).length +
      this.doc.sites.filter((s) => s.assetId === id).length +
      this.doc.grass.filter((g) => g.assetId === id).length
    );
  }
}
