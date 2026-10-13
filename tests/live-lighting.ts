// Opt-in real hardware tests. Writes only the explicitly confirmed exposed Module B.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CommandID, ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';

const [dependencies, locationText, action, outputFile, baselineDirectory] = process.argv.slice(2);
if (!dependencies || !locationText || !action || !outputFile || !baselineDirectory)
  throw new Error('Required: NODE_MODULES_DIRECTORY USB_LOCATION exercise|read REPORT_JSON BASELINE_DIRECTORY.');
const location = Number(locationText);
assert.equal(location, 0x01142000, 'Only exposed Module B is authorised for lighting writes.');
assert.ok(action === 'exercise' || action === 'read');
const board = new NativeHIDDevice(rawPath(location, dependencies), dependencies);
await board.open();
const hid = new ToffeeHIDDevice(board as unknown as HIDDevice);
const api = new ToffeeLightingAPI(hid);
const second = new ToffeeLightingAPI(new ToffeeHIDDevice(board as unknown as HIDDevice));
let checks = 0;
const equal = (actual: unknown, expected: unknown) => {assert.deepEqual(actual, expected); checks++;};
const started = new Date().toISOString();
const hash = (hex: string) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
try {
  await api.getCapabilities(); checks++;
  const initial = {rear: await api.getLightingState(), front: await api.getFrontState(),
    badge: await api.getBadgeState(), keys: [] as {index: number; brightness: number}[]};
  for (const key of map.front) initial.keys.push({index: key.index, brightness: await api.getLedBrightness(key.index)});
  const settings = await board.readSettings();
  const baselineB = await Bun.file(path.join(baselineDirectory, 'module-1142000-settings.json')).json();
  equal(settings, baselineB);
  if (action === 'exercise') {
    // Keep current low. Exercise full-range global values with front masked/badge off.
    await api.setBadgeState({...initial.badge, enabled: false});
    for (const key of map.front) await api.setLedBrightness(key.index, 0);
    for (let effect = 0; effect < 9; effect++) {
      const state = {effect, speed: 255 - effect, brightness: 255, hue: effect * 30, saturation: 255};
      await api.setFrontState(state); equal(await api.getFrontState(), state);
      equal(await api.getBadgeState(), {...initial.badge, enabled: false});
      equal(await api.getLightingState(), initial.rear);
    }
    await api.setFrontState({...initial.front, effect: 0});
    for (const brightness of [0, 1, 127, 254, 255]) {
      const state = {enabled: false, brightness, hue: 255, saturation: 0};
      await api.setBadgeState(state); equal(await api.getBadgeState(), state);
    }
    for (let effect = 0; effect < 10; effect++) {
      await api.setAnimation(effect);
      await api.setSpeed(effect % 2 ? 0 : 255);
      await api.setColor(effect * 25, effect % 2 ? 0 : 255);
      await api.setBrightness(18);
      equal(await api.getLightingState(), {effect, speed: effect % 2 ? 0 : 255,
        brightness: 18, hue: effect * 25, saturation: effect % 2 ? 0 : 255});
    }
    await api.setAnimation(0); await api.setColor(170, 255);
    for (const brightness of [0, 1, 127, 254, 255]) {
      await api.setBrightness(brightness); equal((await api.getLightingState()).brightness, brightness);
    }
    await api.setBrightness(18);
    await api.setFrontState({...initial.front, effect: 1, brightness: 18, hue: 0, saturation: 255});
    for (const key of map.front) {
      for (const value of [0, 1, 17, 127, 254, 255]) {
        await api.setLedBrightness(key.index, value); equal(await api.getLedBrightness(key.index), value);
      }
    }
    // Firmware boundary rejects badge/rear/unmapped indices, not just the JS API.
    for (const index of [1, 33, 65, 80, 104, 200, 255]) {
      equal((await hid.executeCommand(CommandID.MODULE_CMD_SET_LED_BRIGHTNESS, new Uint8Array([index, 18])))[0], 0xef);
      equal((await hid.executeCommand(CommandID.MODULE_CMD_LED_GET, new Uint8Array([index])))[0], 0xef);
    }
    equal((await hid.executeCommand(CommandID.MODULE_CMD_FRONT_SET, new Uint8Array([9, 100, 18, 0, 0])))[0], 0xef);
    equal((await hid.executeCommand(CommandID.MODULE_CMD_BADGE_SET, new Uint8Array([2, 18, 0, 0])))[0], 0xef);
    equal((await hid.executeCommand(CommandID.MODULE_CMD_SET_ANIMATION, new Uint8Array([255])))[0], 0xef);
    equal((await hid.executeCommand(CommandID.MODULE_CMD_LS))[0], 0xef);
    equal((await hid.executeCommand(CommandID.MODULE_CMD_FORMAT_FILESYSTEM))[0], 0xef);
    await Promise.all(Array.from({length: 200}, (_, i) => (i % 2 ? api : second).setSpeed(i)));
    equal((await api.getLightingState()).speed, 199);
    // Restore the initial startup state/overrides after testing, not arbitrary test colours.
    await api.setAnimation(initial.rear.effect); await api.setSpeed(initial.rear.speed);
    await api.setBrightness(initial.rear.brightness); await api.setColor(initial.rear.hue, initial.rear.saturation);
    await api.setFrontState(initial.front); await api.setBadgeState(initial.badge);
    for (const key of initial.keys) await api.setLedBrightness(key.index, key.brightness);
    await Bun.sleep(1300);
    equal(await api.getLightingState(), initial.rear);
    equal(await api.getFrontState(), initial.front); equal(await api.getBadgeState(), initial.badge);
    equal(await board.readSettings(), baselineB);
  }
  const other = new NativeHIDDevice(rawPath(0x02140000, dependencies), dependencies);
  await other.open();
  try {
    const currentA = await other.readSettings();
    equal(currentA, await Bun.file(path.join(baselineDirectory, 'module-2140000-settings.json')).json());
  } finally {await other.close();}
  const report = {started, finished: new Date().toISOString(), action, location: locationText,
    path: rawPath(location, dependencies), checks, initial,
    final: {rear: await api.getLightingState(), front: await api.getFrontState(), badge: await api.getBadgeState()},
    keymap_sha256: hash(settings.keymap), macro_sha256: hash(settings.macros),
    other_board_settings_unchanged: true, physical_typing_confirmation: 'pending'};
  const output = await open(outputFile, 'wx', 0o644);
  try {await output.writeFile(JSON.stringify(report, null, 2) + '\n'); await output.sync();}
  finally {await output.close();}
  console.log(`LIVE PASS: ${checks} checks; Module B lighting API, VIA preservation and untouched Module A; report ${outputFile}`);
} finally {await hid.close();}
