import { useState } from 'react';
import type { AssetKind, SurfaceTextureKind } from '../core/types';
import { Button } from './controls';
import { Modal } from './Modal';

export type ImportCategory = Exclude<AssetKind, 'fortress'> | 'textures';

export function ResourceImportDialog({
  category,
  textureKind,
  onClose,
  onChoose,
}: {
  category: ImportCategory;
  textureKind?: SurfaceTextureKind;
  onClose: () => void;
  onChoose: (category: ImportCategory, kind: SurfaceTextureKind) => void;
}) {
  const [selected, setSelected] = useState(category);
  const [kind, setKind] = useState<SurfaceTextureKind>(textureKind ?? 'color');
  return (
    <Modal title="导入资源" subtitle="选择资源库分类后，选择要导入的文件。" onClose={onClose}>
      <div className="modal-body resource-import-form">
        <label className="text-field">
          资源库分类
          <select
            aria-label="资源库分类"
            value={selected}
            onChange={(event) => setSelected(event.target.value as ImportCategory)}
          >
            <option value="city">据点</option>
            <option value="tree">树木</option>
            <option value="grass">草丛</option>
            <option value="textures">贴图</option>
          </select>
        </label>
        {selected === 'textures' && (
          <label className="text-field">
            贴图类型
            <select
              aria-label="导入贴图类型"
              value={kind}
              disabled={!!textureKind}
              onChange={(event) => setKind(event.target.value as SurfaceTextureKind)}
            >
              <option value="color">颜色贴图</option>
              <option value="normal">法线贴图</option>
            </select>
          </label>
        )}
        <p className="palette-note">
          {selected === 'textures'
            ? '支持 PNG、JPEG 图片，导入后加入贴图分类。'
            : '支持静态 GLB 模型，导入后可预览并调整基础校正。'}
        </p>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button className="primary" onClick={() => onChoose(selected, kind)}>
          选择文件
        </Button>
      </div>
    </Modal>
  );
}
