import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import type { SurfaceTextureKind } from '../core/types';
import { replaceSurfaceTexture, surfaceTextures, textureLocations } from '../core/surface-textures';
import { SurfaceTexturePreview } from './SurfaceTexturePreview';
import { Button } from './controls';

export interface TextureTarget {
  layerId: string;
  kind: SurfaceTextureKind;
}

export function TextureLibrary({
  session,
  target,
  navigation,
  imported,
  onClose,
}: {
  session: EditorSession;
  target: TextureTarget | null;
  navigation: ReactNode;
  imported: { key: string; kind: SurfaceTextureKind } | null;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<SurfaceTextureKind | 'all'>(target?.kind ?? 'all');
  const layer = session.doc.surfaceMaterial.layers.find((item) => item.id === target?.layerId);
  const items = surfaceTextures(session.doc);
  const [selected, setSelected] = useState(
    target && layer
      ? `${target.kind}:${layer[target.kind].hash}`
      : items[0]
        ? `${items[0].kind}:${items[0].image.hash}`
        : '',
  );
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const working = session.busy;
  useEffect(() => {
    if (!imported) return;
    setFilter(target?.kind ?? imported.kind);
    setSearch('');
    setSelected(imported.key);
  }, [imported, target?.kind]);
  const visibleItems = items.filter(
    (item) => (filter === 'all' || item.kind === filter) && item.name.includes(search),
  );
  const current = visibleItems.find((item) => `${item.kind}:${item.image.hash}` === selected);
  useEffect(() => {
    session.cancelSurfaceLayer();
    if (
      target &&
      layer &&
      current &&
      current.kind === target.kind &&
      current.image.width === layer.color.width &&
      current.image.height === layer.color.height
    ) {
      const index = session.doc.surfaceMaterial.layers.findIndex(
        (item) => item.id === target.layerId,
      );
      session.previewSurfaceLayer(index, { ...layer, [target.kind]: current.image });
    }
    return () => session.cancelSurfaceLayer();
  }, [target?.layerId, target?.kind, current?.kind, current?.image.hash, session.documentVersion]);
  const locations = current ? textureLocations(session.doc, current.kind, current.image.hash) : [];
  const own =
    current &&
    session.doc.surfaceMaterial.textures?.find(
      (item) => item.kind === current.kind && item.image.hash === current.image.hash,
    );
  return (
    <div className="resource-layout">
      {navigation}
      <div className="resource-center texture-library">
        <div className="texture-library-tools">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索贴图"
              placeholder="搜索贴图名称"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            aria-label="贴图类型"
            value={filter}
            disabled={!!target || working}
            onChange={(event) => {
              setFilter(event.target.value as SurfaceTextureKind | 'all');
              setError('');
            }}
          >
            <option value="all">全部</option>
            <option value="color">颜色贴图</option>
            <option value="normal">法线贴图</option>
          </select>
        </div>
        <div className="resource-grid texture-library-grid">
          {visibleItems.map((item) => {
            const key = `${item.kind}:${item.image.hash}`;
            return (
              <button
                key={key}
                className={`resource-card ${selected === key ? 'selected' : ''}`}
                aria-pressed={selected === key}
                onClick={() => {
                  setSelected(key);
                  setError('');
                }}
              >
                <SurfaceTexturePreview image={item.image} label={item.name} />
                {selected === key && (
                  <span className="resource-check">
                    <Check size={13} />
                  </span>
                )}
                <strong>{item.name}</strong>
                <small>
                  {item.kind === 'color' ? '颜色贴图' : '法线贴图'} · PNG · {item.image.width} ×{' '}
                  {item.image.height}
                </small>
              </button>
            );
          })}
        </div>
        {visibleItems.length === 0 && <p className="muted">没有匹配的贴图</p>}
      </div>
      <aside className="resource-detail texture-library-detail">
        <div className="texture-library-properties">
          {current ? (
            <>
              <SurfaceTexturePreview image={current.image} label="所选贴图预览" />
              <h3>{current.name}</h3>
              <p>贴图 / {current.kind === 'color' ? '颜色贴图' : '法线贴图'}</p>
              <dl>
                <div>
                  <dt>分辨率</dt>
                  <dd>
                    {current.image.width} × {current.image.height}
                  </dd>
                </div>
                <div>
                  <dt>格式</dt>
                  <dd>PNG</dd>
                </div>
              </dl>
              <p>引用位置：{locations.join('、') || '无'}</p>
              <Button
                disabled={!own || locations.length > 0 || working}
                onClick={() =>
                  session.change('删除贴图', (doc) => {
                    if (textureLocations(doc, current.kind, current.image.hash).length)
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
        </div>
        <div className="texture-library-actions">
          {target && (
            <Button
              className="primary full"
              disabled={
                working ||
                !current ||
                !layer ||
                current.kind !== target.kind ||
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
          <Button className="full" disabled={working} onClick={onClose}>
            {target ? '取消' : '关闭'}
          </Button>
        </div>
      </aside>
    </div>
  );
}
