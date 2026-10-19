// Separate process: module mocks must not change normal test-suite configuration.
import {mock} from 'bun:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
mock.module('../src/config/debug', () => ({DEBUG_ENABLED: false, FIRMWARE_PATH: '/toffee-firmware', MEASUREMENT_PATH: '/toffee-debug'}));
const {FirmwareUpdate} = await import('../src/components/panes/firmware-update');
const {chooseModule} = await import('../src/utils/toffee_studio/firmware-update');
const {grantedBootloader} = await import('../src/utils/toffee_studio/firmware-webusb');
const {readRecoveries} = await import('../src/utils/toffee_studio/firmware-recovery');
const {firmwarePageEntry} = await import('../scripts/firmware-page-entry');
const {debugFirmwareAssets} = await import('../scripts/debug-firmware-assets');
assert.match(renderToStaticMarkup(createElement(FirmwareUpdate)), /Debug mode is disabled/);
await assert.rejects(chooseModule, /disabled/);
await assert.rejects(() => grantedBootloader({requestDevice: async () => {throw new Error('Forbidden');}, getDevices: async () => {throw new Error('Forbidden');}}), /disabled/);
await assert.rejects(readRecoveries, /disabled/);
const context = {emitFile() {throw new Error('Debug assets must not be emitted.');}};
for (const plugin of [firmwarePageEntry(), debugFirmwareAssets()]) {
  await (plugin.generateBundle as Function).call(context, {}, {});
}
console.info('PASS: debug off blocks UI, HID, USB, recovery DB, static entry and download assets.');
