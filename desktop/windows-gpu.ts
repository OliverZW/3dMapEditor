/** Windows 多显卡优先落实视口的高性能偏好；显式低功耗/高性能启动参数优先。 */
export function configureWindowsGpu(
  platform: string,
  commandLine: { hasSwitch(name: string): boolean; appendSwitch(name: string): void },
) {
  if (
    platform === 'win32' &&
    !commandLine.hasSwitch('force_low_power_gpu') &&
    !commandLine.hasSwitch('force_high_performance_gpu')
  )
    commandLine.appendSwitch('force_high_performance_gpu');
}
