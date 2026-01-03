import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'src',
  base: './',

  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        dashboard: resolve(__dirname, 'src/dashboard/index.html'),
        'spy-options': resolve(__dirname, 'src/spy-options/index.html'),
        backtest: resolve(__dirname, 'src/backtest/index.html'),
        trading: resolve(__dirname, 'src/trading/index.html'),
      },
      // Exclude Node.js-only modules from browser bundle
      external: [
        './cache.js',
        './schwab.js',
        './token-manager.js',
        './rate-limiter.js',
        'better-sqlite3',
        'fs',
        'path',
        'url',
      ],
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
})
