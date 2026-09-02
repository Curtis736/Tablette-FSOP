import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.git', '.cache', 'coverage'],
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: [resolve(__dirname, 'tests/setup.js')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'components/**/*.js',
        'services/**/*.js',
        'utils/**/*.js'
      ],
      exclude: [
        'node_modules/**',
        'coverage/**',
        '**/*.test.js',
        '**/*.spec.js',
        'tests/**',
        'index.js',
        'app.js'
      ],
      thresholds: {
        global: {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100
        }
      },
      all: true
    }
  }
});
