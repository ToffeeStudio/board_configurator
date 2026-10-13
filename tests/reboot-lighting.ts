// Opt-in Module B persistence test. Reflash the same explicit, preserved candidate.
import assert from 'node:assert/strict';
import path from 'node:path';
import {open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';

const [dependencies, locationText, candidate, updater, bootDrive, serial, recoveryDirectory, baselineDirectory, outputFile] = process.argv.slice(2);
if (!dependencies || !locationText || !candidate || !updater || !bootDrive || !serial || !recoveryDirectory || !baselineDirectory || !outputFile)
  throw new Error('Required: NODE_MODULES_DIRECTORY USB_LOCATION UF2 UPDATER_SCRIPT BOOT_DRIVE BOOT_SERIAL RECOVERY_DIRECTORY BASELINE_DIRECTORY NEW_REPORT_JSON.');
assert.equal(Number(locationText), 0x01142000);
const initial = await Bun.file(path.join(baselineDirectory, 'module-1142000-settings.json')).json();
const connect = async () => {
  const board = new NativeHIDDevice(rawPath(Number(locationText), dependencies), dependencies);
  await board.open();
  return {board, api: new ToffeeLightingAPI(new ToffeeHIDDevice(board as unknown as HIDDevice))};
};
const read = async (api: ToffeeLightingAPI) => {
  const state = {rear: await api.getLightingState(), front: await api.getFrontState(),
    badge: await api.getBadgeState(), keys: [] as {index: number; brightness: number}[]};
  for (const key of map.front) state.keys.push({index: key.index, brightness: await api.getLedBrightness(key.index)});
  return state;
};
const set = async (api: ToffeeLightingAPI, state: Awaited<ReturnType<typeof read>>) => {
  await api.setAnimation(state.rear.effect); await api.setSpeed(state.rear.speed);
  await api.setBrightness(state.rear.brightness); await api.setColor(state.rear.hue, state.rear.saturation);
  await api.setFrontState(state.front); await api.setBadgeState(state.badge);
  for (const key of state.keys) await api.setLedBrightness(key.index, key.brightness);
  await Bun.sleep(1400);
};
const flash = async () => {
  const {stdout} = await promisify(execFile)('/Users/ethanhan/.pyenv/shims/python3', [updater, candidate,
    '--boot-drive', bootDrive, '--bootloader-serial', serial, '--usb-location', locationText,
    '--recovery-dir', recoveryDirectory, '--start-mode', 'application'], {timeout: 90000});
  console.log(stdout.trim());
  return stdout.trim().split('\n').find(line => line.startsWith('Flash report: '))!.slice('Flash report: '.length);
};
let {board, api} = await connect();
const before = await read(api);
assert.deepEqual(await board.readSettings(), initial);
const test = {rear: {effect: 0, speed: 123, brightness: 11, hue: 0, saturation: 255},
  front: {effect: 1, speed: 111, brightness: 14, hue: 85, saturation: 255},
  badge: {enabled: false, brightness: 6, hue: 210, saturation: 255},
  keys: before.keys.map(key => ({...key, brightness: key.index === 91 ? 123 : key.index === 31 ? 0 : key.brightness}))};
const reports: string[] = [];
await set(api, test);
assert.deepEqual(await read(api), test);
await board.close();
reports.push(await flash());
({board, api} = await connect());
// No setters before this assertion: defaults cannot impersonate these saved values.
assert.deepEqual(await read(api), test);
assert.deepEqual(await board.readSettings(), initial);
console.log('PERSISTENCE PASS: distinctive rear/front/badge and all 66 key settings restored after reboot.');
await set(api, before);
await board.close();
reports.push(await flash());
({board, api} = await connect());
const final = await read(api);
assert.deepEqual(final, before);
assert.deepEqual(await board.readSettings(), initial);
await board.close();
const other = new NativeHIDDevice(rawPath(0x02140000, dependencies), dependencies);
await other.open();
assert.deepEqual(await other.readSettings(), await Bun.file(path.join(baselineDirectory, 'module-2140000-settings.json')).json());
await other.close();
const output = await open(outputFile, 'wx', 0o644);
try {await output.writeFile(JSON.stringify({date: new Date().toISOString(), target: locationText,
  method: 'two validated copies of the same UF2; saved-value and original-state reboot checks',
  before, test, final, flash_reports: reports, other_board_settings_unchanged: true,
  physical_unplug_replug_confirmation: 'pending'}, null, 2) + '\n');} finally {await output.close();}
console.log('REBOOT PASS: saved values survive startup; original user state restored and reboot-verified; Module A unchanged.');
