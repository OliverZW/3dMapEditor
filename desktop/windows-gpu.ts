import type { GpuPreference } from '../src/platform/gpu-preference';
export function isGpuPreference(value: unknown): value is GpuPreference {
  return value === 'discrete' || value === 'integrated' || value === 'auto';
}
/** Windows 多显卡优先落实本机偏好；显式低功耗/高性能启动参数优先。 */
export function configureWindowsGpu(
  platform: string,
  commandLine: { hasSwitch(name: string): boolean; appendSwitch(name: string): void },
  preference: GpuPreference = 'discrete',
) {
  if (
    platform === 'win32' &&
    !commandLine.hasSwitch('force_low_power_gpu') &&
    !commandLine.hasSwitch('force_high_performance_gpu')
  )
    if (preference !== 'auto')
      commandLine.appendSwitch(
        preference === 'integrated' ? 'force_low_power_gpu' : 'force_high_performance_gpu',
      );
}
