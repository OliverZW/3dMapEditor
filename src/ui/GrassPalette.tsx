import { useState } from 'react';
import { Plus, Trash2, Sprout } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import type { GrassLayer } from '../core/types';
import { Button } from './controls';
import { ConfirmDialog } from './ConfirmDialog';
import { VirtualList } from './VirtualList';
const layerId = (layer: GrassLayer) => String(layer.id);

export function GrassPalette({ session, onAdd }: { session: EditorSession; onAdd: () => void }) {
  const [deleting, setDeleting] = useState<number | null>(null);
  const selected = session.grassLayer;
  const target = session.doc.grass.find((layer) => layer.id === deleting);
  const name = (layer: GrassLayer) =>
    session.doc.assets.find((asset) => asset.id === layer.assetId)?.name ?? '缺失模型';
  return (
    <section className="vegetation-palette" aria-label="草丛图层">
      <div className="surface-palette-actions">
        <Button className="primary" icon={Plus} disabled={session.busy} onClick={onAdd}>
          添加草丛
        </Button>
        <Button
          className="danger"
          icon={Trash2}
          disabled={session.busy || !selected}
          onClick={() => setDeleting(selected!.id)}
        >
          删除草丛
        </Button>
      </div>
      {target && (
        <ConfirmDialog
          title="删除草丛图层确认"
          confirmLabel="确认删除草丛"
          disabled={session.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            session.deleteGrassLayer(target.id);
            if (!session.error) setDeleting(null);
          }}
        >
          <p>删除“{name(target)}”及该图层的密度分布？可撤销恢复。</p>
        </ConfirmDialog>
      )}
      <div className="list-heading">
        草丛图层 <span>{session.doc.grass.length}</span>
      </div>
      <VirtualList
        items={session.doc.grass}
        getId={layerId}
        selectedId={selected ? layerId(selected) : undefined}
        label="草丛图层列表"
        emptyText="暂无草丛图层"
        onSelect={(layer) => session.selectGrassLayer(layer.id)}
        renderRow={(layer) => (
          <>
            <div className="asset-art grass">
              <Sprout size={28} />
            </div>
            <span>
              <strong>{name(layer)}</strong>
              <small>图层 {layer.id}</small>
            </span>
          </>
        )}
      />
      {!session.doc.grass.length && (
        <p className="palette-note">点击“添加草丛”，从资源库选择模型创建图层。</p>
      )}
    </section>
  );
}
