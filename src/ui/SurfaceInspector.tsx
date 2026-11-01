import { useEffect, useState } from 'react';
import type { EditorSession } from '../application/editor-session';
import type { SurfaceTextureKind } from '../core/types';
import { surfaceTextures } from '../core/surface-textures';
import { SurfaceTexturePreview } from './SurfaceTexturePreview';
import { Group, Slider, HelpTip } from './controls';

export function SurfaceInspector({
  session,
  onTexture,
}: {
  session: EditorSession;
  onTexture: (kind: SurfaceTextureKind) => void;
}) {
  const material = session.surfacePreview ?? session.doc.surfaceMaterial;
  const index = session.brush.surfaceLayer;
  const layer = session.doc.surfaceMaterial.layers[index];
  const [name, setName] = useState(layer.name);
  const [nameError, setNameError] = useState('');
  useEffect(() => {
    setName(layer.name);
    setNameError('');
  }, [layer.id, index, layer.name]);
  useEffect(() => {
    const cancel = () => session.cancelSurface();
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      session.cancelSurface();
    };
  }, [session]);
  return (
    <Group title="地表材质" tag="SURFACE">
      <label className="text-field">
        地表名称
        <input
          aria-label="地表名称"
          maxLength={128}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) {
              setName(layer.name);
              setNameError('地表名称不能为空');
              return;
            }
            setNameError('');
            setName(trimmed);
            if (trimmed !== layer.name)
              session.change('重命名地表', (doc) => {
                doc.surfaceMaterial.layers[index].name = trimmed;
              });
          }}
        />
      </label>
      {nameError && (
        <p className="error-text" role="alert">
          {nameError}
        </p>
      )}
      <div className="surface-texture-slots">
        {(['color', 'normal'] as const).map((kind) => {
          const label = kind === 'color' ? '颜色贴图' : '法线贴图';
          const asset = surfaceTextures(session.doc).find(
            (item) => item.kind === kind && item.image.hash === layer[kind].hash,
          );
          return (
            <button
              key={kind}
              className="surface-texture-slot"
              aria-label={`切换${label}`}
              onClick={() => onTexture(kind)}
            >
              <SurfaceTexturePreview image={layer[kind]} label={label} />
              <strong>{label}</strong>
              <span>{asset?.name ?? layer.name}</span>
              <small>
                {layer[kind].width} × {layer[kind].height}
              </small>
            </button>
          );
        })}
      </div>
      <Slider
        label="纹理尺度"
        hint="仅影响当前地表：数值越大，纹理平铺越宽、重复越少。"
        value={(material.layers[index]?.scale ?? material.scale) * 100}
        min={25}
        max={400}
        unit="%"
        onChange={(value) => session.previewSurfaceParameters({ scale: value / 100 })}
        onCommit={() => session.commitSurface()}
        onCancel={() => session.cancelSurface()}
      />
      <Slider
        label="细节强度"
        hint="仅控制当前地表法线贴图的凹凸光照，不改变高度；简化地表开启时不显示该细节。"
        value={(material.layers[index]?.detail ?? material.detail) * 100}
        min={0}
        max={100}
        unit="%"
        onChange={(value) => session.previewSurfaceParameters({ detail: value / 100 })}
        onCommit={() => session.commitSurface()}
        onCancel={() => session.cancelSurface()}
      />
      <div className="surface-slope-toggle">
        <label className="check-row">
          <input
            type="checkbox"
            checked={material.slopeRock}
            onChange={(event) => {
              session.previewSurface({ slopeRock: event.target.checked });
              session.commitSurface();
            }}
          />
          <span>坡度显岩</span>
        </label>
        <HelpTip
          label="坡度显岩"
          text="在陡坡自动混入指定地表；关闭后恢复纯手绘分布，不修改涂刷权重。"
        />
      </div>
      {material.slopeRock && (
        <label className="text-field">
          <span className="setting-label">
            坡度显岩地表
            <HelpTip
              label="坡度显岩地表"
              text="选择陡坡自动混入的地表；这是当前地图共用的显示设置。"
            />
          </span>
          <select
            aria-label="坡度显岩地表"
            value={
              session.doc.surfaceMaterial.slopeLayerId ??
              (session.doc.surfaceMaterial.layers.some((item) => item.id === 'rock')
                ? 'rock'
                : session.doc.surfaceMaterial.layers[0].id)
            }
            onChange={(event) =>
              session.change('选择显岩地表', (doc) => {
                doc.surfaceMaterial.slopeLayerId = event.target.value;
              })
            }
          >
            {session.doc.surfaceMaterial.layers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="palette-note">尺度越大，纹理越宽；坡度显岩只改变显示，不覆盖手绘材质。</p>
    </Group>
  );
}
