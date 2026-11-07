import { useState } from 'react';
import { Castle, Crosshair, Plus, Trash2 } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { getFactionCells } from '../core/hex';
import { Group } from './controls';

export function FactionInspector({
  session,
  onLocate,
}: {
  session: EditorSession;
  onLocate: (id: number) => void;
}) {
  const adding = session.factionMode === 'list';
  const [search, setSearch] = useState('');
  const doc = session.doc;
  const faction = doc.factions.find((f) => f.id === session.selectedFaction);
  if (!faction) return <p className="empty">从左侧选择或创建一个势力</p>;
  const members = doc.sites.filter((s) => s.factionId === faction.id);
  const candidates = doc.sites.filter(
    (s) => s.factionId !== faction.id && s.name.includes(search.trim()),
  );
  return (
    <Group title="势力属性">
      <label className="text-field">
        名称
        <input
          aria-label="势力名称"
          key={faction.id + faction.name}
          defaultValue={faction.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== faction.name)
              session.change('重命名势力', (d) => {
                d.factions.find((f) => f.id === faction.id)!.name = name;
              });
          }}
        />
      </label>
      <label className="color-field">
        范围颜色
        <input
          type="color"
          aria-label="势力颜色"
          value={faction.color}
          onChange={(e) =>
            session.change('修改势力颜色', (d) => {
              d.factions.find((f) => f.id === faction.id)!.color = e.target.value;
            })
          }
        />
        <code>{faction.color}</code>
      </label>
      <div className="overview-row">
        <span>派生范围</span>
        <b>{getFactionCells(doc, faction.id).length} 格</b>
      </div>
      <div className="list-heading">
        所属据点 <span>{members.length}</span>
      </div>
      {!members.length && <p className="empty">尚无成员，使用顶部操作添加据点。</p>}
      {members.map((site) => {
        const Icon = Castle;
        return (
          <div className="faction-member" key={site.id}>
            <Icon size={16} />
            <span>
              {site.name}
              <small>据点</small>
            </span>
            <button title={'定位 ' + site.name} onClick={() => onLocate(site.id)}>
              <Crosshair size={14} />
            </button>
            <button
              title={'移出势力 ' + site.name}
              onClick={() => session.assignSiteFaction(site.id, null)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      {session.factionMode === 'assign' && (
        <p className="tip assignment-tip">
          左键点击据点模型加入当前势力，可连续添加。按 Esc 退出。
        </p>
      )}
      {adding && (
        <section className="faction-candidates" aria-label="添加据点列表">
          <label className="text-field">
            搜索据点
            <input
              aria-label="搜索据点"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {candidates.map((site) => {
            const Icon = Castle;
            return (
              <button
                className="object-row"
                title={'加入当前势力 ' + site.name}
                aria-label={'加入当前势力 ' + site.name}
                key={site.id}
                onClick={() => session.assignSiteFaction(site.id, faction.id)}
              >
                <Icon size={16} />
                <span>
                  {site.name}
                  <small>
                    据点 · {doc.factions.find((f) => f.id === site.factionId)?.name ?? '未分配势力'}
                  </small>
                </span>
                <Plus size={14} />
              </button>
            );
          })}
          {!candidates.length && <p className="empty">没有符合条件的其他据点</p>}
        </section>
      )}
    </Group>
  );
}
