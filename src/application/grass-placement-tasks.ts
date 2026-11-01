import type { MapDocument, Point } from '../core/types';
import type {
  GrassVersion,
  GrassRequest,
  GrassReply,
  GrassGroup,
} from './grass-placement-contract';
type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
interface Job {
  request: GrassRequest;
  resolve: (groups: GrassGroup[] | null) => void;
  reject: (error: Error) => void;
}
/** 仅传派生所需快照；最多一个在算和一个最新候选，旧结果从不进入渲染。 */
export class GrassPlacementTasks {
  private worker?: WorkerPort;
  private busy = false;
  private latest?: Job;
  private serial = 0;
  private disposed = false;
  constructor(
    private createWorker: () => WorkerPort = () =>
      new Worker(new URL('../workers/grass-placement.worker.ts', import.meta.url), {
        type: 'module',
      }),
  ) {}
  run(
    doc: MapDocument,
    heights: Float32Array,
    center: Point,
    version: GrassVersion,
  ): Promise<GrassGroup[] | null> {
    this.cancel();
    if (this.disposed) return Promise.resolve(null);
    if (!doc.grass.length) return Promise.resolve([]);
    const request: GrassRequest = {
      ...version,
      taskId: ++this.serial,
      doc: {
        settings: { ...doc.settings },
        grid: { ...doc.grid },
        assets: doc.assets.map(({ bytes: _bytes, ...asset }) => ({
          ...asset,
          size: [...asset.size],
        })),
        rivers: structuredClone(doc.rivers),
        sites: structuredClone(doc.sites),
      },
      heights: heights.slice(),
      layers: doc.grass.map((layer) => ({ ...layer, density: layer.density.slice() })),
      center: { ...center },
    };
    return new Promise((resolve, reject) => {
      this.latest = { request, resolve, reject };
      this.dispatch();
    });
  }
  private dispatch() {
    if (this.busy || !this.latest || this.disposed) return;
    try {
      if (!this.worker) {
        const worker = this.createWorker();
        this.worker = worker;
        worker.onmessage = ({ data }: MessageEvent<GrassReply>) => {
          if (this.worker !== worker || this.disposed) return;
          this.busy = false;
          const job = this.latest;
          if (
            job &&
            data.taskId === job.request.taskId &&
            data.documentVersion === job.request.documentVersion &&
            data.terrainRevision === job.request.terrainRevision &&
            data.grassRevision === job.request.grassRevision
          ) {
            this.latest = undefined;
            if (data.error) job.reject(new Error(data.error));
            else if (Array.isArray(data.groups)) job.resolve(data.groups);
            else job.reject(new Error('草丛派生结果无效'));
          } else if (job && data.taskId === job.request.taskId) {
            this.latest = undefined;
            job.resolve(null);
          }
          this.dispatch();
        };
        worker.onerror = (event) => {
          if (this.worker !== worker || this.disposed) return;
          this.fail(new Error(`草丛计算线程失败：${event.message}`));
        };
      }
      const request = this.latest.request;
      this.busy = true;
      this.worker.postMessage(request, [
        request.heights.buffer,
        ...request.layers.map((layer) => layer.density.buffer),
      ]);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  private fail(error: Error) {
    const job = this.latest;
    this.latest = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.busy = false;
    job?.reject(error);
  }
  cancel() {
    this.latest?.resolve(null);
    this.latest = undefined;
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.worker?.terminate();
    this.worker = undefined;
    this.busy = false;
  }
}
