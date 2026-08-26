import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts?(x)'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
