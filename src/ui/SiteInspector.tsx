import { Trash2 } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import type { Site } from '../core/types';
import { getSiteCells, hexIndex } from '../core/hex';
import { Button, Group, Slider, NumberField } from './controls';
const KIND_LABEL = { city: '城池', fortress: '要塞' };
export function SiteInspector({ session, site }: { session: EditorSession; site: Site }) {
  const doc = session.doc,
    b = session.brush;
  function updateBrush(key: 'hexRadius', value: number) {
    session.brush[key] = value;
    session.notify();
  }
  return (
    <>
      <Group title={`${KIND_LABEL[site.kind]} · ${site.id}`}>
        <label className="text-field">
          名称
          <input
            aria-label="据点名称"
            key={site.id + site.name}
            defaultValue={site.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== site.name)
                session.change('重命名据点', (d) => {
                  d.sites.find((s) => s.id === site.id)!.name = name;
                });
            }}
          />
        </label>
        <label className="text-field">
          模型
          <select
            aria-label="据点模型"
            value={site.assetId}
            onChange={(e) => session.replaceModel(e.target.value)}
          >
            {doc.assets
              .filter((a) => a.kind === site.kind)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-field">
          所属势力
          <select
            aria-label="所属势力"
            value={site.factionId ?? ''}
            onChange={(e) =>
              session.assignSiteFaction(site.id, e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">未分配势力</option>
            {doc.factions.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-fields">
          <NumberField
            label="朝向 (°)"
            value={Math.round((site.yaw * 180) / Math.PI)}
            onChange={(v) =>
              session.change('调整据点朝向', (d) => {
                d.sites.find((s) => s.id === site.id)!.yaw = (v * Math.PI) / 180;
              })
            }
          />
          <NumberField
            label="缩放"
            value={site.scale}
            min={0.1}
            max={10}
            step={0.1}
            onChange={(v) =>
              session.change('缩放据点', (d) => {
                d.sites.find((s) => s.id === site.id)!.scale = v;
              })
            }
          />
        </div>
        <div className="coordinate-tag">
          中心 q {site.center.q} / r {site.center.r}
        </div>
      </Group>
      <Group title="六边形辖区">
        <div className="territory-count">
          <span>
            <b>1</b>中心格
          </span>
          <span>
            <b>{getSiteCells(doc, site.id, false).length}</b>辖区格
          </span>
        </div>
        <Slider
          label="逻辑半径"
          value={b.hexRadius}
          min={0}
          max={4}
          unit="圈"
          onChange={(v) => updateBrush('hexRadius', v)}
        />
        <p className="tip">覆盖 {1 + 3 * b.hexRadius * (b.hexRadius + 1)} 格 · 中心格受保护</p>
        <Button
          className="full"
          onClick={() => {
            if (window.confirm('清空该据点的辖区？中心格将保留。'))
              session.change('清空据点辖区', (d) => {
                const center = hexIndex(d.grid, site.center);
                d.owners.forEach((owner, i) => {
                  if (owner === site.id && i !== center) d.owners[i] = 0;
                });
              });
          }}
        >
          清空辖区，保留中心
        </Button>
      </Group>
      <Button
        className="danger full"
        icon={Trash2}
        onClick={() => {
          if (window.confirm('删除据点并释放其中心与全部辖区？可撤销。')) session.deleteSite();
        }}
      >
        删除{KIND_LABEL[site.kind]}
      </Button>
    </>
  );
}
