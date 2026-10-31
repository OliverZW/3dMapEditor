import { defineConfig } from 'vitest/config';
import { engineValidatorPlugin } from './dev-tools/engine-validator-plugin.mjs';

export default defineConfig({
  plugins: [engineValidatorPlugin()],
  test: { setupFiles: ['./tests/builtin-setup.mjs'], testTimeout: 30000 },
});
