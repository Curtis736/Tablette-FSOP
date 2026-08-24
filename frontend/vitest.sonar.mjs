import { defineConfig } from 'vitest/config';

/** Coverage étroite pour Sonar (évite le seuil 100% all:true du vitest principal). */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/components/lotMatching.test.js'],
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      all: false,
      include: ['components/fsopForm/lotMatching.js'],
      exclude: ['node_modules/**', '**/*.test.js']
    }
  }
});
