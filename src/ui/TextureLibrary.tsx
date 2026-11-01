import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../application/editor-session';
import type { SurfaceTextureKind } from '../core/types';
import { replaceSurfaceTexture, surfaceTextures, textureLocations } from '../core/surface-textures';
import { importSurfaceImage } from '../io/surface-import';
import { SurfaceTexturePreview } from './SurfaceTexturePreview';
import { Button } from './controls';

export interface TextureTarget {
  layerId: string;
  kind: SurfaceTextureKind;
}

export function TextureLibrary({
  session,
  target,
  onClose,
}: {
  session: EditorSession;
  target: TextureTarget | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SurfaceTextureKind>(target?.kind ?? 'color');
  const layer = session.doc.surfaceMaterial.layers.find((item) => item.id === target?.layerId);
  const [selected, setSelected] = useState(layer?.[target?.kind ?? 'color'].hash ?? '');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.cancelSurfaceLayer();
    };
  }, [session]);
  const items = surfaceTextures(session.doc);
  const current = items.find((item) => item.kind === kind && item.image.hash === selected);
  useEffect(() => {
    session.cancelSurfaceLayer();
    if (
      target &&
      layer &&
      current &&
      current.image.width === layer.color.width &&
      current.image.height === layer.color.height
    ) {
      const index = session.doc.surfaceMaterial.layers.findIndex(
        (item) => item.id === target.layerId,
      );
      session.previewSurfaceLayer(index, { ...layer, [target.kind]: current.image });
    }
    return () => session.cancelSurfaceLayer();
  }, [target?.layerId, target?.kind, current?.image.hash, session.documentVersion]);
  const locations = current ? textureLocations(session.doc, kind, current.image.hash) : [];
  const own =
    current &&
    session.doc.surfaceMaterial.textures?.find(
      (item) => item.kind === kind && item.image.hash === current.image.hash,
    );
  return (
    <div className="texture-library modal-body">
      <div className="texture-library-tools">
        <label>
          贴图类型
          <select
            aria-label="贴图类型"
            value={kind}
            disabled={!!target || working}
            onChange={(event) => {
              setKind(event.target.value as SurfaceTextureKind);
              setSelected('');
            }}
          >
            <option value="color">颜色贴图</option>
            <option value="normal">法线贴图</option>
          </select>
        </label>
        <input
          aria-label="搜索贴图"
          placeholder="搜索贴图名称"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label>
          导入 PNG/JPG
          <input
            aria-label="导入贴图"
            type="file"
            accept="image/png,image/jpeg"
            disabled={working}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file || working) return;
              const version = session.documentVersion,
                revision = session.revision;
              setWorking(true);
              setError('');
              session.busy = true;
              session.notify();
              try {
                const image = await importSurfaceImage(file);
                if (!alive.current) return;
                if (version !== session.documentVersion || revision !== session.revision)
                  throw new Error('工程已变化，请重新导入');
                const existing = surfaceTextures(session.doc).find(
                  (item) => item.kind === kind && item.image.hash === image.hash,
                );
                if (!existing)
                  session.change('导入贴图', (doc) => {
                    doc.surfaceMaterial.textures = [
                      ...(doc.surfaceMaterial.textures ?? []),
                      {
                        id: `texture-${crypto.randomUUID()}`,
                        name: file.name.slice(0, 128),
                        kind,
                        image,
                      },
                    ];
                  });
                if (session.error) throw new Error(session.error);
                setSelected(image.hash);
              } catch (reason) {
                if (alive.current) setError(String(reason));
              } finally {
                session.busy = false;
                session.notify();
                if (alive.current) setWorking(false);
              }
            }}
          />
        </label>
      </div>
      <div className="texture-library-content">
        <div className="texture-library-grid">
          {items
            .filter((item) => item.kind === kind && item.name.includes(search))
            .map((item) => (
              <button
                key={`${kind}:${item.image.hash}`}
                className={selected === item.image.hash ? 'selected' : ''}
                aria-pressed={selected === item.image.hash}
                onClick={() => {
                  setSelected(item.image.hash);
                  setError('');
                }}
              >
                <SurfaceTexturePreview image={item.image} label={item.name} />
                <strong>{item.name}</strong>
                <small>
                  {item.image.width} × {item.image.height}
                </small>
              </button>
            ))}
        </div>
        <aside className="texture-library-detail">
          {current ? (
            <>
              <SurfaceTexturePreview image={current.image} label="所选贴图预览" />
              <strong>{current.name}</strong>
              <p>
                {current.image.width} × {current.image.height}
              </p>
              <p>引用位置：{locations.join('、') || '无'}</p>
              <Button
                disabled={!own || locations.length > 0 || working}
                onClick={() =>
                  session.change('删除贴图', (doc) => {
                    if (textureLocations(doc, kind, current.image.hash).length)
                      throw new Error('贴图仍在使用');
                    doc.surfaceMaterial.textures = doc.surfaceMaterial.textures?.filter(
                      (item) => item.id !== own?.id,
                    );
                  })
                }
              >
                删除贴图
              </Button>
            </>
          ) : (
            <p>请选择贴图</p>
          )}
        </aside>
      </div>
      {target &&
        current &&
        layer &&
        (current.image.width !== layer.color.width ||
          current.image.height !== layer.color.height) && (
          <p className="error-text" role="alert">
            贴图尺寸须与另一张贴图一致（{layer.color.width} × {layer.color.height}）
          </p>
        )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button disabled={working} onClick={onClose}>
          {target ? '取消' : '关闭'}
        </Button>
        {target && (
          <Button
            className="primary"
            disabled={
              working ||
              !current ||
              !layer ||
              current.image.width !== layer.color.width ||
              current.image.height !== layer.color.height
            }
            onClick={() => {
              if (!current) return;
              session.cancelSurfaceLayer();
              session.change('替换单张地表贴图', (doc) =>
                replaceSurfaceTexture(doc, target.layerId, target.kind, current.image),
              );
              if (!session.error) onClose();
              else setError(session.error);
            }}
          >
            确认使用
          </Button>
        )}
      </div>
    </div>
  );
}
