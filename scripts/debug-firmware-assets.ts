import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {Plugin} from 'vite';
const files = ['manifest.json', 'normal.uf2', 'manual.uf2', 'current-unlimited.uf2',
  'toffee-windows-setup-v1.exe', 'module-firmware-and-updater.zip', 'flash_module.py', 'led_discovery.py', 'requirements.txt', 'README.txt', 'LICENSE'];
// Not public/: only the listed release files are served, never the rest of firmware-downloads/.
export function debugFirmwareAssets(): Plugin {
  const root = resolve('firmware-downloads');
  return {
    name: 'debug-firmware-downloads',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url!, 'http://localhost');
        if (!url.pathname.startsWith('/firmware-downloads/')) return next();
        const file = url.pathname.slice('/firmware-downloads/'.length);
        if (!files.includes(file)) {res.statusCode = 404; res.end('Not found'); return;}
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(resolve(root, file)));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({type: 'asset', fileName: 'firmware-downloads/' + file, source: readFileSync(resolve(root, file))});
    },
  };
}
