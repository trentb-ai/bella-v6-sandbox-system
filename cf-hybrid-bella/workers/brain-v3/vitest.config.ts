import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bella/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      '@bella/telemetry': path.resolve(__dirname, '../../packages/telemetry/src'),
    },
  },
  test: {
    globals: false,
  },
});
