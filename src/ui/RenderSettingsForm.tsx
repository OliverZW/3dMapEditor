import { Fragment, useEffect, useState } from 'react';
import {
  DISPLAY_QUALITIES,
  isDisplayQuality,
  isShadowSize,
  presetSettings,
} from '../renderer/display-quality';
import type { RenderSettings } from '../renderer/display-quality';
import { isGpuPreference } from '../platform/gpu-preference';
import type { GpuSettings } from '../platform/gpu-preference';
import { Button } from './controls';

const OPTIONS = [
  ['shadows', '阴影', '关闭可减少阴影绘制开销。'],
  ['treeShadows', '树木投影', '关闭可减少树木阴影开销，树木仍显示并接收阴影，据点投影不受影响。'],
  ['antialias', '抗锯齿', '平滑模型边缘，开启会增加显卡负担。'],
  ['simplifiedSurface', '简化地表', '减少地表采样，开启后不显示地表法线细节。'],
  ['demandRendering', '按需渲染', '静止时暂停绘制以降低功耗，水草动画仍正常播放。'],
] as const;

export function RenderSettingsForm({
  settings,
  blocked,
  onApply,
  onClose,
}: {
  settings: RenderSettings;
  blocked: boolean;
  onApply: (settings: RenderSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [gpu, setGpu] = useState<GpuSettings>({
    supported: false,
    preference: 'discrete',
    activePreference: 'discrete',
  });
  const [loaded, setLoaded] = useState(!window.mapEditorDesktop);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const bridge = window.mapEditorDesktop;
    if (bridge)
      void bridge
        .getGpuSettings()
        .then((value) => {
          if (alive) {
            setGpu(value);
            setLoaded(true);
            if (value.warning) setError(value.warning);
          }
        })
        .catch((reason: unknown) => {
          if (alive) setError(`读取显卡设置失败：${String(reason)}`);
        });
    return () => {
      alive = false;
    };
  }, []);
  const preset = presetSettings(draft.quality);
  const custom =
    draft.shadowSize !== preset.shadowSize || OPTIONS.some(([key]) => draft[key] !== preset[key]);
  return (
    <>
      <div className="modal-body render-settings">
        <section>
          <h3>画质与性能</h3>
          <label className="text-field">
            画质预设
            <select
              aria-label="显示档位"
              value={draft.quality}
              disabled={saving}
              onChange={(event) => {
                if (isDisplayQuality(event.target.value))
                  setDraft(presetSettings(event.target.value));
              }}
            >
              {Object.entries(DISPLAY_QUALITIES).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="tip">
            {custom ? '已自定义' : '使用预设'} · 仅影响本机显示，切换预设会重置下方开关。
          </p>
          {OPTIONS.map(([key, label, hint]) => (
            <Fragment key={key}>
              <label className="render-setting-option">
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={draft[key]}
                  disabled={saving || (key === 'treeShadows' && !draft.shadows)}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
                />
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
              </label>
              {key === 'shadows' && (
                <label className="text-field">
                  阴影精度
                  <select
                    aria-label="阴影精度"
                    value={draft.shadowSize}
                    disabled={saving || !draft.shadows}
                    onChange={(event) => {
                      const size = Number(event.target.value);
                      if (isShadowSize(size)) setDraft({ ...draft, shadowSize: size });
                    }}
                  >
                    <option value={512}>低（512 × 512）</option>
                    <option value={1024}>中（1024 × 1024）</option>
                    <option value={2048}>高（2048 × 2048）</option>
                  </select>
                  <small>较低精度可减少显存和阴影绘制开销，阴影边缘会更粗糙。</small>
                </label>
              )}
            </Fragment>
          ))}
        </section>
        <section>
          <h3>显卡</h3>
          <label className="text-field">
            显卡偏好
            <select
              value={gpu.preference}
              disabled={!loaded || !gpu.supported || saving}
              onChange={(event) => {
                if (isGpuPreference(event.target.value))
                  setGpu({ ...gpu, preference: event.target.value });
              }}
            >
              <option value="discrete">独立显卡（高性能）</option>
              <option value="integrated">集成显卡（省电）</option>
              <option value="auto">系统自动选择</option>
            </select>
          </label>
          <p className="tip">
            {gpu.supported
              ? '应用后下次启动生效；实际使用的显卡由系统和驱动决定。'
              : '当前环境的显卡由系统管理，仅 Windows 桌面版支持设置。'}
          </p>
          {gpu.supported && gpu.preference !== gpu.activePreference && (
            <p className="tip">显卡偏好与本次启动不同，下次启动生效。</p>
          )}
        </section>
        {error && (
          <p role="alert" className="home-error">
            {error}
          </p>
        )}
        {blocked && <p className="tip">请先完成当前编辑或预览，再应用设置。</p>}
      </div>
      <div className="modal-actions">
        <Button
          disabled={saving}
          onClick={() => {
            setDraft(presetSettings('fast'));
            setGpu({ ...gpu, preference: 'discrete' });
          }}
        >
          恢复默认
        </Button>
        <Button disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button
          className="primary"
          disabled={blocked || !loaded || saving}
          onClick={async () => {
            setSaving(true);
            setError('');
            try {
              onApply(draft);
              if (gpu.supported) {
                try {
                  await window.mapEditorDesktop!.setGpuPreference(gpu.preference);
                } catch (reason) {
                  throw new Error(`渲染设置已应用；显卡设置保存失败：${String(reason)}`);
                }
              }
              onClose();
            } catch (reason) {
              setError(String(reason));
            } finally {
              setSaving(false);
            }
          }}
        >
          应用
        </Button>
      </div>
    </>
  );
}
