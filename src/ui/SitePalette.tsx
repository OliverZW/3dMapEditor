import { useState } from 'react';
import { Castle, Plus, Search, Trash2 } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button } from './controls';
import { ConfirmDialog } from './ConfirmDialog';

export function SitePalette({ session, onAdd }: { session: EditorSession; onAdd: () => void }) {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const doc = session.doc;
  const target = doc.sites.find((site) => site.id === deleting);
  const preview = session.sitePlacement || session.movingSite;
  return (
    <section className="site-palette" aria-label="据点管理">
      <div className="surface-palette-actions">
        <Button className="primary" icon={Plus} disabled={session.busy || preview} onClick={onAdd}>
          添加据点
        </Button>
        <Button
          className="danger"
          icon={Trash2}
          disabled={session.busy || preview || !session.selectedSite}
          onClick={() => setDeleting(session.selectedSite)}
        >
          删除据点
        </Button>
      </div>
      {target && (
        <ConfirmDialog
          title="删除据点确认"
          confirmLabel="确认删除据点"
          disabled={session.busy || preview}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            session.selectSite(target.id);
            session.deleteSite();
            if (!session.error) setDeleting(null);
          }}
        >
          <p>删除“{target.name}”并释放其中心与全部辖区？可撤销恢复。</p>
        </ConfirmDialog>
      )}
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label="搜索据点名称"
          placeholder="搜索据点名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="list-heading">
        据点列表 <span>{doc.sites.length}</span>
      </div>
      <div className="site-list">
        {doc.sites
          .filter((site) => site.name.includes(search.trim()))
          .map((site) => {
            const faction = doc.factions.find((f) => f.id === site.factionId);
            return (
              <button
                key={site.id}
                disabled={preview}
                className={`object-row ${session.selectedSite === site.id ? 'selected' : ''}`}
                onClick={() => session.selectSite(site.id)}
              >
                <Castle size={23} />
                <span>
                  {site.name}
                  <small>{faction?.name ?? '未分配势力'}</small>
                </span>
                <i style={{ background: faction?.color ?? '#88939a' }} />
              </button>
            );
          })}
        {!doc.sites.length && <p className="empty">点击“添加据点”，从资源库选择模型后放置。</p>}
        {doc.sites.length > 0 && !doc.sites.some((site) => site.name.includes(search.trim())) && (
          <p className="empty">没有符合条件的据点</p>
        )}
      </div>
    </section>
  );
}
