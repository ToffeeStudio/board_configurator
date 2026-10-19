import type {Plugin} from 'vite';
import {DEBUG_ENABLED, FIRMWARE_PATH} from '../src/config/debug';

// Real static entry for hosts without SPA rewrites; reuse the same React bundle.
export function firmwarePageEntry(): Plugin {
  return {
    name: 'firmware-page-entry', enforce: 'post',
    generateBundle(_options, bundle) {
      if (!DEBUG_ENABLED) return;
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('Built index.html is required for the firmware entry.');
      this.emitFile({type: 'asset', fileName: FIRMWARE_PATH.slice(1) + '/index.html', source: html.source});
    },
  };
}
