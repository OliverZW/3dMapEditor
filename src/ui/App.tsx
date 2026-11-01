import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Mountain,
  Trees,
  Sprout,
  Waves,
  Castle,
  Flag,
  Paintbrush,
  Hexagon,
  Undo2,
  Redo2,
  FolderOpen,
  Save,
  Plus,
  Box,
  X,
  Search,
  Trash2,
  Check,
  SlidersHorizontal,
  ExternalLink,
  Shield,
  Info,
  Map,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EditorSession } from '../application/editor-session';
import { DesktopProjectSession } from '../application/desktop-project-session';
import { EditorViewport } from '../renderer/editor-viewport';
import type { DisplayQuality } from '../renderer/display-quality';
import { readDisplayPreference, writeDisplayPreference } from '../platform/display-preference';
import { importGlb } from '../renderer/models';
import type { AssetKind, ModelAsset, Tool } from '../core/types';
import { getFactionCells, hexIndex, worldHex } from '../core/hex';
import { assetReferenceCounts, isBuiltinAsset } from '../core/assets';
import { RiverInspector } from './RiverInspector';
import { decodeProject, encodeProject } from '../io/project';
import { decodeHeightPng, heightFiles, importHeights } from '../io/heightmap';
import type { DecodedHeight } from '../io/heightmap';
import { download, loadDraft, saveDraft, selectFile } from '../platform/files';
import { exportCocos, preflightCocos } from '../io/cocos-export';
import { ModelDetails } from './ModelDetails';
import { ModelImportForm } from './ModelImportForm';
import { VegetationPalette } from './VegetationPalette';
import { InspectorActions } from './InspectorActions';
import { BrushPalette } from './BrushPalette';
import { SurfaceInspector } from './SurfaceInspector';
import { SurfaceLibrary } from './SurfaceLibrary';
import { MapOverview, MapOverviewInspector, MapDimensions } from './MapOverview';
import { Button, Group, Slider, NumberField } from './controls';
import { FactionInspector } from './FactionInspector';
import { ViewportToolbar } from './ViewportToolbar';
import { OrientationGizmo } from './OrientationGizmo';
import { InputHints } from './InputHints';
import type { CameraNavigation } from '../renderer/camera-navigation';
import { SiteInspector } from './SiteInspector';
import { OperationGuide } from './OperationGuide';
const modelTriangleFormat = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const TOOLS: { id: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'overview', label: '概览', icon: Map, hint: '工程概览与地面尺寸' },
  { id: 'terrain', label: '地形', icon: Mountain, hint: '雕刻连续高度场' },
  { id: 'surface', label: '地表', icon: Paintbrush, hint: '四类地表权重涂刷' },
  { id: 'trees', label: '树木', icon: Trees, hint: '种植与擦除树木' },
  { id: 'grass', label: '草丛', icon: Sprout, hint: '绘制立体草丛密度' },
  { id: 'river', label: '河流', icon: Waves, hint: '控制点曲线与非破坏河床' },
  { id: 'sites', label: '据点', icon: Castle, hint: '据点与辖区：城池、要塞和范围绘制' },
  { id: 'factions', label: '势力', icon: Flag, hint: '据点所属势力与范围' },
];
const KIND_LABEL: Record<AssetKind, string> = {
  city: '城池',
  fortress: '要塞',
  tree: '树木',
  grass: '草丛',
};
const KIND_ICON: Record<AssetKind, LucideIcon> = {
  city: Castle,
  fortress: Shield,
  tree: Trees,
  grass: Sprout,
};
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'button,input,select,textarea,[tabindex="0"]',
            ),
          ].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0);
          if (!items.length) {
            event.preventDefault();
            return;
          }
          const first = items[0],
            last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''} ${className}`}
      >
        <div className="modal-title">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function App({
  initialSession,
  initialDesktop,
  onHome,
}: {
  initialSession?: EditorSession;
  initialDesktop?: DesktopProjectSession;
  onHome?: (create?: boolean) => void;
} = {}) {
  const [session] = useState(() => initialSession ?? new EditorSession());
  const [desktop] = useState(
    () =>
      initialDesktop ??
      (window.mapEditorDesktop
        ? new DesktopProjectSession(session, window.mapEditorDesktop)
        : null),
  );
  const closeRequest = useRef<string | null>(null);
  const importResolver = useRef<((id: string | null) => void) | null>(null);
  const importAlive = useRef(true);
  const [importDraft, setImportDraft] = useState<{ asset: ModelAsset; version: number } | null>(
    null,
  );
  const [importFailure, setImportFailure] = useState('');
  useEffect(() => {
    importAlive.current = true;
    return () => {
      importAlive.current = false;
      importResolver.current?.(null);
      importResolver.current = null;
    };
  }, []);
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  const inspectorElement = useRef<HTMLElement>(null);
  const viewportElement = useRef<HTMLDivElement>(null),
    viewport = useRef<EditorViewport | null>(null);
  const [displayPreference] = useState(() => readDisplayPreference());
  const [displayQuality, setDisplayQuality] = useState(displayPreference.quality);
  const displayQualityRef = useRef(displayQuality);
  const recreateViewport = useRef<((antialias?: boolean) => EditorViewport) | null>(null);
  function changeDisplayQuality(next: DisplayQuality) {
    if (next === displayQuality || !recreateViewport.current) return;
    if (session.busy || viewport.current?.interactionActive) {
      session.message('请先完成当前操作，再切换显示档位。', true);
      return;
    }
    const previous = displayQualityRef.current;
    try {
      displayQualityRef.current = next;
      recreateViewport.current();
      setDisplayQuality(next);
    } catch (error) {
      displayQualityRef.current = previous;
      try {
        recreateViewport.current();
      } catch (restoreError) {
        setFatal(`显示档位切换后无法恢复视口：${String(restoreError)}`);
      }
      report(error);
      return;
    }
    try {
      writeDisplayPreference(next);
    } catch (error) {
      session.message(`显示档位已切换，但无法保存本机偏好：${String(error)}`, true);
    }
  }
  const [modal, setModal] = useState<
      'resources' | 'details' | 'surface' | 'export' | 'new' | 'help' | null
    >(null),
    [category, setCategory] = useState<AssetKind>('tree'),
    [search, setSearch] = useState(''),
    [resourceId, setResourceId] = useState('tree-pine');
  const [stats, setStats] = useState({
      idle: false,
      fps: 0,
      calls: 0,
      triangles: 0,
      modelTriangles: 0,
      grass: 0,
      trees: 0,
      terrainMeshes: 1,
    }),
    [navigation, setNavigation] = useState<CameraNavigation | null>(null),
    [newSamples, setNewSamples] = useState(513),
    [newWidth, setNewWidth] = useState(2048),
    [newDepth, setNewDepth] = useState(2048),
    [draftStatus, setDraftStatus] = useState('本地编辑'),
    [draft, setDraft] = useState<{ bytes: Uint8Array; date: number } | undefined>();
  const [guard, setGuard] = useState<(() => void) | null>(null),
    [heightImport, setHeightImport] = useState<DecodedHeight | null>(null),
    [heightMin, setHeightMin] = useState(0),
    [heightMax, setHeightMax] = useState(256),
    [flipZ, setFlipZ] = useState(false);
  const guardCancel = useRef<(() => void) | null>(null);
  const [exportOptions, setExportOptions] = useState({
      trees: true,
      grass: true,
      water: true,
      sites: true,
      logic: true,
    }),
    [exportResult, setExportResult] = useState<string[]>([]),
    [fatal, setFatal] = useState('');
  const doc = session.doc,
    b = session.brush,
    site =
      session.tool === 'sites' ? doc.sites.find((s) => s.id === session.selectedSite) : undefined,
    tree =
      session.tool === 'trees' && session.treeMode === 'select'
        ? doc.trees.find((t) => t.id === session.selectedTree)
        : undefined,
    activeTool = TOOLS.find((t) => t.id === session.tool)!;
  const activeAsset =
    session.tool === 'trees' || session.tool === 'grass'
      ? session.brushAsset(session.tool === 'trees' ? 'tree' : 'grass')
      : doc.assets.find((a) => a.id === session.assetId);
  const resource = doc.assets.find((a) => a.id === resourceId);
  const referenceCounts = useMemo(() => assetReferenceCounts(doc), [doc, session.revision]);
  function updateBrush<K extends keyof typeof b>(key: K, value: (typeof b)[K]) {
    session.brush[key] = value;
    session.notify();
  }
  function uiAction(fn: () => void) {
    if (session.busy) {
      session.message('请等待当前操作完成', true);
      return;
    }
    if (
      session.riverPreview ||
      session.sitePlacement ||
      session.movingSite ||
      session.resizePreview
    ) {
      session.message('请先确认或取消当前预览', true);
      return;
    }
    if (session.dirty) setGuard(() => fn);
    else fn();
  }
  async function save() {
    if (session.busy) {
      session.message('请等待当前操作完成', true);
      return false;
    }
    try {
      if (
        session.riverPreview ||
        session.sitePlacement ||
        session.movingSite ||
        session.resizePreview
      )
        throw new Error('请先确认或取消当前预览');
      session.endStroke();
      session.commitSurface();
      if (desktop) {
        session.busy = true;
        session.notify();
        return await desktop.save();
      }
      const revision = session.revision;
      download(encodeProject(doc), `${doc.name}.map3d`);
      if (session.revision === revision) session.dirty = false;
      session.message('已生成工程下载，请在浏览器下载列表中确认文件。');
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      if (desktop) {
        session.busy = false;
        session.notify();
      }
    }
  }
  function report(e: unknown) {
    session.message(e instanceof Error ? e.message : String(e), true);
  }
  async function open() {
    if (session.busy) return;
    try {
      if (desktop) {
        session.busy = true;
        session.notify();
        if (await desktop.open()) viewport.current?.frameMap();
        return;
      }
      const file = await selectFile('.map3d');
      if (!file) return;
      const candidate = decodeProject(new Uint8Array(await file.arrayBuffer()));
      session.replace(candidate, true);
      viewport.current?.frameMap();
    } catch (e) {
      report(e);
    } finally {
      if (desktop) {
        session.busy = false;
        session.notify();
      }
    }
  }
  async function backup() {
    const bridge = window.mapEditorDesktop;
    if (!bridge || session.busy) return;
    try {
      if (
        session.riverPreview ||
        session.sitePlacement ||
        session.movingSite ||
        session.resizePreview
      )
        throw new Error('请先确认或取消当前预览');
      session.endStroke();
      session.commitSurface();
      session.busy = true;
      session.notify();
      if (await bridge.saveBackup(session.doc.name, encodeProject(session.doc)))
        session.message('自包含备份已保存');
    } catch (error) {
      report(error);
    } finally {
      session.busy = false;
      session.notify();
    }
  }
  async function restore() {
    const bridge = window.mapEditorDesktop;
    if (!bridge || !desktop || session.busy) return;
    try {
      session.busy = true;
      session.notify();
      const bytes = await bridge.selectBackup();
      if (bytes && (await desktop.restore(bytes))) viewport.current?.frameMap();
    } catch (error) {
      report(error);
    } finally {
      session.busy = false;
      session.notify();
    }
  }
  function cancelGuard() {
    if (session.busy) return;
    setGuard(null);
    guardCancel.current?.();
    guardCancel.current = null;
    const id = closeRequest.current;
    closeRequest.current = null;
    if (id) void window.mapEditorDesktop?.finishClose(id, false).catch(report);
  }
  useEffect(() => {
    const bridge = window.mapEditorDesktop;
    if (!desktop || !bridge) return;
    return bridge.onOpenProject((handle) => {
      if (
        session.busy ||
        guard ||
        guardCancel.current ||
        modal ||
        heightImport ||
        importDraft ||
        importFailure ||
        session.riverPreview ||
        session.resizePreview ||
        session.sitePlacement ||
        session.movingSite
      ) {
        void bridge.releaseProject(handle.token);
        session.message('请先完成当前操作，再打开工程', true);
        return;
      }
      const openExternal = () => {
        session.busy = true;
        session.notify();
        void desktop
          .open(handle)
          .then((opened) => {
            if (opened) viewport.current?.frameMap();
          })
          .catch(report)
          .finally(() => {
            session.busy = false;
            session.notify();
          });
      };
      if (session.dirty) {
        guardCancel.current = () => {
          void bridge.releaseProject(handle.token);
        };
        setGuard(() => openExternal);
      } else openExternal();
    });
  });
  useEffect(
    () => () => {
      guardCancel.current?.();
      guardCancel.current = null;
    },
    [],
  );
  useEffect(() => {
    const bridge = window.mapEditorDesktop;
    if (!bridge) return;
    return bridge.onCloseRequest((id) => {
      if (
        session.busy ||
        session.riverPreview ||
        session.sitePlacement ||
        session.movingSite ||
        session.resizePreview
      ) {
        session.message('请先完成当前操作或确认、取消预览，再退出', true);
        void bridge.finishClose(id, false).catch(report);
        return;
      }
      session.endStroke();
      session.commitSurface();
      const finish = () => {
        closeRequest.current = null;
        viewport.current?.dispose();
        viewport.current = null;
        void bridge.finishClose(id, true).catch(report);
      };
      if (session.dirty) {
        closeRequest.current = id;
        setGuard(() => finish);
      } else finish();
    });
  }, [session]);
  async function importHeight() {
    try {
      const file = await selectFile('.png');
      if (!file) return;
      const image = decodeHeightPng(new Uint8Array(await file.arrayBuffer()));
      setHeightImport(image);
      setHeightMin(doc.settings.minHeight);
      setHeightMax(doc.settings.maxHeight);
    } catch (e) {
      report(e);
    }
  }
  function exportHeight() {
    try {
      const { png, metadata } = heightFiles(doc);
      download(png, `${doc.name}-height16.png`, 'image/png');
      download(
        new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
        `${doc.name}-height16.terrain.json`,
        'application/json',
      );
      session.message('已生成 16 位灰度高度图与方向参数下载。');
    } catch (e) {
      report(e);
    }
  }
  async function importModel(kind: AssetKind): Promise<string | null> {
    if (session.busy) return null;
    const version = session.documentVersion;
    try {
      session.busy = true;
      session.notify();
      const file = await selectFile('.glb');
      if (!file) return null;
      session.message('正在检查并读取模型…');
      const asset = await importGlb(file, kind);
      if (!importAlive.current) return null;
      if (version !== session.documentVersion) throw new Error('工程已切换，请重新导入模型');
      setImportDraft({ asset, version });
      return await new Promise<string | null>((resolve) => {
        importResolver.current = resolve;
      });
    } catch (error) {
      report(error);
      if (importAlive.current)
        setImportFailure(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      session.busy = false;
      session.notify();
    }
  }
  function finishImport(asset?: ModelAsset): string | null {
    if (asset && importDraft) {
      try {
        session.addAsset(asset, importDraft.version);
        setResourceId(asset.id);
        setCategory(asset.kind);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    const resolve = importResolver.current;
    importResolver.current = null;
    setImportDraft(null);
    resolve?.(asset?.id ?? null);
    return null;
  }
  useEffect(() => {
    let alive = true;
    let hostVisible = true;
    const releaseVisibility = window.mapEditorDesktop?.onWindowVisibility?.((visible) => {
      hostVisible = visible;
      viewport.current?.setHostVisible(visible);
    });
    let releaseProbe: (() => void) | undefined;
    let lastViewPose: ReturnType<CameraNavigation['captureView']> | undefined;
    const createView = (antialias?: boolean, previousSurface = false) => {
      lastViewPose = viewport.current?.navigation.captureView() ?? lastViewPose;
      viewport.current?.dispose();
      viewport.current = null;
      const view = new EditorViewport(viewportElement.current!, session, {
        diagnosticAntialias: antialias,
        diagnosticPreviousSurface: previousSurface,
        displayQuality: displayQualityRef.current,
      });
      if (lastViewPose) view.navigation.restoreView(lastViewPose);
      view.setHostVisible(hostVisible);
      view.onStats = setStats;
      viewport.current = view;
      setNavigation(view.navigation);
      return view;
    };
    recreateViewport.current = createView;
    try {
      createView();
      if (displayPreference.warning) session.message(displayPreference.warning, true);
      if (window.mapEditorDesktop?.performanceProbeEnabled)
        void import('../renderer/performance-probe')
          .then(({ installPerformanceProbe }) => {
            if (alive)
              releaseProbe = installPerformanceProbe(session, createView, () => viewport.current!);
          })
          .catch((error) => {
            if (alive) setFatal(String(error));
          });
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
    if (!desktop)
      void loadDraft()
        .then(setDraft)
        .catch((e) => setDraftStatus(`草稿不可用：${String(e)}`));
    return () => {
      alive = false;
      recreateViewport.current = null;
      releaseProbe?.();
      releaseVisibility?.();
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [session]);
  useEffect(() => {
    let savedRevision = -1;
    const timer = setInterval(() => {
      if (!desktop && session.dirty && session.revision !== savedRevision && !session.busy) {
        try {
          const revision = session.revision,
            bytes = encodeProject(session.doc);
          void saveDraft(bytes)
            .then(() => {
              savedRevision = revision;
              setDraftStatus(
                `草稿 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
              );
            })
            .catch((e) => setDraftStatus(`草稿保存失败：${String(e)}`));
        } catch (e) {
          setDraftStatus(`草稿保存失败：${String(e)}`);
        }
      }
    }, 30000);
    const unload = (e: BeforeUnloadEvent) => {
      if (!desktop && session.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', unload);
    };
  }, [session, desktop]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (
        e.key === 'Escape' &&
        !modal &&
        !heightImport &&
        !guard &&
        session.tool === 'factions' &&
        session.factionMode !== 'inspect' &&
        (!navigation || navigation.getSnapshot().gesture === 'idle')
      ) {
        e.preventDefault();
        session.setFactionMode('inspect');
        return;
      }
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if ((e.key === 'Enter' || e.code === 'Space') && (e.target as HTMLElement).closest('button'))
        return;
      if ((modal || heightImport || guard || importDraft || importFailure) && e.key !== 'Escape')
        return;
      if (navigation && navigation.getSnapshot().gesture !== 'idle') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? session.redo() : session.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        session.redo();
      } else if (e.key === 'Escape') {
        if (modal) setModal(null);
        else if (heightImport) setHeightImport(null);
        else if (guard) cancelGuard();
        else if (session.resizePreview) session.cancelResize();
        else if (session.riverPreview || session.sitePlacement || session.movingSite)
          session.cancelPreview();
        else {
          session.selectedSite = null;
          session.selectedTree = null;
          session.notify();
        }
      } else if (!modal && e.key === 'Enter') {
        if (session.riverPreview) session.commitRiver();
        else if (session.resizePreview) {
          session.commitResize();
          if (!session.error) viewport.current?.frameMap();
        } else session.commitSite();
      } else if (!modal && e.key === 'Delete') {
        if (session.riverPreview && session.riverPoint !== null) {
          if (session.riverPreview.points.length > 2) {
            session.riverPreview.points.splice(session.riverPoint, 1);
            session.riverPoint = null;
            session.notify();
          }
        } else if (session.selectedTree) {
          const id = session.selectedTree;
          session.change('删除树木', (d) => {
            d.trees = d.trees.filter((t) => t.id !== id);
          });
          session.selectedTree = null;
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    viewport.current?.setInputBlocked(
      !!modal || !!heightImport || !!guard || !!importDraft || !!importFailure || session.busy,
    );
  }, [modal, heightImport, guard, importDraft, importFailure, navigation, session.busy]);
  useEffect(() => {
    const content = inspectorElement.current?.querySelector('.inspector-content');
    if (content) content.scrollTop = 0;
  }, [
    session.tool,
    session.selectedSite,
    session.selectedTree,
    session.selectedFaction,
    session.selectedRiver,
  ]);
  function openResources(kind?: AssetKind) {
    if (session.resizePreview) {
      session.message('请先确认或取消地面尺寸调整。', true);
      return;
    }
    const selectedResource = kind
      ? doc.assets.find((asset) => asset.kind === kind)
      : doc.assets.find((asset) => asset.id === session.assetId);
    const resourceKind = kind ?? selectedResource?.kind ?? category;
    setCategory(resourceKind);
    setModal('resources');
    setResourceId(
      selectedResource?.id ?? doc.assets.find((asset) => asset.kind === resourceKind)?.id ?? '',
    );
  }
  const centerHex = session.hover ? worldHex(doc.grid, session.hover) : null;
  return (
    <div className="editor-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Mountain size={25} />
          </div>
          <div>
            <strong>
              山河<span>MAP STUDIO</span>
            </strong>
            <small>三维战略地图编辑器</small>
          </div>
        </div>
        <div className="document-name">
          <span className={session.dirty ? 'dirty-dot' : 'clean-dot'} />
          {doc.name}
          <small>{desktop ? '.map3dproj' : '.map3d'}</small>
        </div>
        <div className="header-right">
          <span className="version-tag">本地工程 · 0.2</span>
          <Button icon={Info} onClick={() => setModal('help')}>
            操作指南
          </Button>
        </div>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          {onHome && <Button onClick={() => uiAction(() => onHome())}>返回首页</Button>}
          <Button
            icon={Plus}
            onClick={() => uiAction(() => (onHome ? onHome(true) : setModal('new')))}
          >
            新建
          </Button>
          <Button icon={FolderOpen} onClick={() => uiAction(() => void open())}>
            打开
          </Button>
          <Button icon={Save} onClick={() => void save()} title="Ctrl + S" disabled={session.busy}>
            保存工程
          </Button>
          {desktop && (
            <Button onClick={() => void backup()} disabled={session.busy}>
              导出备份
            </Button>
          )}
          {desktop && (
            <Button onClick={() => uiAction(() => void restore())} disabled={session.busy}>
              恢复备份
            </Button>
          )}
        </div>
        <div className="toolbar-group">
          <Button
            icon={Undo2}
            onClick={() => session.undo()}
            disabled={!session.history.canUndo}
            title={session.history.undoLabel}
          >
            撤销
          </Button>
          <Button
            icon={Redo2}
            onClick={() => session.redo()}
            disabled={!session.history.canRedo}
            title={session.history.redoLabel}
          >
            重做
          </Button>
        </div>
        <div className="toolbar-group height-tools">
          <Button icon={ArrowDownToLine} onClick={() => void importHeight()}>
            导入高度图
          </Button>
          <Button icon={ArrowUpFromLine} onClick={exportHeight}>
            导出高度图
          </Button>
        </div>
        <div className="toolbar-spacer" />
        <Button icon={Box} onClick={() => openResources()}>
          资源库 <span className="count-tag">{doc.assets.length}</span>
        </Button>
        <Button
          className="primary export-button"
          icon={ExternalLink}
          onClick={() => {
            if (
              session.resizePreview ||
              session.riverPreview ||
              session.sitePlacement ||
              session.movingSite
            ) {
              session.message('请先确认或取消当前预览，再导出资源。', true);
              return;
            }
            setExportResult(preflightCocos(doc));
            setModal('export');
          }}
        >
          Cocos 导出
        </Button>
      </div>
      <main className="workspace">
        <aside className="tool-rail">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.hint}
              className={session.tool === t.id ? 'selected' : ''}
              onClick={() => session.setTool(t.id)}
            >
              <t.icon size={22} />
              <span>{t.label}</span>
            </button>
          ))}
          <div className="rail-bottom">
            <Map size={19} />
            <small>Y ↑</small>
          </div>
        </aside>
        <aside
          className={
            'left-panel ' + (['trees', 'grass'].includes(session.tool) ? 'vegetation-panel' : '')
          }
        >
          <div className="panel-heading">
            <h2>{session.tool === 'overview' ? '工程概览' : activeTool.label + '编辑'}</h2>
            <activeTool.icon size={17} />
          </div>
          <p className="panel-description">{activeTool.hint}</p>
          {session.tool === 'overview' && <MapOverview session={session} />}
          {(session.tool === 'terrain' || session.tool === 'surface') && (
            <BrushPalette session={session} />
          )}
          {(session.tool === 'trees' || session.tool === 'grass') && (
            <VegetationPalette
              key={session.tool}
              session={session}
              kind={session.tool === 'trees' ? 'tree' : 'grass'}
              onImport={(kind) => importModel(kind)}
              onDetails={(id) => {
                setResourceId(id);
                setModal('details');
              }}
            />
          )}
          {session.tool === 'river' && (
            <>
              <Button
                icon={Plus}
                className="full primary"
                disabled={!!session.riverPreview}
                onClick={() => session.startRiver()}
              >
                新建河流
              </Button>
              <div className="list-heading">
                地图河流 <span>{doc.rivers.length}</span>
              </div>
              {doc.rivers.map((r) => (
                <button
                  key={r.id}
                  className={`object-row ${session.selectedRiver === r.id ? 'selected' : ''}`}
                  onClick={() => {
                    session.selectedRiver = r.id;
                    session.notify();
                  }}
                >
                  <Waves size={18} />
                  <span>
                    {r.name}
                    <small>
                      {r.points.length} 个节点 · 宽 {r.width} m
                    </small>
                  </span>
                </button>
              ))}
              <p className="tip">河床、控制点和水面独立保存。确认河流后统一更新树草贴地。</p>
            </>
          )}
          {session.tool === 'sites' && (
            <>
              <div className="two-buttons">
                <Button icon={Castle} onClick={() => session.beginSite('city')}>
                  新建城池
                </Button>
                <Button icon={Shield} onClick={() => session.beginSite('fortress')}>
                  新建要塞
                </Button>
              </div>
              <div className="list-heading">
                地图据点 <span>{doc.sites.length}</span>
              </div>
              {doc.sites.map((s) => (
                <button
                  key={s.id}
                  className={`object-row ${site?.id === s.id ? 'selected' : ''}`}
                  onClick={() => session.selectSite(s.id)}
                >
                  <KindIcon kind={s.kind} size={19} />
                  <span>
                    {s.name}
                    <small>
                      {KIND_LABEL[s.kind]} ·{' '}
                      {doc.factions.find((f) => f.id === s.factionId)?.name ?? '未分配势力'}
                    </small>
                  </span>
                  <i
                    style={{
                      background:
                        doc.factions.find((f) => f.id === s.factionId)?.color ?? '#88939a',
                    }}
                  />
                </button>
              ))}
              {!doc.sites.length && <p className="empty">放置一座城池，开始构建山河。</p>}
            </>
          )}
          {session.paintingTerritory && (
            <div className="info-card blue">
              <Hexagon size={20} />
              <strong>{site ? `正在绘制：${site.name}` : '请先选择据点'}</strong>
              <p>允许飞地与跨水域辖区。其他据点的中心始终受保护。</p>
            </div>
          )}
          {session.tool === 'factions' && (
            <>
              <Button
                className="full primary"
                icon={Plus}
                onClick={() => {
                  session.setFactionMode('inspect');
                  session.change('新增势力', (d) => {
                    const id = d.nextId++;
                    d.factions.push({
                      id,
                      name: `势力 ${d.factions.length + 1}`,
                      color: ['#6696aa', '#bd8d62', '#969a6a', '#a9839d'][d.factions.length % 4],
                    });
                    session.selectedFaction = id;
                  });
                }}
              >
                新增势力
              </Button>
              <div className="list-heading">
                势力列表 <span>{doc.factions.length}</span>
              </div>
              {doc.factions.map((f) => (
                <button
                  key={f.id}
                  className={`object-row ${f.id === session.selectedFaction ? 'selected' : ''}`}
                  onClick={() => {
                    session.selectFaction(f.id);
                  }}
                >
                  <i className="faction-square" style={{ background: f.color }} />
                  <span>
                    {f.name}
                    <small>
                      {doc.sites.filter((s) => s.factionId === f.id).length} 个据点 ·{' '}
                      {getFactionCells(doc, f.id).length} 格
                    </small>
                  </span>
                </button>
              ))}
              <p className="tip">势力范围由成员据点的中心与辖区自动合并。</p>
            </>
          )}
        </aside>
        <section className="viewport-column">
          <div className="viewport" ref={viewportElement}>
            {fatal && (
              <div className="viewport-error">
                <h2>三维视口无法启动</h2>
                <p>{fatal}</p>
                <p>请使用支持 WebGL2 的桌面浏览器，并开启硬件加速。</p>
              </div>
            )}
          </div>
          {navigation && (
            <>
              <div className="viewport-toolbar">
                <ViewportToolbar
                  session={session}
                  navigation={navigation}
                  displayQuality={displayQuality}
                  onDisplayQuality={changeDisplayQuality}
                />
              </div>
              <OrientationGizmo navigation={navigation} />
            </>
          )}
          <div className="viewport-bottom">
            {navigation && (
              <span className="performance" aria-label="渲染统计">
                <span>
                  {stats.idle ? (
                    '静止 · 按需刷新'
                  ) : (
                    <>
                      <b>{stats.fps || '—'}</b> FPS
                    </>
                  )}
                </span>
                <i aria-hidden="true" />
                <span>
                  <b>{stats.calls}</b> Draw
                </span>
                <i aria-hidden="true" />
                <span aria-label={`模型面数 ${stats.modelTriangles} 三角面`}>
                  <b>{modelTriangleFormat.format(stats.modelTriangles)}</b> 模型面数
                </span>
              </span>
            )}
            {navigation && session.showInputHints && (
              <InputHints session={session} navigation={navigation} />
            )}
          </div>
        </section>
        <aside className="inspector" ref={inspectorElement}>
          <div className="panel-heading">
            <h2>
              {session.tool === 'overview'
                ? '地图设置'
                : site
                  ? '据点属性'
                  : tree
                    ? '树木属性'
                    : '工具属性'}
            </h2>
            <SlidersHorizontal size={16} />
          </div>
          {session.tool === 'overview' ? (
            <MapOverviewInspector
              key={session.documentVersion + ':' + doc.settings.width + ':' + doc.settings.depth}
              session={session}
              onApplied={() => viewport.current?.frameMap()}
            />
          ) : (
            <>
              {session.tool !== 'terrain' && session.tool !== 'surface' && (
                <InspectorActions session={session} />
              )}
              <div className="inspector-content">
                {['terrain', 'surface', 'trees', 'grass'].includes(session.tool) &&
                  !(session.tool === 'trees' && session.treeMode === 'select') && (
                    <>
                      <Group title="画刷设置" tag="BRUSH">
                        <Slider
                          label="半径"
                          value={b.radius}
                          min={4}
                          max={200}
                          unit="m"
                          onChange={(v) => updateBrush('radius', v)}
                        />
                        {['terrain', 'surface'].includes(session.tool) && (
                          <Slider
                            label="强度"
                            value={b.strength * 100}
                            min={1}
                            max={100}
                            unit="%"
                            onChange={(v) => updateBrush('strength', v / 100)}
                          />
                        )}
                        <Slider
                          label="边缘衰减"
                          value={b.falloff * 100}
                          min={1}
                          max={100}
                          unit="%"
                          onChange={(v) => updateBrush('falloff', v / 100)}
                        />
                        {session.tool === 'terrain' && b.terrainMode === 'flatten' && (
                          <NumberField
                            label="目标高度 (m)"
                            value={b.height}
                            min={0}
                            max={256}
                            onChange={(v) => updateBrush('height', v)}
                          />
                        )}
                      </Group>
                      {session.tool === 'surface' && (
                        <SurfaceInspector session={session} onLibrary={() => setModal('surface')} />
                      )}
                      {(session.tool === 'trees' || session.tool === 'grass') && (
                        <Group title="分布与避让">
                          <Slider
                            label={session.tool === 'trees' ? '密度 · 株/100m²' : '密度 · 丛/m²'}
                            value={session.tool === 'trees' ? b.treeDensity : b.grassDensity}
                            min={0.1}
                            max={session.tool === 'trees' ? 20 : 4}
                            step={0.1}
                            onChange={(v) =>
                              updateBrush(
                                session.tool === 'trees' ? 'treeDensity' : 'grassDensity',
                                v,
                              )
                            }
                          />
                          <div className="inline-fields">
                            <NumberField
                              label="缩放下限"
                              value={b.minScale}
                              min={0.3}
                              max={b.maxScale}
                              step={0.1}
                              onChange={(v) => updateBrush('minScale', v)}
                            />
                            <NumberField
                              label="缩放上限"
                              value={b.maxScale}
                              min={b.minScale}
                              max={3}
                              step={0.1}
                              onChange={(v) => updateBrush('maxScale', v)}
                            />
                          </div>
                          <Slider
                            label="最大坡度"
                            value={b.maxSlope}
                            min={0}
                            max={60}
                            unit="°"
                            onChange={(v) => updateBrush('maxSlope', v)}
                          />
                          {session.tool === 'trees' && (
                            <Slider
                              label="最小间距"
                              value={b.spacing}
                              min={1}
                              max={20}
                              unit="m"
                              onChange={(v) => updateBrush('spacing', v)}
                            />
                          )}
                          <div className="check-line">
                            <Check size={13} /> 自动避让水域和据点模型
                          </div>
                          <div className="check-line">
                            <Check size={13} /> 地形变化后重新贴地
                          </div>
                        </Group>
                      )}
                      {session.tool === 'grass' && (
                        <Group title="草层显示">
                          <p className="tip">淡出距离 60–80 m · 预算 50,000 丛</p>
                          <div className="overview-row">
                            <span>当前显示</span>
                            <b>{stats.grass.toLocaleString()} 丛</b>
                          </div>
                          <Button
                            icon={Trash2}
                            className="full"
                            onClick={() => {
                              if (window.confirm('清空当前草模型的草层密度？可撤销。'))
                                session.change('清空草层', (d) =>
                                  d.grass
                                    .filter(
                                      (g) =>
                                        g.assetId ===
                                        (activeAsset?.kind === 'grass'
                                          ? activeAsset.id
                                          : 'grass-reed'),
                                    )
                                    .forEach((g) => g.density.fill(0)),
                                );
                            }}
                          >
                            清空当前草层
                          </Button>
                        </Group>
                      )}
                    </>
                  )}
                {site && !session.sitePlacement && <SiteInspector session={session} site={site} />}
                {(session.sitePlacement || session.movingSite) && (
                  <Group title="放置预览">
                    {session.sitePlacement && (
                      <label className="text-field">
                        {KIND_LABEL[session.siteKind]}模型
                        <select
                          value={session.assetId}
                          onChange={(e) => {
                            session.assetId = e.target.value;
                            session.notify();
                          }}
                        >
                          {doc.assets
                            .filter((a) => a.kind === session.siteKind)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <p className="tip">
                      模型吸附六边形格心。左键点击锁定位置，再确认；可再次点击改选。
                    </p>
                    {session.sitePreview && (
                      <div className="coordinate-tag">
                        q {session.sitePreview.q} / r {session.sitePreview.r}
                      </div>
                    )}
                  </Group>
                )}
                {tree && (
                  <Group title={`树木实例 · ${tree.id}`}>
                    <label className="text-field">
                      模型
                      <select
                        value={tree.assetId}
                        onChange={(e) => session.replaceModel(e.target.value)}
                      >
                        {doc.assets
                          .filter((a) => a.kind === 'tree')
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button
                      className="full danger"
                      icon={Trash2}
                      onClick={() => {
                        session.change('删除树木', (d) => {
                          d.trees = d.trees.filter((t) => t.id !== tree.id);
                        });
                        session.selectedTree = null;
                        session.notify();
                      }}
                    >
                      删除该实例
                    </Button>
                  </Group>
                )}
                {session.tool === 'river' && (
                  <RiverInspector
                    key={
                      session.riverPreview
                        ? `preview-${session.riverPreview.id}`
                        : `${session.selectedRiver}-${doc.rivers.find((r) => r.id === session.selectedRiver)?.name}`
                    }
                    session={session}
                  />
                )}
                {session.tool === 'factions' && (
                  <FactionInspector
                    key={session.selectedFaction}
                    session={session}
                    onLocate={(id) => viewport.current?.focusSite(id)}
                  />
                )}
                {session.tool === 'sites' && !site && !session.sitePlacement && (
                  <p className="empty">点击城池或要塞，或从左侧据点列表选择。</p>
                )}
              </div>
            </>
          )}
        </aside>
      </main>
      <footer className={`statusbar ${session.error ? 'has-error' : ''}`}>
        <span className="status-message">
          {session.error ? <Info size={13} /> : <span className="status-dot" />}
          {session.status}
        </span>
        <span className="coordinates">
          {session.hover
            ? `X ${session.hover.x.toFixed(1)}  Z ${session.hover.z.toFixed(1)} m`
            : 'X —  Z —'}
          {centerHex && hexIndex(doc.grid, centerHex) >= 0
            ? `  ·  q ${centerHex.q} r ${centerHex.r}`
            : ''}
        </span>
        <span>{draftStatus}</span>
      </footer>
      {draft && (
        <div className="draft-toast">
          <strong>发现本地恢复草稿</strong>
          <small>{new Date(draft.date).toLocaleString('zh-CN')}</small>
          <Button
            onClick={() => {
              try {
                session.replace(decodeProject(draft.bytes), true);
                session.dirty = true;
                setDraft(undefined);
              } catch (e) {
                report(e);
              }
            }}
          >
            恢复
          </Button>
          <button onClick={() => setDraft(undefined)} title="忽略草稿">
            <X size={14} />
          </button>
        </div>
      )}
      {guard && (
        <Modal
          title="保留当前编辑？"
          subtitle={desktop ? '地图包含尚未保存的修改。' : '地图包含尚未下载保存的修改。'}
          onClose={cancelGuard}
        >
          <div className="modal-actions">
            <Button onClick={cancelGuard} disabled={session.busy}>
              取消
            </Button>
            <Button
              disabled={session.busy}
              onClick={() => {
                const fn = guard;
                setGuard(null);
                guardCancel.current = null;
                fn();
              }}
            >
              放弃并继续
            </Button>
            <Button
              className="primary"
              disabled={session.busy}
              onClick={() => {
                void save().then((ok) => {
                  if (ok) {
                    const fn = guard;
                    setGuard(null);
                    guardCancel.current = null;
                    fn();
                  }
                });
              }}
            >
              {desktop ? '保存后继续' : '下载保存后继续'}
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'new' && (
        <Modal
          title="创建新的山河"
          subtitle="一整片连续地面，独立的六边形逻辑网格。"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <label className="text-field">
              地形采样
              <select value={newSamples} onChange={(e) => setNewSamples(Number(e.target.value))}>
                <option value={513}>513 × 513 · 标准</option>
                <option value={1025}>1025 × 1025 · 高精度</option>
              </select>
            </label>
            <MapDimensions
              width={newWidth}
              depth={newDepth}
              onWidth={setNewWidth}
              onDepth={setNewDepth}
            />
            <p className="tip">初始高度 32 米，六边形自动覆盖地面。高精度地形需要更多显存。</p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>取消</Button>
            <Button
              className="primary"
              icon={Plus}
              disabled={
                ![newWidth, newDepth].every(
                  (value) => Number.isInteger(value) && value > 0 && value <= 16384,
                )
              }
              onClick={() => {
                void (async () => {
                  try {
                    session.newMap(newSamples, newWidth, newDepth);
                    await desktop?.reset();
                    viewport.current?.frameMap();
                    setModal(null);
                  } catch (error) {
                    report(error);
                  }
                })();
              }}
            >
              创建地图
            </Button>
          </div>
        </Modal>
      )}
      {heightImport && (
        <Modal
          title="导入高度图"
          subtitle="导入后替换基础高度，并移除现有河流，避免重复雕刻已烘焙河床。"
          onClose={() => setHeightImport(null)}
        >
          <div className="modal-body">
            <div className="coordinate-tag">
              {heightImport.width} × {heightImport.height} · 灰度 {heightImport.bits} 位 → 重采样至{' '}
              {doc.settings.samples}²
            </div>
            <div className="inline-fields">
              <NumberField
                label="黑色高度 (m)"
                value={heightMin}
                min={doc.settings.minHeight}
                max={heightMax - 1}
                onChange={setHeightMin}
              />
              <NumberField
                label="白色高度 (m)"
                value={heightMax}
                min={heightMin + 1}
                max={doc.settings.maxHeight}
                onChange={setHeightMax}
              />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={flipZ} onChange={(e) => setFlipZ(e.target.checked)} />
              翻转 Z 方向
            </label>
            <p className="tip">
              默认图片右为 +X，下为 +Z。地表、模型和逻辑辖区保持原坐标；本次操作可撤销。
            </p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setHeightImport(null)}>取消</Button>
            <Button
              className="primary"
              onClick={() => {
                session.change('导入高度图并移除原河流', (d) => {
                  importHeights(d, heightImport, heightMin, heightMax, flipZ);
                  d.rivers = [];
                });
                if (!session.error) setHeightImport(null);
              }}
            >
              替换高度并移除河流
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'surface' && (
        <Modal
          title="地表材质"
          className="surface-dialog"
          onClose={() => {
            if (!session.busy) setModal(null);
          }}
        >
          <SurfaceLibrary
            session={session}
            onClose={() => {
              if (!session.busy) setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === 'details' && resource && (
        <Modal title="模型详情" onClose={() => setModal(null)}>
          <ModelDetails session={session} resource={resource} onDeleted={() => setModal(null)} />
        </Modal>
      )}
      {modal === 'resources' && (
        <Modal
          wide
          title="模型资源库"
          subtitle="模型随工程保存。为山河选择合适的城池、要塞与植被。"
          onClose={() => setModal(null)}
        >
          <div className="resource-layout">
            <nav className="resource-nav">
              {(Object.keys(KIND_LABEL) as AssetKind[]).map((kind) => (
                <Button
                  key={kind}
                  active={category === kind}
                  icon={KIND_ICON[kind]}
                  onClick={() => {
                    setCategory(kind);
                    setResourceId(doc.assets.find((a) => a.kind === kind)?.id ?? '');
                  }}
                >
                  {KIND_LABEL[kind]}
                  <small>{doc.assets.filter((a) => a.kind === kind).length}</small>
                </Button>
              ))}
              <Button
                icon={Plus}
                className="full"
                onClick={() => void importModel(category)}
                disabled={session.busy}
              >
                导入静态 GLB
              </Button>
            </nav>
            <div className="resource-center">
              <label className="search-box">
                <Search size={16} />
                <input
                  placeholder="搜索模型名称"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="resource-grid">
                {doc.assets
                  .filter((a) => a.kind === category && a.name.includes(search))
                  .map((a) => (
                    <button
                      key={a.id}
                      className={`resource-card ${a.id === resourceId ? 'selected' : ''}`}
                      onClick={() => setResourceId(a.id)}
                    >
                      <div className={`asset-art ${a.kind}`}>
                        <KindIcon kind={a.kind} size={60} />
                        {a.id === resourceId && (
                          <span className="resource-check">
                            <Check size={13} />
                          </span>
                        )}
                      </div>
                      <strong>{a.name}</strong>
                      <small>
                        {isBuiltinAsset(a) ? '内置 GLB' : '自定义 GLB'} ·{' '}
                        {referenceCounts.get(a.id) ?? 0} 处引用
                      </small>
                    </button>
                  ))}
              </div>
            </div>
            <div className="resource-detail">
              {resource && (
                <>
                  <ModelDetails
                    session={session}
                    resource={resource}
                    onDeleted={() =>
                      setResourceId(doc.assets.find((asset) => asset.kind === category)?.id ?? '')
                    }
                  />
                  <Button
                    className="primary full"
                    onClick={() => {
                      session.setAsset(resource.id);
                      setModal(null);
                    }}
                  >
                    用于当前工具
                  </Button>
                  {((site && site.kind === resource.kind) ||
                    (tree && resource.kind === 'tree')) && (
                    <Button
                      className="full"
                      onClick={() => {
                        session.replaceModel(resource.id);
                        setModal(null);
                      }}
                    >
                      替换当前选中对象模型
                    </Button>
                  )}
                  {tree && resource.kind === 'tree' && (
                    <Button
                      className="full"
                      onClick={() => {
                        const count = doc.trees.filter((t) => t.assetId === tree.assetId).length;
                        if (window.confirm(`将 ${count} 株同模型树木替换为 ${resource.name}？`)) {
                          session.replaceModel(resource.id, true);
                          setModal(null);
                        }
                      }}
                    >
                      批量替换同模型树木
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
      {importDraft && (
        <Modal
          title="导入模型"
          subtitle="确认分类和基础校正后加入当前工程。"
          onClose={() => {
            finishImport();
          }}
        >
          <ModelImportForm
            asset={importDraft.asset}
            onCancel={() => {
              finishImport();
            }}
            onConfirm={finishImport}
          />
        </Modal>
      )}
      {importFailure && (
        <Modal title="模型导入失败" onClose={() => setImportFailure('')}>
          <div className="modal-body">
            <p role="alert" className="error-text">
              {importFailure}
            </p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setImportFailure('')}>知道了</Button>
          </div>
        </Modal>
      )}
      {modal === 'export' && (
        <Modal
          title="导出 Cocos 资源包"
          subtitle="协议 v2 · 地图数据与可替换参考资源"
          onClose={() => {
            if (!session.busy) setModal(null);
          }}
        >
          <div className="modal-body">
            <div className="export-target">
              <Box size={29} />
              <div>
                <strong>Cocos Creator</strong>
                <small>3.8 LTS / Y 向上 / 米制</small>
              </div>
              <span className="version-tag">资源包</span>
            </div>
            <div className="export-checkboxes">
              {(
                [
                  { key: 'trees', label: '树木模型与实例' },
                  { key: 'grass', label: '草丛密度与生成参数' },
                  { key: 'water', label: '河流与水面' },
                  { key: 'sites', label: '城池／要塞模型' },
                  { key: 'logic', label: '据点、势力与逐格归属' },
                ] as { key: keyof typeof exportOptions; label: string }[]
              ).map((option) => (
                <label key={option.key} className="check-row">
                  <input
                    type="checkbox"
                    checked={exportOptions[option.key]}
                    onChange={(e) => {
                      setExportOptions({ ...exportOptions, [option.key]: e.target.checked });
                      setExportResult(preflightCocos(doc));
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="export-report">
              <strong>预检与交付说明</strong>
              {exportResult.map((line, i) => (
                <p key={i}>
                  <Info size={13} />
                  {line}
                </p>
              ))}
            </div>
            <p className="warning-note">
              游戏项目自行读取数据、配置和替换素材，不自动生成场景。真实引擎导入与运行需另行验收。
            </p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setModal(null)} disabled={session.busy}>
              取消
            </Button>
            <Button
              className="primary"
              icon={ArrowUpFromLine}
              disabled={session.busy}
              onClick={async () => {
                session.busy = true;
                session.notify();
                try {
                  const result = await exportCocos(session.doc, exportOptions);
                  download(result.bytes, `${doc.name}-cocos.zip`, 'application/zip');
                  setExportResult(result.report);
                  session.message('v2 地图数据包已生成，请下载后按包内协议和读取示例接入游戏。');
                } catch (e) {
                  report(e);
                } finally {
                  session.busy = false;
                  session.notify();
                }
              }}
            >
              {session.busy ? '正在生成资源包…' : '生成并下载'}
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="山河 · 操作指南"
          subtitle="从地图设置到保存导出，按工具查阅当前操作。"
          className="help-modal"
          onClose={() => setModal(null)}
        >
          <OperationGuide />
        </Modal>
      )}
    </div>
  );
}
function KindIcon({ kind, size = 20 }: { kind: AssetKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} strokeWidth={1.3} />;
}
