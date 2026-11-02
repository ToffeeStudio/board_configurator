import type {Plugin} from 'vite';
import {FIRMWARE_PATH, KEY_TESTER_PATH} from '../src/config/debug';

// Real static entry for hosts without SPA rewrites; reuse the same React bundle.
export function firmwarePageEntry(): Plugin {
  return {
    name: 'firmware-page-entry', enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('Built index.html is required for the firmware entry.');
      for (const path of [FIRMWARE_PATH, KEY_TESTER_PATH]) {
        this.emitFile({type: 'asset', fileName: path.slice(1) + '/index.html', source: html.source});
      }
    },
  };
}
