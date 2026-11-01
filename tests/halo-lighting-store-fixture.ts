// Halo Stage lighting store against the emulated Module, in its own process: other suites mock
// modules (idb-keyval) that the full store imports. No hardware.
import assert from 'node:assert/strict';

console.log = () => {}; // ToffeeHIDDevice logs every packet
// The device code expects a browser: a window, storage and WebHID (replaced by the emulated board).
const memoryStorage = () => {
const memory = new Map<string, string>();
return {getItem: (key: string) => memory.get(key) ?? null, removeItem: (key: string) => memory.delete(key),
  setItem: (key: string, value: string) => memory.set(key, value)};
};
Object.assign(globalThis, {window: globalThis, location: {search: '?debug=1', pathname: '/'},
sessionStorage: memoryStorage(), localStorage: memoryStorage()});
Object.defineProperty(navigator, 'hid', {configurable: true, value: {getDevices: async () => [], requestDevice: async () => []}});
const {connectEmulatedBoard, disconnectEmulatedBoard} = await import('../src/utils/toffee_studio/emulated-board');
const {store} = await import('../src/store'); // first, as in the app: the slices import each other
const {getSelectedKeyboardAPI, selectDevice} = await import('../src/store/devicesSlice');
const {HID} = await import('../src/shims/node-hid');
const {
getToffeeLighting, loadToffeeLighting, resetToffeeLighting, selectLightingTab, toffeeLightingApi,
updateLightingZone,
} = await import('../src/store/toffeeLightingSlice');

connectEmulatedBoard();
store.dispatch(selectDevice((await HID.devices())[0] as any));
const keyboard = getSelectedKeyboardAPI(store.getState()) as any;
await store.dispatch(loadToffeeLighting(keyboard));
let state = getToffeeLighting(store.getState());
assert.equal(state.status, 'ready');
assert.deepEqual(state.capabilities, {version: 3, frontEffects: 45, badgeEffects: 6});
assert.deepEqual(state.zones, {
  rear: {effect: 7, speed: 110, brightness: 180, hue: 190, saturation: 255},
  front: {effect: 1, speed: 100, brightness: 140, hue: 190, saturation: 230},
  badge: {effect: 1, speed: 100, brightness: 160, hue: 200, saturation: 255},
});

store.dispatch(updateLightingZone(keyboard, 'rear', {brightness: 61}));
store.dispatch(updateLightingZone(keyboard, 'rear', {hue: 10, saturation: 20}));
store.dispatch(updateLightingZone(keyboard, 'front', {effect: 44}));
store.dispatch(updateLightingZone(keyboard, 'badge', {effect: 0}));
state = getToffeeLighting(store.getState());
assert.deepEqual(state.zones!.rear, {effect: 7, speed: 110, brightness: 61, hue: 10, saturation: 20});
const api = toffeeLightingApi(keyboard);
assert.deepEqual(await api.getLightingState(), state.zones!.rear);
assert.deepEqual(await api.getFrontState(), {...state.zones!.front, effect: 44});
assert.equal((await api.getBadgeAnimationState()).enabled, false);
assert.equal(state.status, 'ready');

store.dispatch(selectLightingTab('badge'));
store.dispatch(resetToffeeLighting());
state = getToffeeLighting(store.getState());
assert.deepEqual(state, {tab: 'badge', status: 'idle', error: null, capabilities: null, zones: null});
disconnectEmulatedBoard();
process.stdout.write('HALO STORE PASS\n');
process.exit(0); // the app store keeps device timers running
