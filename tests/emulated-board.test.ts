// The emulated Module, driven through the app's own HID classes and validators. No hardware.
import {afterAll, expect, test} from 'bun:test';
import {
  connectEmulatedBoard, defaultEmulatedState, disconnectEmulatedBoard, emulatedReply,
  EMULATED_PRODUCT_NAME, isEmulatedBoardConnected, isEmulatedDevice,
} from '../src/utils/toffee_studio/emulated-board';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import {chooseModule} from '../src/utils/toffee_studio/firmware-update';
import {debugCommand} from '../src/utils/toffee_studio/manual-measurement';
import lightingMap from '../src/utils/toffee_studio/lighting-map.json';
import definition from '../src/draft_definition.json';

console.log = () => {}; // ToffeeHIDDevice logs every packet
const realDevice = {vendorId: 0x1067, productId: 0x626d, collections: [{usagePage: 0xff60, usage: 0x61}]};
const realHid = {getDevices: async () => [realDevice], requestDevice: async () => [realDevice]};
Object.defineProperty(navigator, 'hid', {configurable: true, value: realHid});
afterAll(() => disconnectEmulatedBoard());

test('connecting hides real boards behind exactly one emulated Module; disconnecting restores them', async () => {
  expect(await navigator.hid.getDevices()).toEqual([realDevice] as any);
  connectEmulatedBoard();
  expect(isEmulatedBoardConnected()).toBe(true);
  const devices = await navigator.hid.getDevices();
  expect(devices.length).toBe(1);
  expect(isEmulatedDevice(devices[0])).toBe(true);
  expect(devices[0].productName).toBe(EMULATED_PRODUCT_NAME);
  expect(await navigator.hid.requestDevice({filters: []})).toEqual(devices);
  disconnectEmulatedBoard();
  expect(isEmulatedBoardConnected()).toBe(false);
  expect(await navigator.hid.getDevices()).toEqual([realDevice] as any);
  expect(Object.keys(realHid)).toEqual(['getDevices', 'requestDevice']);
});

test('Toffee lighting replies pass the app’s own validation and keep what was set', async () => {
  connectEmulatedBoard();
  const [device] = await navigator.hid.getDevices();
  const api = new ToffeeLightingAPI(new ToffeeHIDDevice(device));
  expect((await api.getCapabilities()).version).toBe(3);
  const power = await api.getPowerStatus();
  expect(power.frontBadgeMax).toBe(190);
  expect(power.limited).toBe(false);
  await api.setAnimation(4); await api.setSpeed(33); await api.setBrightness(77); await api.setColor(10, 20);
  expect(await api.getLightingState()).toEqual({effect: 4, speed: 33, brightness: 77, hue: 10, saturation: 20});
  const front = {effect: 2, speed: 9, brightness: 120, hue: 40, saturation: 200};
  await api.setFrontState(front);
  expect(await api.getFrontState()).toEqual(front);
  const badge = {enabled: true, brightness: 50, hue: 60, saturation: 70, effect: 3, speed: 80};
  await api.setBadgeAnimationState(badge);
  expect(await api.getBadgeAnimationState()).toEqual(badge);
  expect(await api.getBadgeState()).toEqual({enabled: true, brightness: 50, hue: 60, saturation: 70});
  for (const {index} of lightingMap.front) expect(await api.getLedBrightness(index)).toBe(255);
  await api.setLedBrightness(lightingMap.front[0].index, 12);
  expect(await api.getLedBrightness(lightingMap.front[0].index)).toBe(12);
  disconnectEmulatedBoard();
});

// KeyboardAPI itself is exercised end to end by tests/emulated-board-browser.ts; importing it here
// would pull in the Redux store, whose dependencies other test files mock process-wide.
test('VIA replies: protocol, keymap, macros and keylights', () => {
  const state = defaultEmulatedState();
  const ask = (...bytes: number[]) => Array.from(emulatedReply(state, new Uint8Array(bytes)).reply!);
  expect(ask(0x01).slice(0, 3)).toEqual([0x01, 0, 12]);
  expect(ask(0x11).slice(0, 2)).toEqual([0x11, 4]);
  expect(ask(0x04, 0, 0, 0).slice(0, 6)).toEqual([0x04, 0, 0, 0, 0x00, 0x29]); // Esc
  ask(0x05, 1, 2, 3, 0x00, 0x04);
  expect(ask(0x04, 1, 2, 3).slice(4, 6)).toEqual([0x00, 0x04]);
  expect(ask(0x12, 0, 0, 4).slice(4, 8)).toEqual([0x00, 0x29, 0x00, 0x27]); // Esc, 0
  ask(0x13, 0, 2, 2, 0x00, 0x05);
  expect(state.keymap[1]).toBe(0x05);
  expect(ask(0x0c)[1]).toBe(16);
  expect(ask(0x0d).slice(1, 3)).toEqual([0x04, 0x00]);
  ask(0x0f, 0, 10, 3, 1, 2, 3);
  expect(ask(0x0e, 0, 10, 3).slice(4, 7)).toEqual([1, 2, 3]);
  ask(0x07, 3, 1, 99);
  expect(ask(0x08, 3, 1)[3]).toBe(99);
  ask(0x07, 3, 4, 12, 34);
  expect(ask(0x08, 3, 4).slice(3, 5)).toEqual([12, 34]);
  expect(ask(0x02, 0x03).slice(2).every(byte => byte === 0)).toBe(true); // no keys held
});

test('every key in the bundled Module layout has a default keycode', () => {
  const state = defaultEmulatedState();
  const positions = [...JSON.stringify(definition.layouts.keymap).matchAll(/"(\d),(\d)/g)];
  expect(positions.length).toBeGreaterThan(60);
  for (const [, row, col] of positions) expect(state.keymap[Number(row) * 8 + Number(col)]).not.toBe(0);
});

test('bootloader jump is ignored and unknown commands are refused', () => {
  const state = defaultEmulatedState();
  expect(emulatedReply(state, new Uint8Array([0x0b])).reply).toBeNull();
  expect(emulatedReply(state, new Uint8Array([0x42])).reply![0]).toBe(0xff);
  const toffee = emulatedReply(state, new Uint8Array([0x09, 0x50, 1, 0, 0, 0])).reply!;
  expect([toffee[0], toffee[26], toffee[27], toffee[28]]).toEqual([0xef, 0xa5, 0x50, 1]);
});

test('firmware updates and Lighting Debug measurements refuse the emulated board', async () => {
  connectEmulatedBoard();
  const [device] = await navigator.hid.getDevices();
  await expect(chooseModule()).rejects.toThrow('real Module');
  await expect(debugCommand(new ToffeeHIDDevice(device), 0x86)).rejects.toThrow('real Module');
  disconnectEmulatedBoard();
});
