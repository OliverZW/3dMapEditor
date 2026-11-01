import { generateGrass } from '../core/vegetation';
import type { GrassRequest, GrassReply, GrassGroup } from '../application/grass-placement-contract';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = ({ data: request }: MessageEvent<GrassRequest>) => {
  const version = {
    taskId: request.taskId,
    documentVersion: request.documentVersion,
    terrainRevision: request.terrainRevision,
    grassRevision: request.grassRevision,
  };
  let reply: GrassReply;
  try {
    const { doc, heights, layers, center } = request;
    if (
      !Number.isSafeInteger(request.taskId) ||
      ![513, 1025].includes(doc.settings.samples) ||
      !(heights instanceof Float32Array) ||
      heights.length !== doc.settings.samples ** 2 ||
      ![center.x, center.z].every(Number.isFinite) ||
      layers.some(
        (layer) =>
          !(layer.density instanceof Float32Array) || layer.density.length !== heights.length,
      )
    )
      throw new Error('草丛派生任务输入无效');
    const groups: GrassGroup[] = [];
    let grass = 0;
    for (const asset of doc.assets.filter((asset) => asset.kind === 'grass')) {
      const instances = [];
      for (const layer of layers.filter((layer) => layer.assetId === asset.id))
        instances.push(
          ...generateGrass(doc, heights, layer, center, 80, 50000 - grass - instances.length),
        );
      groups.push({ assetId: asset.id, instances });
      grass += instances.length;
    }
    reply = { ...version, groups };
  } catch (error) {
    reply = { ...version, error: String(error) };
  }
  scope.postMessage(reply);
};
