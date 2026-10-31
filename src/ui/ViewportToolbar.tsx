import { useSyncExternalStore } from 'react';
import {
  Compass,
  Hexagon,
  Trees,
  Sprout,
  Waves,
  Castle,
  Shield,
  Flag,
  Keyboard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import type { ViewSettings } from '../core/types';
import type { CameraNavigation } from '../renderer/camera-navigation';
const LAYERS: { key: keyof ViewSettings; label: string; icon: LucideIcon; shortcut?: string }[] = [
  { key: 'hex', label: '六边形格线', icon: Hexagon, shortcut: 'G' },
  { key: 'trees', label: '树木', icon: Trees },
  { key: 'grass', label: '草丛', icon: Sprout },
  { key: 'water', label: '河流水面', icon: Waves },
  { key: 'sites', label: '城池与要塞', icon: Castle },
  { key: 'territories', label: '选中据点范围', icon: Shield },
  { key: 'factions', label: '势力范围', icon: Flag },
];
export function ViewportToolbar({
  session,
  navigation,
}: {
  session: EditorSession;
  navigation: CameraNavigation;
}) {
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  return (
    <div className="viewport-actions" role="toolbar" aria-label="视口显示">
      <button
        aria-label="切换透视 / 正交"
        aria-pressed={state.projection === 'orthographic'}
        title={
          (state.projection === 'perspective'
            ? '当前透视，点击切换正交'
            : '当前正交，点击切换透视') + ' / V'
        }
        className={state.projection === 'orthographic' ? 'active' : ''}
        onClick={() => navigation.toggleProjection()}
      >
        <Compass size={17} />
      </button>
      {LAYERS.map((layer) => (
        <button
          key={layer.key}
          aria-label={layer.label}
          aria-pressed={session.view[layer.key]}
          title={
            layer.label +
            '：' +
            (session.view[layer.key] ? '显示中，点击隐藏' : '已隐藏，点击显示') +
            (layer.shortcut ? ' / ' + layer.shortcut : '')
          }
          className={session.view[layer.key] ? 'active' : ''}
          onClick={() => session.setViewLayer(layer.key, !session.view[layer.key])}
        >
          <layer.icon size={17} />
        </button>
      ))}
      <button
        aria-label="操作提示"
        aria-pressed={session.showInputHints}
        title={session.showInputHints ? '操作提示：显示中，点击隐藏' : '操作提示：已隐藏，点击显示'}
        className={session.showInputHints ? 'active' : ''}
        onClick={() => {
          session.showInputHints = !session.showInputHints;
          session.notify();
        }}
      >
        <Keyboard size={17} />
      </button>
    </div>
  );
}
