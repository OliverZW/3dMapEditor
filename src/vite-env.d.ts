/// <reference types="vite/client" />
declare module 'virtual:engine-export-validators' {
  import type { ValidateFunction } from 'ajv';
  export const validators: Record<string, ValidateFunction>;
}
