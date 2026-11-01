import { it, expect } from 'vitest';
import { configureWindowsGpu } from '../desktop/windows-gpu';
it('Windows 默认选择高性能，保留显式选择，其他系统保持原行为', () => {
  for (const platform of ['win32', 'linux', 'darwin'])
    for (const flag of ['', 'force_low_power_gpu', 'force_high_performance_gpu']) {
      const flags = new Set(flag ? [flag] : []);
      configureWindowsGpu(platform, {
        hasSwitch: (n) => flags.has(n),
        appendSwitch: (n) => {
          flags.add(n);
        },
      });
      expect([...flags]).toEqual(
        flag ? [flag] : platform === 'win32' ? ['force_high_performance_gpu'] : [],
      );
    }
});

it('显卡偏好映射与显式参数优先级', () => {
  for (const preference of ['discrete', 'integrated', 'auto'] as const) {
    const flags = new Set<string>();
    configureWindowsGpu(
      'win32',
      {
        hasSwitch: (name) => flags.has(name),
        appendSwitch: (name) => {
          flags.add(name);
        },
      },
      preference,
    );
    expect([...flags]).toEqual(
      preference === 'auto'
        ? []
        : [preference === 'discrete' ? 'force_high_performance_gpu' : 'force_low_power_gpu'],
    );
    const explicit = new Set(['force_low_power_gpu']);
    configureWindowsGpu(
      'win32',
      {
        hasSwitch: (name) => explicit.has(name),
        appendSwitch: (name) => {
          explicit.add(name);
        },
      },
      preference,
    );
    expect([...explicit]).toEqual(['force_low_power_gpu']);
  }
});
