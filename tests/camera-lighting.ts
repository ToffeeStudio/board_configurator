// Opt-in camera evidence through the same JavaScript lighting API as the app.
// Images are unmodified camera frames; the script restores the starting state.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';

const [dependencies, locationText, cameraBinary, frontId, backId, outputDirectory, action] = process.argv.slice(2);
if (!dependencies || !locationText || !cameraBinary || !frontId || !backId || !outputDirectory || !action)
  throw new Error('Required: NODE_MODULES_DIRECTORY USB_LOCATION CAMERA_BINARY FRONT_CAMERA_ID BACK_CAMERA_ID NEW_OUTPUT_DIRECTORY groups|keys.');
assert.equal(Number(locationText), 0x01142000);
assert.ok(action === 'groups' || action === 'keys');
await mkdir(outputDirectory); // An existing destination is a conflict, not an overwrite.
const board = new NativeHIDDevice(rawPath(Number(locationText), dependencies), dependencies);
await board.open();
const api = new ToffeeLightingAPI(new ToffeeHIDDevice(board as unknown as HIDDevice));
const before = {rear: await api.getLightingState(), front: await api.getFrontState(),
  badge: await api.getBadgeState(), keys: [] as {index: number; brightness: number}[]};
for (const key of map.front) before.keys.push({index: key.index, brightness: await api.getLedBrightness(key.index)});
const camera = promisify(execFile);
const evidence: object[] = [];
const capture = async (name: string, side: 'front' | 'back') => {
  const file = path.join(outputDirectory, `${name}-${side}.png`);
  const {stdout} = await camera(cameraBinary, [side === 'front' ? frontId : backId, file], {timeout: 25000});
  console.log(stdout.trim());
  return path.basename(file);
};
const capturePair = async (name: string) => {
  const images = await Promise.all([capture(name, 'front'), capture(name, 'back')]);
  evidence.push({name, images, rear: await api.getLightingState(), front: await api.getFrontState(), badge: await api.getBadgeState()});
};
const redFront = {effect: 1, speed: 100, brightness: 18, hue: 0, saturation: 255};
const greenBadge = {enabled: true, brightness: 4, hue: 85, saturation: 255};
try {
  await api.setAnimation(0); await api.setSpeed(100); await api.setColor(170, 255);
  await api.setBrightness(0); await api.setFrontState({...redFront, effect: 0});
  await api.setBadgeState({...greenBadge, enabled: false});
  if (action === 'groups') {
    for (const key of map.front) await api.setLedBrightness(key.index, 255);
    await capturePair('all-off');
    await api.setFrontState(redFront); await capturePair('front-only-red');
    await api.setFrontState({...redFront, effect: 0});
    await api.setBadgeState(greenBadge); await capturePair('badge-only-green');
    await api.setBadgeState({...greenBadge, enabled: false});
    await api.setBrightness(18); await capturePair('rear-only-blue');
    await api.setFrontState(redFront); await api.setBadgeState(greenBadge);
    await capturePair('independent-red-green-blue');
    await api.setBadgeState({...greenBadge, enabled: false}); await capturePair('badge-disabled');
    await api.setBadgeState(greenBadge); await api.setFrontState({...redFront, effect: 0});
    await capturePair('front-disabled');
    await api.setFrontState(redFront); await api.setBrightness(0); await capturePair('rear-disabled');
  } else {
    for (const key of map.front) await api.setLedBrightness(key.index, 0);
    await api.setFrontState(redFront);
    await capture('keys-off', 'front');
    for (const key of map.front) {
      await api.setLedBrightness(key.index, 255);
      assert.equal(await api.getLedBrightness(key.index), 255);
      const image = await capture(`key-${String(key.index).padStart(3, '0')}`, 'front');
      evidence.push({index: key.index, label: key.label, image,
        expected: key.index === 103 ? 'dark: user-confirmed broken physical repair; retain index' : 'one front package emits red'});
      await api.setLedBrightness(key.index, 0);
    }
  }
} finally {
  await api.setAnimation(before.rear.effect); await api.setSpeed(before.rear.speed);
  await api.setBrightness(before.rear.brightness); await api.setColor(before.rear.hue, before.rear.saturation);
  await api.setFrontState(before.front); await api.setBadgeState(before.badge);
  for (const key of before.keys) await api.setLedBrightness(key.index, key.brightness);
  await Bun.sleep(1300);
  assert.deepEqual(await api.getLightingState(), before.rear);
  assert.deepEqual(await api.getFrontState(), before.front);
  assert.deepEqual(await api.getBadgeState(), before.badge);
  await board.close();
}
const report = {date: new Date().toISOString(), target: locationText, action, before, evidence,
  starting_state_restored: true, physical_inspection: 'pending; command acceptance is not visual success'};
const output = await open(path.join(outputDirectory, 'manifest.json'), 'wx', 0o644);
try {await output.writeFile(JSON.stringify(report, null, 2) + '\n');} finally {await output.close();}
console.log(`CAMERA CAPTURE COMPLETE: ${evidence.length} cases; starting lighting restored.`);
