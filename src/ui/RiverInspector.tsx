import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button, Group, NumberField } from './controls';

export function RiverInspector({ session }: { session: EditorSession }) {
  const river =
    session.riverPreview ?? session.doc.rivers.find((r) => r.id === session.selectedRiver);
  const [name, setName] = useState(river?.name ?? '');
  if (!river) return <p className="empty">新建或选择一条河流</p>;
  const preview = session.riverPreview;
  const connected = preview ? session.riverConfluencePreview.filter((r) => r.id !== river.id) : [];
  const error = session.riverPreviewError;
  function update(field: 'width' | 'depth' | 'waterLevel', value: number) {
    if (!session.riverPreview) session.startRiver(river!.id);
    session.riverPreview![field] = value;
    session.notify();
  }
  return (
    <Group title={preview ? '河流预览参数' : '河流参数'}>
      <label className="text-field">
        河流名称
        <input
          aria-label="河流名称"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (preview) {
              preview.name = e.target.value;
              session.notify();
            }
          }}
          onBlur={() => {
            if (!preview) {
              if (name.trim()) setName(name.trim());
              session.renameRiver(river.id, name);
            } else {
              preview.name = name.trim();
              setName(preview.name);
              session.notify();
            }
          }}
        />
      </label>
      {!name.trim() && (
        <div role="alert" className="warning-note">
          河流名称不能为空
        </div>
      )}
      <NumberField
        label="河宽 (m)"
        value={river.width}
        min={8}
        max={200}
        onChange={(v) => update('width', v)}
      />
      <NumberField
        label="深度 (m)"
        value={river.depth}
        min={1}
        max={64}
        onChange={(v) => update('depth', v)}
      />
      <NumberField
        label="水位 (m)"
        value={river.waterLevel}
        min={0}
        max={256}
        onChange={(v) => update('waterLevel', v)}
      />
      {preview ? (
        <>
          <p className="tip">点击空白处添加节点；按住蓝色节点拖动。Enter 确认，Esc 取消。</p>
          {!!connected.length && (
            <p className="tip" role="status" aria-label="交汇水位联动">
              确认后将与 {connected.length} 条河流统一水位为 {river.waterLevel} m：
              {connected.map((r) => r.name).join('、')}。
            </p>
          )}
          {error && (
            <div role="alert" className="warning-note">
              {error}
            </div>
          )}
        </>
      ) : (
        <Button
          className="full danger"
          icon={Trash2}
          onClick={() => {
            session.change('删除河流并恢复基础地形', (doc) => {
              doc.rivers = doc.rivers.filter((r) => r.id !== river.id);
            });
            session.selectedRiver = null;
            session.notify();
          }}
        >
          删除河流
        </Button>
      )}
    </Group>
  );
}
