/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // Use relative base path for GitHub Pages
  test: {
    environment: 'jsdom'
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet')) {
              return 'vendor-leaflet';
            }
            return 'vendor';
          }
        },
      },
    },
    // Increase chunk size warning limit as well, but splitting is better
    chunkSizeWarningLimit: 1000,
  },
});
