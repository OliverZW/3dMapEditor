import { useEffect } from 'react';
import type { EditorSession } from '../application/editor-session';
import { Group, Slider } from './controls';

export function SurfaceInspector({ session }: { session: EditorSession }) {
  const material = session.surfacePreview ?? session.doc.surfaceMaterial;
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
      <Slider
        label="纹理尺度"
        value={material.scale * 100}
        min={25}
        max={400}
        unit="%"
        onChange={(value) => session.previewSurface({ scale: value / 100 })}
        onCommit={() => session.commitSurface()}
        onCancel={() => session.cancelSurface()}
      />
      <Slider
        label="细节强度"
        value={material.detail * 100}
        min={0}
        max={100}
        unit="%"
        onChange={(value) => session.previewSurface({ detail: value / 100 })}
        onCommit={() => session.commitSurface()}
        onCancel={() => session.cancelSurface()}
      />
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
      <p className="palette-note">尺度越大，纹理越宽；坡度显岩只改变显示，不覆盖手绘材质。</p>
    </Group>
  );
}
