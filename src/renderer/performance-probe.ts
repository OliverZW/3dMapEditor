import * as THREE from 'three';
import type { EditorSession } from '../application/editor-session';
import type { EditorViewport } from './editor-viewport';
import { GpuTimer } from './gpu-timer';
import { performanceDistribution } from './performance-statistics';
import { encodeProjectFiles } from '../io/project-codec';

type Variant =
  | 'current'
  | 'hidden'
  | 'basic'
  | 'dpr-1'
  | 'dpr-half'
  | 'no-msaa'
  | 'previous-surface';
const variants: Variant[] = [
  'current',
  'hidden',
  'basic',
  'dpr-1',
  'dpr-half',
  'no-msaa',
  'previous-surface',
];

/** 只在主进程显式授权的诊断启动中安装；不暴露 session 或任意文件操作。 */
export function installPerformanceProbe(
  session: EditorSession,
  recreate: (antialias?: boolean, previousSurface?: boolean) => EditorViewport,
  current: () => EditorViewport,
) {
  let disposed = false;
  let measuring = false;
  let cancel: (() => void) | undefined;
  let material: THREE.MeshBasicMaterial | undefined;
  let variant: Variant = 'current';
  const pose = { position: [700, 870, 1050], target: [0, 32, 0] };
  const resetCamera = () => {
    const view = current();
    view.navigation.rig.interrupt();
    view.navigation.rig.target.fromArray(pose.target);
    view.camera.position.fromArray(pose.position);
    view.camera.lookAt(view.navigation.rig.target);
    view.camera.updateMatrixWorld(true);
    view.requestRender();
  };
  const snapshot = () => {
    const view = current(),
      gl = view.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      variant,
      displayQuality: view.displayQuality,
      display: view.diagnosticDisplay,
      ready: view.diagnosticReady,
      document: {
        name: session.doc.name,
        settings: session.doc.settings,
        trees: session.doc.trees.length,
        sites: session.doc.sites.length,
        rivers: session.doc.rivers.length,
        grassLayers: session.doc.grass.length,
        revision: session.revision,
        documentVersion: session.documentVersion,
      },
      viewLayers: { ...session.view },
      hover: session.hover ? { ...session.hover } : null,
      camera: {
        projection: view.navigation.rig.projection,
        orientation: view.navigation.rig.orientation,
        quaternion: view.camera.quaternion.toArray(),
        zoom: view.camera.zoom,
        speed: view.navigation.getSnapshot().speed,
        position: view.camera.position.toArray(),
        target: view.navigation.rig.target.toArray(),
      },
      viewport: {
        cssWidth: view.renderer.domElement.clientWidth,
        cssHeight: view.renderer.domElement.clientHeight,
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        dpr: devicePixelRatio,
        pixelRatio: view.renderer.getPixelRatio(),
      },
      context: {
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        version: gl.getParameter(gl.VERSION),
        attributes: gl.getContextAttributes(),
        samples: gl.getParameter(gl.SAMPLES),
        timerSupported: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
        lost: gl.isContextLost(),
      },
      scheduling: view.diagnosticScheduling,
      stats: { ...view.stats },
      shadow: {
        enabled: view.renderer.shadowMap.enabled,
        autoUpdate: view.renderer.shadowMap.autoUpdate,
      },
      memory: { ...view.renderer.info.memory },
      visible: document.visibilityState,
      focused: document.hasFocus(),
    };
  };
  const api = {
    snapshot,
    integrity: async () => {
      const files = encodeProjectFiles(session.doc);
      const hashes = await Promise.all(
        Object.entries(files).map(async ([name, bytes]) => {
          const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
          return [
            name,
            Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join(
              '',
            ),
          ];
        }),
      );
      return {
        files: Object.fromEntries(hashes),
        revision: session.revision,
        documentVersion: session.documentVersion,
        dirty: session.dirty,
        undoLabel: session.history.undoLabel,
        redoLabel: session.history.redoLabel,
        selection: {
          site: session.selectedSite,
          tree: session.selectedTree,
          river: session.selectedRiver,
          faction: session.selectedFaction,
        },
      };
    },
    configure: (next: Variant) => {
      if (disposed || measuring || !variants.includes(next))
        throw new Error('诊断状态或对照项无效');
      variant = next;
      const view = recreate(next === 'no-msaa' ? false : undefined, next === 'previous-surface');
      material?.dispose();
      material = new THREE.MeshBasicMaterial({ color: 0x7f8863 });
      view.setDiagnosticGround(next === 'hidden' || next === 'basic' ? next : 'current', material);
      if (next === 'dpr-1') view.renderer.setPixelRatio(1);
      if (next === 'dpr-half') view.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75) * 0.5);
      resetCamera();
      return snapshot();
    },
    sample: async (durationMs: number, motion: boolean) => {
      if (
        disposed ||
        measuring ||
        !Number.isFinite(durationMs) ||
        durationMs < 1000 ||
        durationMs > 60000
      )
        throw new Error('采样时长或诊断状态无效');
      const view = current(),
        gl = view.renderer.getContext();
      if (!(gl instanceof WebGL2RenderingContext)) throw new Error('GPU 诊断需要 WebGL2');
      if (!view.diagnosticReady || document.hidden || !view.diagnosticScheduling.hostVisible)
        throw new Error('视口尚未就绪或不在前台');
      measuring = true;
      resetCamera();
      const before = snapshot();
      const gpu = new GpuTimer(gl);
      const render = view.renderer.render;
      const cpu: number[] = [],
        submission: number[] = [],
        starts: number[] = [];
      const draws: number[] = [],
        triangles: number[] = [],
        models: number[] = [];
      const started = performance.now();
      let background = false,
        unfocused = false;
      const visibility = () => {
        background ||= document.hidden;
      };
      const blur = () => {
        unfocused = true;
      };
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('blur', blur);
      view.renderer.render = function (scene, camera) {
        gpu.begin();
        const start = performance.now();
        try {
          render.call(this, scene, camera);
        } finally {
          submission.push(performance.now() - start);
          gpu.end();
        }
      };
      view.diagnosticFrame = {
        begin(now) {
          starts.push(now);
          if (motion) {
            const offset = Math.sin((now - started) / 1000) * 80;
            view.camera.position.x = pose.position[0] + offset;
            view.navigation.rig.target.x = pose.target[0] + offset;
            view.camera.lookAt(view.navigation.rig.target);
            view.camera.updateMatrixWorld(true);
          }
        },
        end(ms) {
          cpu.push(ms);
          draws.push(view.renderer.info.render.calls);
          triangles.push(view.renderer.info.render.triangles);
          // stats 每秒发布一次；这里只将其作为模型面数的节流观测值。
          models.push(view.stats.modelTriangles);
        },
      };
      view.requestRender();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          timeout = setTimeout(resolve, durationMs);
          cancel = () => reject(new Error('视口关闭，诊断采样取消'));
        });
        gpu.poll();
        const intervals = starts.slice(1).map((value, index) => value - starts[index]);
        if (intervals.length < 2) throw new Error('有效帧不足');
        return {
          motion,
          scheduling: 'forced-continuous-diagnostic',
          durationMs: performance.now() - started,
          fps: (intervals.length * 1000) / (starts[starts.length - 1] - starts[0]),
          frameMs: performanceDistribution(intervals),
          cpuFrameWallMs: performanceDistribution(cpu),
          renderSubmissionWallMs: performanceDistribution(submission),
          gpuMs: performanceDistribution(gpu.samples),
          gpuTimer: {
            supported: !!gpu.extension,
            disjointCount: gpu.disjointCount,
            skipped: gpu.skipped,
          },
          draws: performanceDistribution(draws),
          totalTriangles: performanceDistribution(triangles),
          modelTrianglesThrottled: performanceDistribution(models),
          valid:
            view.diagnosticScheduling.hostVisible &&
            !background &&
            !unfocused &&
            !gl.isContextLost() &&
            session.revision === before.document.revision &&
            session.documentVersion === before.document.documentVersion,
          background,
          unfocused,
          before,
          after: snapshot(),
        };
      } finally {
        clearTimeout(timeout);
        cancel = undefined;
        view.diagnosticFrame = undefined;
        view.renderer.render = render;
        gpu.dispose();
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('blur', blur);
        measuring = false;
        if (!disposed) resetCamera();
      }
    },
  };
  window.mapEditorPerformance = api;
  return () => {
    disposed = true;
    cancel?.();
    material?.dispose();
    if (window.mapEditorPerformance === api) delete window.mapEditorPerformance;
  };
}

declare global {
  interface Window {
    mapEditorPerformance?: {
      snapshot: () => unknown;
      integrity: () => Promise<unknown>;
      configure: (variant: Variant) => unknown;
      sample: (durationMs: number, motion: boolean) => Promise<unknown>;
    };
  }
}
