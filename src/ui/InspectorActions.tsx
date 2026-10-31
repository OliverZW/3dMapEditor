import { MousePointer2, Move, Plus, Trash2, Check, X } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button } from './controls';
import { VegetationModes } from './VegetationModes';
export function InspectorActions({ session }: { session: EditorSession }) {
  const tool = session.tool;
  const site = session.doc.sites.find((item) => item.id === session.selectedSite);
  const river = session.doc.rivers.find((item) => item.id === session.selectedRiver);
  const preview = !!session.riverPreview || session.sitePlacement || session.movingSite;
  return (
    <div className="inspector-actions" aria-label="编辑操作">
      <div className="action-heading">编辑操作</div>
      {preview ? (
        <>
          <div className="two-buttons">
            <Button icon={X} onClick={() => session.cancelPreview()}>
              取消
            </Button>
            <Button
              icon={Check}
              className="primary"
              disabled={
                session.riverPreview
                  ? !!session.riverPreviewError
                  : !session.sitePreviewLocked || !session.siteCandidateValid
              }
              onClick={() => (session.riverPreview ? session.commitRiver() : session.commitSite())}
            >
              确认
            </Button>
          </div>
          <p className="action-note">
            {session.riverPreview
              ? '河流预览 · 拖动控制点后确认'
              : session.movingSite
                ? '移动据点 · 辖区保留原坐标'
                : '放置据点 · 点击格心锁定位置'}
          </p>
        </>
      ) : (
        <>
          {tool === 'sites' && (
            <div className="mode-buttons">
              <Button
                icon={MousePointer2}
                active={session.siteMode === 'select'}
                onClick={() => session.setSiteMode('select')}
              >
                选择
              </Button>
              <Button icon={Move} disabled={!site} onClick={() => session.beginMoveSite()}>
                移动
              </Button>
              <Button
                icon={Plus}
                disabled={!site}
                active={session.siteMode === 'add'}
                onClick={() => session.setSiteMode('add')}
              >
                增加辖区
              </Button>
              <Button
                icon={Trash2}
                disabled={!site}
                active={session.siteMode === 'erase'}
                onClick={() => session.setSiteMode('erase')}
              >
                擦除辖区
              </Button>
            </div>
          )}
          {(tool === 'trees' || tool === 'grass') && <VegetationModes session={session} />}
          {tool === 'river' && (
            <Button
              icon={Move}
              className="full"
              disabled={!river}
              onClick={() => river && session.startRiver(river.id)}
            >
              编辑控制点
            </Button>
          )}
          {tool === 'factions' && (
            <div className="two-buttons">
              <Button
                icon={Plus}
                disabled={!session.selectedFaction}
                active={session.factionMode === 'list'}
                onClick={() =>
                  session.setFactionMode(session.factionMode === 'list' ? 'inspect' : 'list')
                }
              >
                添加据点
              </Button>
              <Button
                icon={MousePointer2}
                disabled={!session.selectedFaction}
                active={session.factionMode === 'assign'}
                onClick={() =>
                  session.setFactionMode(session.factionMode === 'assign' ? 'inspect' : 'assign')
                }
              >
                地图点选
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
