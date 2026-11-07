import surfaceResources from '../../editor-assets/surface/manifest.json';
import { assetUrl } from '../io/builtin-resources';
import { Mountain, ArrowDownToLine, Waves, Layers3, Check, Info, Trash2, Plus } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { deleteSurfaceLayer } from '../core/surface-layers';
import { Button } from './controls';
import { ConfirmDialog } from './ConfirmDialog';
import { useEffect, useState } from 'react';
import type { SurfaceImage } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';

const TERRAIN_MODES = [
  { id: 'raise', label: '抬高', icon: Mountain },
  { id: 'lower', label: '降低', icon: ArrowDownToLine },
  { id: 'smooth', label: '平滑', icon: Waves },
  { id: 'flatten', label: '定高', icon: Layers3 },
] as const;

function SurfaceSwatch({ image }: { image: SurfaceImage }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([surfaceImageBytes(image).slice().buffer], { type: 'image/png' }),
    );
    setUrl(next);
    return () => {
      window.setTimeout(() => URL.revokeObjectURL(next), 1000);
    };
  }, [image.hash]);
  return (
    <img
      className="surface-swatch"
      src={url || assetUrl(surfaceResources.layers[0].thumbnail.file)}
      alt=""
    />
  );
}

export function BrushPalette({ session, onAdd }: { session: EditorSession; onAdd: () => void }) {
  const terrain = session.tool === 'terrain';
  const [deleting, setDeleting] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const target = session.doc.surfaceMaterial.layers.find((layer) => layer.id === deleting);

  return (
    <section className="brush-palette" aria-label="编辑操作">
      {terrain ? (
        <div className="brush-mode-grid">
          {TERRAIN_MODES.map((mode) => (
            <Button
              key={mode.id}
              icon={mode.icon}
              active={session.brush.terrainMode === mode.id}
              onClick={() => {
                session.brush.terrainMode = mode.id;
                session.notify();
              }}
            >
              {mode.label}
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div className="surface-palette-actions">
            <Button
              className="primary"
              icon={Plus}
              disabled={session.busy || session.doc.surfaceMaterial.layers.length >= 8}
              onClick={onAdd}
            >
              添加地表 <small>{session.doc.surfaceMaterial.layers.length}/8</small>
            </Button>
            <Button
              className="danger"
              icon={Trash2}
              aria-label="删除当前地表"
              disabled={session.busy || session.doc.surfaceMaterial.layers.length <= 1}
              onClick={() => {
                setDeleting(session.doc.surfaceMaterial.layers[session.brush.surfaceLayer].id);
                setReplacement('');
              }}
            >
              删除地表
            </Button>
          </div>
          {target && (
            <ConfirmDialog
              title="删除地表确认"
              confirmLabel="确认删除地表"
              disabled={
                session.busy ||
                !session.doc.surfaceMaterial.layers.some(
                  (layer) => layer.id === replacement && layer.id !== target.id,
                )
              }
              onCancel={() => setDeleting(null)}
              onConfirm={() => {
                session.change('删除地表并合并权重', (doc) =>
                  deleteSurfaceLayer(doc, target.id, replacement),
                );
                if (!session.error) setDeleting(null);
              }}
            >
              <p>删除“{target.name}”，将已有涂刷合并到：</p>
              <label className="text-field">
                替代地表
                <select
                  aria-label="删除后替换地表"
                  value={replacement}
                  disabled={session.busy}
                  onChange={(event) => setReplacement(event.target.value)}
                >
                  <option value="">请选择替代地表</option>
                  {session.doc.surfaceMaterial.layers
                    .filter((layer) => layer.id !== target.id)
                    .map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name}
                      </option>
                    ))}
                </select>
              </label>
            </ConfirmDialog>
          )}
          <div className="surface-grid">
            {session.doc.surfaceMaterial.layers.map((layer, index) => {
              const selected = session.brush.surfaceLayer === index;
              return (
                <button
                  key={layer.id}
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() => {
                    session.cancelSurface();
                    session.brush.surfaceLayer = index;
                    session.notify();
                  }}
                >
                  <SurfaceSwatch image={layer.color} />
                  <span>{layer.name}</span>
                  {selected && <Check className="palette-check" size={12} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="palette-note">
        <Info size={14} aria-hidden="true" />
        <span>
          {terrain
            ? '在地面拖动编辑基础高度，河床独立合成。'
            : '在地图上拖动涂刷，地表权重不改变高度。'}
        </span>
      </p>
    </section>
  );
}
