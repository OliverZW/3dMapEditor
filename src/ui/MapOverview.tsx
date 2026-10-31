import { useEffect, useRef, useState } from 'react';
import {
  Scan,
  Check,
  X,
  Map,
  Grid2X2,
  Trees,
  Castle,
  Hexagon,
  Boxes,
  Waves,
  Flag,
  FileCode2,
} from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button, Group } from './controls';
export function MapDimensions({
  width,
  depth,
  onWidth,
  onDepth,
}: {
  width: number;
  depth: number;
  onWidth: (value: number) => void;
  onDepth: (value: number) => void;
}) {
  return (
    <div className="dimension-fields">
      <label className="text-field">
        地面宽度（米）
        <input
          aria-label="地面宽度（米）"
          type="number"
          min={1}
          max={16384}
          step={1}
          value={Number.isFinite(width) ? width : ''}
          onChange={(e) => onWidth(e.target.valueAsNumber)}
        />
      </label>
      <label className="text-field">
        地面长度（米）
        <input
          aria-label="地面长度（米）"
          type="number"
          min={1}
          max={16384}
          step={1}
          value={Number.isFinite(depth) ? depth : ''}
          onChange={(e) => onDepth(e.target.valueAsNumber)}
        />
      </label>
    </div>
  );
}
export function MapOverview({ session }: { session: EditorSession }) {
  const doc = session.doc,
    settings = doc.settings;
  return (
    <div className="map-overview">
      <div className="overview-identity">
        <Map size={28} />
        <strong>{doc.name}</strong>
        <span>工程概览</span>
      </div>
      <div className="overview-metrics">
        <div>
          <Map size={18} />
          <span>地面范围</span>
          <b>
            {settings.width} × {settings.depth} m
          </b>
        </div>
        <div>
          <Grid2X2 size={18} />
          <span>高度采样</span>
          <b>
            {settings.samples} × {settings.samples}
          </b>
        </div>
        <div>
          <Trees size={18} />
          <span>树木／草层</span>
          <b>
            {doc.trees.length} ／ {doc.grass.length}
          </b>
        </div>
        <div>
          <Castle size={18} />
          <span>城池／要塞</span>
          <b>
            {doc.sites.filter((site) => site.kind === 'city').length} ／{' '}
            {doc.sites.filter((site) => site.kind === 'fortress').length}
          </b>
        </div>
      </div>
      <Group title="工程数据">
        <div className="overview-metrics">
          {[
            { label: '逻辑网格', value: doc.grid.columns + ' × ' + doc.grid.rows, icon: Grid2X2 },
            { label: '六边形半径', value: doc.grid.radius + ' m', icon: Hexagon },
            { label: '模型资源', value: doc.assets.length, icon: Boxes },
            { label: '河流', value: doc.rivers.length, icon: Waves },
            { label: '势力', value: doc.factions.length, icon: Flag },
            { label: '工程格式', value: 'v' + doc.formatVersion, icon: FileCode2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <Icon size={18} />
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </Group>
    </div>
  );
}
export function MapOverviewInspector({
  session,
  onApplied,
}: {
  session: EditorSession;
  onApplied: () => void;
}) {
  const settings = session.doc.settings;
  const [width, setWidth] = useState(settings.width),
    [depth, setDepth] = useState(settings.depth);
  const preview = session.resizePreview;
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (wasPreviewing.current && !preview) {
      setWidth(settings.width);
      setDepth(settings.depth);
    }
    wasPreviewing.current = !!preview;
  }, [preview, settings.width, settings.depth]);
  const valid = [width, depth].every(
    (value) => Number.isInteger(value) && value > 0 && value <= 16384,
  );
  const changed = width !== settings.width || depth !== settings.depth;
  const report = preview?.report;
  async function generate() {
    const version = session.documentVersion,
      revision = session.revision;
    session.busy = true;
    session.notify();
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (
        version === session.documentVersion &&
        revision === session.revision &&
        session.tool === 'overview'
      )
        session.previewResize(width, depth);
    } finally {
      session.busy = false;
      session.notify();
    }
  }
  return (
    <>
      <div className="inspector-actions" aria-label="尺寸调整操作">
        <div className="action-heading">地面尺寸</div>
        {preview ? (
          <div className="two-buttons">
            <Button icon={X} onClick={() => session.cancelResize()}>
              取消
            </Button>
            <Button
              icon={Check}
              className="primary"
              onClick={() => {
                session.commitResize();
                if (!session.error) onApplied();
              }}
            >
              确认调整
            </Button>
          </div>
        ) : (
          <Button
            icon={Scan}
            className="full primary"
            disabled={!valid || !changed || session.busy}
            onClick={() => void generate()}
          >
            {session.busy ? '正在生成预览…' : '预览调整'}
          </Button>
        )}
      </div>
      <div className="inspector-content">
        <Group title="范围与精度">
          <fieldset disabled={!!preview || session.busy} className="plain-fieldset">
            <MapDimensions width={width} depth={depth} onWidth={setWidth} onDepth={setDepth} />
          </fieldset>
          <p className="tip">以地图中心扩边或裁边，现有内容保持世界位置。每边最多 16384 米。</p>
          <div className="overview-row">
            <span>高度采样</span>
            <b>{settings.samples}²</b>
          </div>
          <div className="overview-row">
            <span>调整后间距</span>
            <b>
              {valid
                ? (width / (settings.samples - 1)).toFixed(2) +
                  ' × ' +
                  (depth / (settings.samples - 1)).toFixed(2) +
                  ' m'
                : '—'}
            </b>
          </div>
        </Group>
        {report && (
          <Group title="调整影响">
            <div className="resize-summary">
              {settings.width} × {settings.depth}
              <span>→</span>
              {width} × {depth} m
            </div>
            <p className="warning-note">
              蓝线为新边界，红色区域将被裁除。确认后可整体撤销，逻辑格号可能重新编号。
            </p>
            {[
              ['裁除树木', report.removedTrees],
              ['删除据点', report.removedSites],
              ['释放辖区格', report.removedCells],
              ['受影响草层', report.affectedGrassLayers],
              ['截断河流', report.clippedRivers],
              ['删除河流', report.removedRivers],
              ['新增河段', report.addedRiverSegments],
            ].map(([label, value]) => (
              <div className="overview-row" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </Group>
        )}
      </div>
    </>
  );
}
