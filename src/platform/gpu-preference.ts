export type GpuPreference = 'discrete' | 'integrated' | 'auto';

export function isGpuPreference(value: unknown): value is GpuPreference {
  return value === 'discrete' || value === 'integrated' || value === 'auto';
}

export interface GpuSettings {
  supported: boolean;
  preference: GpuPreference;
  activePreference: GpuPreference;
  warning?: string;
}
