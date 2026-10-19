import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {splitVendorChunkPlugin} from 'vite';
import {createHtmlPlugin} from 'vite-plugin-html';
import fs from 'fs';
import {debugFirmwareAssets} from './scripts/debug-firmware-assets';
import {firmwarePageEntry} from './scripts/firmware-page-entry';

const hash = fs.readFileSync('public/definitions/hash.json', 'utf8');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    debugFirmwareAssets(),
    firmwarePageEntry(),
    react(),
    createHtmlPlugin({
      inject: {
        data: {
          hash,
        },
      },
    }),
    splitVendorChunkPlugin(),
  ],
  assetsInclude: ['**/*.glb'],
  envDir: '.',
  server: {open: true},
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
      assets: path.resolve(__dirname, './src/assets'),
    },
  },
  optimizeDeps: {
    include: ['@the-via/reader'],
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
      // Enable esbuild polyfill plugins
      plugins: [],
    },
  },
});
