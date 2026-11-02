// Separate process: module mocks must not change normal test-suite configuration.
// Debug off: the public firmware updater still works; the Debug-only tools stay blocked.
import {mock} from 'bun:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
mock.module('../src/config/debug', () => ({DEBUG_ENABLED: false, FIRMWARE_PATH: '/toffee-firmware', MEASUREMENT_PATH: '/toffee-debug', KEY_TESTER_PATH: '/test'}));
Object.assign(globalThis, {location: {search: ''}});
const {FirmwareUpdate} = await import('../src/components/panes/firmware-update');
const {grantedBootloader} = await import('../src/utils/toffee_studio/firmware-webusb');
const {firmwarePageEntry} = await import('../scripts/firmware-page-entry');
const {debugFirmwareAssets} = await import('../scripts/debug-firmware-assets');
const {connectEmulatedBoard} = await import('../src/utils/toffee_studio/emulated-board');
const {debugCommand} = await import('../src/utils/toffee_studio/manual-measurement');
const {ManualMeasurement} = await import('../src/components/toffee_studio/manual-measurement');
const {PowerDebug} = await import('../src/components/toffee_studio/power-debug');

const updater = renderToStaticMarkup(createElement(FirmwareUpdate));
assert.match(updater, /Module firmware update/);
assert.doesNotMatch(updater, /Debug mode is disabled/);
assert.equal(await grantedBootloader({requestDevice: async () => {throw new Error('Forbidden');}, getDevices: async () => []}), null);
const emitted: string[] = [];
const context = {emitFile: (file: {fileName: string}) => emitted.push(file.fileName)};
await (firmwarePageEntry().generateBundle as Function).call(context, {}, {'index.html': {type: 'asset', source: '<html></html>'}});
await (debugFirmwareAssets().generateBundle as Function).call(context, {}, {});
assert.ok(emitted.includes('toffee-firmware/index.html'));
assert.ok(emitted.includes('firmware-downloads/manifest.json') && emitted.includes('firmware-downloads/normal.uf2'));
console.info('PASS: debug off keeps the updater page, USB helpers, static entry and downloads.');

assert.throws(connectEmulatedBoard, /Debug mode/);
await assert.rejects(() => debugCommand({} as never, 0x89), /Debug mode is disabled/);
assert.match(renderToStaticMarkup(createElement(ManualMeasurement, {} as never)), /Debug mode is disabled/);
assert.equal(renderToStaticMarkup(createElement(PowerDebug, {device: null})), '');
console.info('PASS: debug off blocks the emulated board, Lighting Debug commands and the power panel.');
