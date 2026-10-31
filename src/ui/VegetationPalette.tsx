import { useEffect, useMemo, useRef, useState } from 'react';
import { Trees, Sprout, Plus, Info, Search } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import type { ModelAsset } from '../core/types';
import { assetReferenceCounts, isBuiltinAsset } from '../core/assets';
import { VirtualList } from './VirtualList';
import { Button } from './controls';
const assetId = (asset: ModelAsset) => asset.id;
export function VegetationPalette({
  session,
  kind,
  onImport,
  onDetails,
}: {
  session: EditorSession;
  kind: 'tree' | 'grass';
  onImport: (kind: 'tree' | 'grass') => Promise<string | null>;
  onDetails: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const doc = session.doc,
    selected = session.brushAsset(kind),
    Icon = kind === 'tree' ? Trees : Sprout;
  const assets = useMemo(
    () => doc.assets.filter((asset) => asset.kind === kind),
    [doc, doc.assets, doc.assets.length, kind],
  );
  const filtered = useMemo(
    () =>
      assets.filter((asset) =>
        asset.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    [assets, search],
  );
  const counts = useMemo(() => assetReferenceCounts(doc), [doc, session.revision]);
  return (
    <div className="vegetation-palette">
      <div className="current-model">
        <Icon size={28} />
        <div>
          <small>当前模型</small>
          <strong>{selected?.name ?? '未选择模型'}</strong>
        </div>
        <Button
          icon={Info}
          title="当前模型详情"
          disabled={!selected}
          onClick={() => selected && onDetails(selected.id)}
        >
          详情
        </Button>
      </div>
      <Button
        icon={Plus}
        className="full"
        disabled={session.busy}
        onClick={() =>
          void (async () => {
            const id = await onImport(kind);
            if (id) {
              const imported = session.doc.assets.find((asset) => asset.id === id);
              if (imported?.kind === kind) session.selectBrushAsset(kind, id);
              else if (imported) session.setAsset(id);
              if (alive.current) setSearch('');
            }
          })()
        }
      >
        导入{kind === 'tree' ? '树木' : '草丛'}模型
      </Button>
      <label className="search-box">
        <Search size={14} />
        <input
          aria-label="搜索模型"
          placeholder="搜索模型名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="list-heading">
        {kind === 'tree' ? '树木' : '草丛'}模型{' '}
        <span>
          {filtered.length} / {assets.length}
        </span>
      </div>
      <VirtualList
        items={filtered}
        getId={assetId}
        selectedId={selected?.id}
        label={kind === 'tree' ? '树木模型列表' : '草丛模型列表'}
        onSelect={(asset) => session.selectBrushAsset(kind, asset.id)}
        renderRow={(asset) => (
          <>
            <div className={'asset-art ' + kind}>
              <Icon size={28} />
            </div>
            <span>
              <strong>{asset.name}</strong>
              <small>
                {isBuiltinAsset(asset) ? '内置' : '自定义 GLB'} · {counts.get(asset.id) ?? 0} 处引用
              </small>
            </span>
          </>
        )}
      />
    </div>
  );
}
