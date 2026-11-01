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
