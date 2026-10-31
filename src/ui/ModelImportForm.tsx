import { useState } from 'react';
import type { AssetKind, ModelAsset } from '../core/types';
import { AssetPreview } from './AssetPreview';
import { Button } from './controls';

export function ModelImportForm({
  asset,
  onCancel,
  onConfirm,
}: {
  asset: ModelAsset;
  onCancel: () => void;
  onConfirm: (asset: ModelAsset) => string | null;
}) {
  const [draft, setDraft] = useState(asset);
  const [error, setError] = useState('');
  const [numbers, setNumbers] = useState({
    scale: String(asset.scale),
    yaw: String((asset.yaw * 180) / Math.PI),
    offset: String(asset.offset),
  });
  const update = (values: Partial<ModelAsset>) => {
    setDraft((current) => ({ ...current, ...values }));
    setError('');
  };
  const changeNumber = (key: 'scale' | 'yaw' | 'offset', value: string) => {
    setNumbers((current) => ({ ...current, [key]: value }));
    const parsed = Number(value);
    if (
      value.trim() &&
      Number.isFinite(parsed) &&
      (key !== 'scale' || (parsed >= 0.01 && parsed <= 100))
    )
      update({ [key]: key === 'yaw' ? (parsed * Math.PI) / 180 : parsed });
    else setError('');
  };
  return (
    <>
      <div className="modal-body model-import-form">
        <AssetPreview asset={draft} showGround />
        <p className="palette-note">网格表示地面，预览包含基础缩放、朝向与贴地偏移。</p>
        <label className="text-field">
          模型名称
          <input
            aria-label="模型名称"
            value={draft.name}
            maxLength={128}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="text-field">
          模型分类
          <select
            aria-label="模型分类"
            value={draft.kind}
            onChange={(event) => update({ kind: event.target.value as AssetKind })}
          >
            <option value="tree">树木</option>
            <option value="grass">草丛</option>
            <option value="city">城池</option>
            <option value="fortress">要塞</option>
          </select>
        </label>
        {(['scale', 'yaw', 'offset'] as const).map((key) => {
          const label = { scale: '基础缩放', yaw: '朝向修正 (°)', offset: '贴地偏移 (m)' }[key];
          return (
            <label className="number-field" key={key}>
              <span>{label}</span>
              <input
                aria-label={label}
                type="text"
                inputMode="decimal"
                value={numbers[key]}
                onChange={(event) => changeNumber(key, event.target.value)}
              />
            </label>
          );
        })}
        <p className="palette-note">
          尺寸 {draft.size.map((value) => value.toFixed(1)).join(' × ')} 米 · {draft.triangles}{' '}
          个三角面 · {draft.materials} 个材质
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <Button onClick={onCancel}>取消</Button>
        <Button
          className="primary"
          disabled={!draft.name.trim()}
          onClick={() => {
            const { scale, yaw, offset } = numbers;
            if (
              ![scale, yaw, offset].every(
                (value) => value.trim() && Number.isFinite(Number(value)),
              ) ||
              Number(scale) < 0.01 ||
              Number(scale) > 100
            ) {
              setError('请输入有效数字，基础缩放须在 0.01～100 之间。');
              return;
            }
            const message = onConfirm({ ...draft, name: draft.name.trim() });
            if (message) setError(message);
          }}
        >
          确认导入
        </Button>
      </div>
    </>
  );
}
