// Isolated startup-order regression. No browser, native HID, or real storage.
import assert from 'node:assert/strict';
import {mock} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';

const [scenario] = process.argv.slice(2);
assert.ok(['cold', 'cached'].includes(scenario), 'Required cold|cached scenario.');
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {release = resolve;});
  return {promise, release};
};
const catalog = gate(), stored = gate(), saved = gate();
const scans: Record<number, {v3: boolean}>[] = [];
const events: string[] = [];
const moduleId = 0x1067 * 65536 + 0x626d;
const customId = 1234;
mock.module('../src/utils/device-store', () => ({
  syncStore: async () => {events.push('catalog-start'); await catalog.promise;},
  getSupportedIdsFromStore: () => scenario === 'cached' ? {[moduleId]: {v3: true}} : {},
  getDefinitionsFromStore: () => ({}),
}));
mock.module('../src/utils/hid-keyboards', () => ({
  getRecognisedDevices: async (ids: Record<number, {v3: boolean}>) => {
    events.push('scan'); scans.push(structuredClone(ids)); return [];
  },
  getVendorProductId: (vendor: number, product: number) => vendor * 65536 + product,
}));
mock.module('../src/utils/keyboard-api', () => ({KeyboardAPI: class {}}));
mock.module('../src/shims/node-hid', () => ({tryForgetDevice: () => {throw new Error('Unexpected forget.');}}));
mock.module('../src/store/keymapSlice', () => ({loadKeymapFromDevice: () => () => {}}));
mock.module('../src/store/macrosSlice', () => ({loadMacros: () => () => {}}));
mock.module('../src/store/menusSlice', () => ({updateV3MenuData: () => () => {}}));
mock.module('../src/store/lightingSlice', () => ({updateLightingData: () => () => {}}));
mock.module('../src/store/definitionsSlice', () => ({
  updateDefinitions: () => ({type: 'test/definitions'}),
  reloadDefinitions: () => async () => {},
  loadLayoutOptions: () => async () => {},
  getDefinitions: () => ({}),
  loadStoredCustomDefinitions: () => async (dispatch: any) => {
    events.push('stored-start'); await stored.promise;
    dispatch({type: 'devices/ensureSupportedIds', payload: {productIds: [customId], version: 'v3'}});
    events.push('stored-ready');
  },
  loadCustomDefinitions: ({definitions, version}: any) => {
    assert.equal(version, 'v3'); assert.equal(definitions[0].vendorProductId, moduleId);
    events.push('bundled-ready'); return {type: 'test/bundled'};
  },
  storeCustomDefinitions: () => async () => {events.push('save-start'); await saved.promise; events.push('saved');},
}));
const {default: devices} = await import('../src/store/devicesSlice');
const {loadSupportedIds} = await import('../src/store/devicesThunks');
const store = configureStore({reducer: {devices}});
const loading = store.dispatch(loadSupportedIds() as any);
assert.deepEqual(events, ['catalog-start']);
catalog.release(); await Bun.sleep(10);
assert.equal(scans.length, 0, 'Must await saved custom definitions before scanning.');
stored.release(); await Bun.sleep(10);
assert.ok(events.includes('bundled-ready'), 'Bundled Module definition must be registered by the same startup owner.');
assert.equal(scans.length, 0, 'Must finish registering/persisting the bundled definition before scanning.');
saved.release(); await loading;
assert.equal(scans.length, 1, 'Exactly one startup scan.');
assert.deepEqual(scans[0][moduleId], {v3: true});
assert.deepEqual(scans[0][customId], {v3: true}, 'Other saved custom keyboards remain supported.');
assert.deepEqual(events, ['catalog-start', 'stored-start', 'stored-ready', 'bundled-ready', 'save-start', 'saved', 'scan']);
console.log(`STARTUP PASS ${scenario}: ${events.join(' -> ')}`);
