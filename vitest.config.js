import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/core/**/*.js', 'src/**/main.js'],
      exclude: ['**/*.test.js', '**/__tests__/**'],
    },
    setupFiles: ['./src/test/setup.js'],
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
})
