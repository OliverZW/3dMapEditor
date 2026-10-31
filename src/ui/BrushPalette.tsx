import surfaceResources from '../../editor-assets/surface/manifest.json';
import { assetUrl } from '../io/builtin-resources';
import { Mountain, ArrowDownToLine, Waves, Layers3, Check, Info } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button } from './controls';
import { useEffect, useState } from 'react';
import type { SurfaceImage } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';

const TERRAIN_MODES = [
  { id: 'raise', label: '抬高', icon: Mountain },
  { id: 'lower', label: '降低', icon: ArrowDownToLine },
  { id: 'smooth', label: '平滑', icon: Waves },
  { id: 'flatten', label: '定高', icon: Layers3 },
] as const;
const SURFACE_NAMES = surfaceResources.layers.map((layer) => layer.name);

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

export function BrushPalette({ session }: { session: EditorSession }) {
  const terrain = session.tool === 'terrain';
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
        <div className="surface-grid">
          {SURFACE_NAMES.map((name, index) => {
            const selected = session.brush.surfaceLayer === index;
            return (
              <button
                key={name}
                className={selected ? 'selected' : ''}
                aria-pressed={selected}
                onClick={() => {
                  session.brush.surfaceLayer = index;
                  session.notify();
                }}
              >
                <SurfaceSwatch image={session.doc.surfaceMaterial.layers[index].color} />
                <span>
                  {name}
                  <small>
                    {session.doc.surfaceMaterial.layers[index].name !== name
                      ? ` · ${session.doc.surfaceMaterial.layers[index].name}`
                      : ''}
                  </small>
                </span>
                {selected && <Check className="palette-check" size={12} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
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
