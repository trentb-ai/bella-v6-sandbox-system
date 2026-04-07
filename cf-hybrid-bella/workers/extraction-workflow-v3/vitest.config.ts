import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bella/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
  },
  test: {
    globals: false,
  },
});
