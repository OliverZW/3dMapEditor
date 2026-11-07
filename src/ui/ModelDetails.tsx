import type { EditorSession } from '../application/editor-session';
import type { ModelAsset } from '../core/types';
import { AssetPreview } from './AssetPreview';
import { Group, NumberField, Button } from './controls';
import { Trash2 } from 'lucide-react';
import { assetReferenceLocations, isBuiltinAsset } from '../core/assets';
const KIND_LABEL = { city: '据点', fortress: '据点', tree: '树木', grass: '草丛' };
export function ModelDetails({
  session,
  resource,
  onDeleted,
}: {
  session: EditorSession;
  resource: ModelAsset;
  onDeleted: () => void;
}) {
  const locations = assetReferenceLocations(session.doc, resource.id);
  const referenceCount = session.assetReferences(resource.id);
  return (
    <div className="model-details">
      <AssetPreview asset={resource} />
      <h3>{resource.name}</h3>
      <p className="muted">
        {KIND_LABEL[resource.kind]} / {isBuiltinAsset(resource) ? '内置资源' : '工程自有 GLB'}
      </p>
      <div className="overview-row">
        <span>尺寸 (m)</span>
        <b>{resource.size.map((v) => v.toFixed(1)).join(' × ')}</b>
      </div>
      <div className="overview-row">
        <span>三角面 / 材质</span>
        <b>
          {resource.triangles} / {resource.materials}
        </b>
      </div>
      <Group title="资源基础校正">
        <NumberField
          label="基础缩放"
          value={resource.scale}
          min={0.01}
          max={100}
          step={0.1}
          onChange={(v) => {
            if (
              !session.assetReferences(resource.id) ||
              window.confirm(`这会影响 ${session.assetReferences(resource.id)} 处引用，继续？`)
            )
              session.change('修改模型基础缩放', (d) => {
                d.assets.find((a) => a.id === resource.id)!.scale = v;
              });
          }}
        />
        <NumberField
          label="朝向修正 (°)"
          value={Math.round((resource.yaw * 180) / Math.PI)}
          onChange={(v) => {
            if (
              !session.assetReferences(resource.id) ||
              window.confirm('基础朝向将影响全部引用，继续？')
            )
              session.change('修改模型基础朝向', (d) => {
                d.assets.find((a) => a.id === resource.id)!.yaw = (v * Math.PI) / 180;
              });
          }}
        />
        <NumberField
          label="贴地偏移 (m)"
          value={resource.offset}
          step={0.1}
          onChange={(v) => {
            if (
              !session.assetReferences(resource.id) ||
              window.confirm('贴地偏移将影响全部引用，继续？')
            )
              session.change('修改模型贴地偏移', (d) => {
                d.assets.find((a) => a.id === resource.id)!.offset = v;
              });
          }}
        />
      </Group>
      <p className="tip">{resource.source}</p>
      {locations.length > 0 && (
        <div className="asset-references">
          <strong>使用位置（{referenceCount}）</strong>
          <ul>
            {locations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {referenceCount > locations.length && (
            <p>另有 {referenceCount - locations.length} 处引用</p>
          )}
        </div>
      )}

      {!isBuiltinAsset(resource) && (
        <Button
          className="full danger"
          icon={Trash2}
          onClick={() => {
            if (session.deleteAsset(resource.id)) onDeleted();
          }}
        >
          删除资源
        </Button>
      )}
    </div>
  );
}
