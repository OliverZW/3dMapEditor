import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../application/editor-session';
import type { SurfaceAsset } from '../core/types';
import { defaultSurfaceMaterial } from '../core/surface-material';
import { surfaceImageBytes } from '../io/surface-resources';
import { importSurfaceAsset } from '../io/surface-import';
import { Button } from './controls';

const layerNames = ['草地', '泥土', '岩石', '沙地'];

export function SurfaceLibrary({
  session,
  onClose,
}: {
  session: EditorSession;
  onClose: () => void;
}) {
  const index = session.brush.surfaceLayer;
  const layer = session.doc.surfaceMaterial.layers[index];
  const builtins: SurfaceAsset[] = defaultSurfaceMaterial().layers.map((item) => ({
    ...item,
    id: `builtin:${item.id}`,
  }));
  const [selected, setSelected] = useState(layer.materialId ?? `builtin:${layer.id}`);
  const [draft, setDraft] = useState<SurfaceAsset | null>(null);
  const [name, setName] = useState('');
  const [meters, setMeters] = useState('16');
  const [color, setColor] = useState<File | null>(null);
  const [normal, setNormal] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState('');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const items = [...builtins, ...(session.doc.surfaceMaterial.library ?? [])];
  const current = draft ?? items.find((item) => item.id === selected);
  useEffect(() => {
    if (current) session.previewSurfaceLayer(index, current);
    return () => session.cancelSurfaceLayer();
  }, [session, index, current?.id, current?.color.hash, current?.normal.hash, current?.meters]);
  useEffect(() => {
    if (!current) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([surfaceImageBytes(current.color).slice().buffer], { type: 'image/png' }),
    );
    setPreview(url);
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }, [current?.color.hash]);
  async function prepare() {
    if (!color || working) {
      setError('请选择颜色贴图');
      return;
    }
    const version = session.documentVersion,
      revision = session.revision;
    setWorking(true);
    session.busy = true;
    session.notify();
    setError('');
    try {
      const asset = await importSurfaceAsset(color, normal, name, Number(meters));
      if (!alive.current) return;
      if (version !== session.documentVersion || revision !== session.revision)
        throw new Error('工程已变化，请重新导入');
      setDraft(asset);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      session.busy = false;
      session.notify();
      if (alive.current) setWorking(false);
    }
  }
  function apply() {
    if (!current) return;
    session.change('替换地表材质', (doc) => {
      const pack = doc.surfaceMaterial;
      if (draft) pack.library = [...(pack.library ?? []), draft];
      const target = pack.layers[index];
      pack.layers[index] = {
        ...target,
        name: current.name,
        meters: current.meters,
        color: { ...current.color },
        normal: { ...current.normal },
        materialId: current.id.startsWith('builtin:') ? undefined : current.id,
      };
    });
    if (!session.error) onClose();
    else setError(session.error);
  }
  function remove() {
    if (!current || current.id.startsWith('builtin:') || draft) return;
    const locations = session.doc.surfaceMaterial.layers.flatMap((item, i) =>
      item.materialId === current.id ? [layerNames[i]] : [],
    );
    if (locations.length) {
      setError(`材质正在使用：${locations.join('、')}，请先替换这些层。`);
      return;
    }
    session.change('删除地表材质', (doc) => {
      doc.surfaceMaterial.library = (doc.surfaceMaterial.library ?? []).filter(
        (item) => item.id !== current.id,
      );
    });
    if (session.error) setError(session.error);
    else {
      setSelected(`builtin:${layer.id}`);
      setError('');
    }
  }
  return (
    <div className="surface-library modal-body">
      <p>
        当前图层：{layerNames[index]}
        。选择时预览地图，确认后应用；取消将还原，已有涂刷权重保持不变。
      </p>
      <label>
        选择材质
        <select
          aria-label="选择地表材质"
          value={draft ? '' : selected}
          disabled={working}
          onChange={(event) => {
            setSelected(event.target.value);
            setDraft(null);
            setError('');
          }}
        >
          {draft && <option value="">新导入：{draft.name}</option>}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}（{item.id.startsWith('builtin:') ? '内置' : '工程'}）
            </option>
          ))}
        </select>
      </label>
      {current && (
        <div className="surface-library-preview">
          {preview && <img src={preview} alt="地表颜色贴图预览" />}
          <div>
            <strong>{current.name}</strong>
            <p>
              {current.color.width} × {current.color.height} · {current.meters} 米平铺
            </p>
            <p>
              使用位置：
              {session.doc.surfaceMaterial.layers
                .flatMap((item, i) => (item.materialId === current.id ? [layerNames[i]] : []))
                .join('、') || '无'}
            </p>
          </div>
        </div>
      )}
      <fieldset disabled={working}>
        <legend>导入工程材质</legend>
        <label>
          名称
          <input
            aria-label="材质名称"
            value={name}
            maxLength={128}
            onChange={(e) => {
              setName(e.target.value);
              setDraft(null);
            }}
          />
        </label>
        <label>
          平铺尺度（米）
          <input
            aria-label="平铺尺度（米）"
            type="number"
            min="1"
            max="512"
            value={meters}
            onChange={(e) => {
              setMeters(e.target.value);
              setDraft(null);
            }}
          />
        </label>
        <label>
          颜色贴图（PNG/JPG）
          <input
            aria-label="颜色贴图"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              setColor(e.target.files?.[0] ?? null);
              setDraft(null);
            }}
          />
        </label>
        <label>
          法线贴图（可选）
          <input
            aria-label="法线贴图"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              setNormal(e.target.files?.[0] ?? null);
              setDraft(null);
            }}
          />
        </label>
        <Button onClick={() => void prepare()} disabled={!color || working}>
          {working ? '正在检查…' : '预览导入'}
        </Button>
      </fieldset>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button
          onClick={remove}
          disabled={working || !current || current.id.startsWith('builtin:') || !!draft}
        >
          删除材质
        </Button>
        <Button onClick={onClose} disabled={working}>
          取消
        </Button>
        <Button onClick={apply} disabled={working || !current}>
          确认使用
        </Button>
      </div>
    </div>
  );
}
