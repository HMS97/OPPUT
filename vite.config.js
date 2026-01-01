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
      },
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
