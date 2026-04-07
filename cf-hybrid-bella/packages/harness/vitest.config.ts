import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bella/contracts': path.resolve(__dirname, '../contracts/src'),
      '@bella/telemetry': path.resolve(__dirname, '../telemetry/src/index.ts'),
    },
  },
  test: {
    globals: false,
  },
});
