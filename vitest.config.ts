import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['./tests/builtin-setup.mjs'], testTimeout: 30000 },
});
