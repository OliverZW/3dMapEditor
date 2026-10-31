import { Plus, Trash2, MousePointer2 } from 'lucide-react';
import type { EditorSession } from '../application/editor-session';
import { Button, Group } from './controls';
export function VegetationModes({ session }: { session: EditorSession }) {
  const selecting = session.tool === 'trees' && session.treeMode === 'select';
  return (
    <Group title="编辑模式">
      <div className="segmented">
        <Button
          icon={Plus}
          active={!selecting && !session.brush.erase}
          onClick={() => session.setVegetationMode('paint')}
        >
          刷入
        </Button>
        <Button
          icon={Trash2}
          active={!selecting && session.brush.erase}
          onClick={() => session.setVegetationMode('erase')}
        >
          擦除
        </Button>
        {session.tool === 'trees' && (
          <Button
            icon={MousePointer2}
            active={selecting}
            onClick={() => session.setVegetationMode('select')}
          >
            选择实例
          </Button>
        )}
      </div>
      <p className="tip">
        {selecting
          ? '左键选中地图树木，可替换模型、删除或按 F 定位。'
          : '按住左键拖动编辑，Shift 临时擦除当前模型。'}
      </p>
    </Group>
  );
}
