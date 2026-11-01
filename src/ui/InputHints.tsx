import { useSyncExternalStore } from 'react';
import type { CameraNavigation } from '../renderer/camera-navigation';
import type { EditorSession } from '../application/editor-session';
export function InputHints({
  navigation,
  session,
}: {
  navigation: CameraNavigation;
  session: EditorSession;
}) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  const flying = state.gesture === 'fly';
  const terrainAction = { raise: '抬高', lower: '降低', smooth: '平滑', flatten: '定高' }[
    session.brush.terrainMode
  ];
  const action =
    session.tool === 'overview'
      ? '查看地图'
      : session.sitePlacement || session.movingSite
        ? '点击锁定位置'
        : session.paintingTerritory
          ? '拖动绘制辖区'
          : session.tool === 'factions'
            ? session.factionMode === 'assign'
              ? '点击据点加入势力'
              : '查看势力'
            : session.tool === 'sites'
              ? '选择据点'
              : session.tool === 'trees' && session.treeMode === 'select'
                ? '选择树木实例'
                : session.tool === 'river'
                  ? '添加／拖动节点'
                  : session.tool === 'terrain'
                    ? '拖动' + terrainAction
                    : session.tool === 'surface'
                      ? '涂刷' + session.doc.surfaceMaterial.layers[session.brush.surfaceLayer].name
                      : '拖动' + (session.brush.erase ? '擦除' : '刷入');
  return (
    <div className="input-hints" aria-label="地图操作提示">
      <div className="hint-line">
        {flying ? (
          <>
            <span>
              <kbd>右键</kbd>观察
            </span>
            <span>
              <kbd>WASD</kbd>移动
            </span>
            <span>
              <kbd>QE</kbd>升降
            </span>
            <span>
              <kbd>Shift</kbd>加速
            </span>
            <span>
              <kbd>滚轮</kbd>调速 {Math.round(state.speed)} m/s
            </span>
          </>
        ) : (
          <>
            <span>
              <kbd>左键</kbd>
              {action}
            </span>
            <span>
              <kbd>右键</kbd>
              {state.projection === 'perspective' ? '观察＋WASD' : '平移＋WASD'}
            </span>
            <span>
              <kbd>中键</kbd>/<kbd>空格＋左键</kbd>平移
            </span>
            <span>
              <kbd>滚轮</kbd>缩放
            </span>
          </>
        )}
        {!flying && state.projection === 'perspective' && (
          <span>
            <kbd>Alt＋左键</kbd>环绕
          </span>
        )}
        <span>
          <kbd>F</kbd>定位
        </span>
        {(session.riverPreview ||
          session.sitePlacement ||
          session.movingSite ||
          session.resizePreview) && (
          <span>
            <kbd>Enter</kbd>确认 <kbd>Esc</kbd>取消
          </span>
        )}
        {(session.tool === 'grass' || (session.tool === 'trees' && session.treeMode === 'paint')) &&
          !flying && (
            <span>
              <kbd>Shift</kbd>临时擦除
            </span>
          )}
        {session.tool === 'terrain' &&
          ['raise', 'lower'].includes(session.brush.terrainMode) &&
          !flying && (
            <span>
              <kbd>Shift</kbd>反向升降
            </span>
          )}
      </div>
    </div>
  );
}
