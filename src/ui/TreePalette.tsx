import { useState } from 'react';
import { Plus, Trash2, Trees } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button } from './controls';
import { ConfirmDialog } from './ConfirmDialog';
import { VirtualList } from './VirtualList';
import type { TreeLayer } from '../core/types';
const layerId = (layer: TreeLayer) => layer.id;

export function TreePalette({ session, onAdd }: { session: EditorSession; onAdd: () => void }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const layers = session.doc.treeLayers ?? [];
  const target = layers.find((layer) => layer.id === deleting);
  const selected = session.treeLayer;
  return (
    <section className="vegetation-palette" aria-label="树木图层">
      <div className="surface-palette-actions">
        <Button className="primary" icon={Plus} disabled={session.busy} onClick={onAdd}>
          添加树木
        </Button>
        <Button
          className="danger"
          icon={Trash2}
          disabled={session.busy || !selected}
          onClick={() => setDeleting(selected!.id)}
        >
          删除树木
        </Button>
      </div>
      {target && (
        <ConfirmDialog
          title="删除树木图层确认"
          confirmLabel="确认删除树木"
          disabled={session.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            session.deleteTreeLayer(target.id);
            if (!session.error) setDeleting(null);
          }}
        >
          <p>
            删除“{target.name}”及该图层的{' '}
            {session.doc.trees.filter((tree) => tree.layerId === target.id).length}{' '}
            棵树木？可撤销恢复。
          </p>
        </ConfirmDialog>
      )}
      <div className="list-heading">
        树木图层 <span>{layers.length}</span>
      </div>
      <VirtualList
        items={layers}
        getId={layerId}
        selectedId={selected?.id}
        label="树木图层列表"
        emptyText="暂无树木图层"
        onSelect={(layer) => session.selectTreeLayer(layer.id)}
        renderRow={(layer) => (
          <>
            <div className="asset-art tree">
              <Trees size={28} />
            </div>
            <span>
              <strong>{layer.name}</strong>
              <small>
                {session.doc.trees.filter((tree) => tree.layerId === layer.id).length} 棵树木
              </small>
            </span>
          </>
        )}
      />
      {!layers.length && <p className="palette-note">点击“添加树木”，从资源库选择模型创建图层。</p>}
    </section>
  );
}
