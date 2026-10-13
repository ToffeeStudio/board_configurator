// Explicit-target, opt-in hardware campaign; shared camera HTTP, never a camera owner.
import assert from 'node:assert/strict';
import {open, mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';
import {parseTestStatus} from './extensive-plan';
import {readMeter, checkMeter, parseRgbSums} from './meter-reading';

const [dependencies, locationText, action, buildText, cameraURL, ocrTool, outputDirectory] = process.argv.slice(2);
if (!dependencies || !locationText || !['snapshot', 'sweep'].includes(action) || !buildText || !cameraURL || !ocrTool || !outputDirectory)
  throw new Error('Required: NODE_MODULES USB_LOCATION snapshot|sweep TEST_BUILD_ID CAMERA_URL OCR_TOOL NEW_OUTPUT_DIRECTORY.');
assert.ok(Number.isInteger(Number(locationText)) && Number(locationText) > 0);
assert.ok(Number.isInteger(Number(buildText)) && Number(buildText) > 0);
assert.equal(new URL(cameraURL).hostname, '127.0.0.1');
await mkdir(outputDirectory);
const events = await open(path.join(outputDirectory, 'events.jsonl'), 'wx');
let logQueue = Promise.resolve();
const log = (event: object) => {
  const line = JSON.stringify({time: new Date().toISOString(), ...event}) + '\n';
  logQueue = logQueue.then(async () => {await events.write(line);});
  return logQueue;
};
const native = new NativeHIDDevice(rawPath(Number(locationText), dependencies), dependencies);
const hid = new ToffeeHIDDevice(native as unknown as HIDDevice), api = new ToffeeLightingAPI(hid);
const run = promisify(execFile);
let confirmed = false, running = false, failure: Error | null = null;
let heartbeat: Promise<void> = Promise.resolve();
let previousUptime = 0;
let cameraPid = '', previousFrame = -1;
const check = () => {if (failure) throw failure;};
const command = async (code: number, payload: number[] = []) => {
  const [status, data] = await hid.executeCommand(code as CommandID, new Uint8Array(payload));
  await log({event: 'command', code, payload, status, data: [...data]});
  assert.equal(status, 0, `Command ${code.toString(16)} rejected`);
  return data;
};
const off = () => command(0x7c, [255, 255, 255, 255, 255]);
const status = async () => {
  const value = parseTestStatus(await command(0x86), Number(buildText));
  assert.ok(value.uptime >= previousUptime, 'Unexpected firmware reboot');
  previousUptime = value.uptime;
  return value;
};
const interrupted = () => {failure = new Error('Interrupted'); running = false;};
process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
const capture = async (name: string) => {
  const response = await fetch(`${cameraURL}/frame.jpg`, {signal: AbortSignal.timeout(7000)});
  assert.ok(response.ok, 'Fresh camera frame unavailable');
  assert.equal(response.headers.get('x-camera-pid'), cameraPid, 'Camera owner changed');
  const frame = Number(response.headers.get('x-frame-number'));
  assert.ok(Number.isInteger(frame) && frame > previousFrame, 'Stale/missing camera frame');
  previousFrame = frame;
  const image = path.join(outputDirectory, `${name}.jpg`);
  const file = await open(image, 'wx');
  try {await file.writeFile(Buffer.from(await response.arrayBuffer()));} finally {await file.close();}
  const {stdout} = await run(ocrTool, [image, '0.445', '0.27', '0.19', '0.16'], {timeout: 7000});
  const rows = JSON.parse(stdout);
  await log({event: 'ocr', name, rows, frame: response.headers.get('x-frame-number'), cameraPid: response.headers.get('x-camera-pid')});
  const meter = readMeter(rows);
  await log({event: 'meter', name, image, ...meter});
  checkMeter(meter);
  return {image, ...meter};
};
const front = {effect: 1, speed: 100, brightness: 0, hue: 0, saturation: 255};
const badge = {enabled: false, brightness: 0, hue: 0, saturation: 255};
const set = async (group: string, brightness: number, hue: number, saturation: number) => {
  check(); await off();
  await api.setBrightness(0);
  await api.setFrontState({...front, effect: 0});
  await api.setBadgeState(badge);
  await api.setAnimation(0); await api.setSpeed(100); await api.setColor(hue, saturation);
  if (group === 'front' || group === 'all') await api.setFrontState({...front, brightness, hue, saturation});
  if (group === 'rear' || group === 'all') await api.setBrightness(brightness);
  if (group === 'badge' || group === 'all') await api.setBadgeState({enabled: true, brightness, hue, saturation});
};
const sample = async (name: string, expected: object) => {
  check(); const started = performance.now(); await Bun.sleep(1500);
  const measurements = [];
  for (let repetition = 0; performance.now() - started < 30000 || repetition < 6; repetition++) {
    check();
    const firmware = await status(), power = await api.getPowerStatus();
    assert.ok(!firmware.expired && power.configured && power.frameValid && power.ageMs < 500);
    assert.equal(power.modelRevision, 0x8001);
    assert.equal(power.limitPermille, 1000, 'Calibration requires unscaled output');
    const sums = parseRgbSums(await command(0x89));
    const measurement = {...(await capture(`${name}-${repetition}`)), firmware, power, sums};
    measurements.push(measurement);
    await log({event: 'point', name, expected, ...measurement});
    await Bun.sleep(3000);
  }
  await log({event: 'sample', name, expected, holdMs: performance.now() - started, measurements});
  console.log(name, measurements.map(m => `${m.currentMa}mA/${m.power.effectiveLedMa}mA estimated LEDs`).join(', '));
};
try {
  await native.open(); await api.getCapabilities();
  const camera = await (await fetch(`${cameraURL}/status`, {signal: AbortSignal.timeout(3000)})).json();
  assert.ok(camera.ready && camera.alive && !camera.error);
  cameraPid = String(camera.helperPid);
  await log({event: 'start', action, location: locationText, camera});
  if (action === 'snapshot') {
    const settings = await native.readSettings();
    const lighting = {front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState(), overrides: [] as object[]};
    for (const key of map.front) lighting.overrides.push({index: key.index, brightness: await api.getLedBrightness(key.index)});
    const file = await open(path.join(outputDirectory, 'private-settings.json'), 'wx', 0o600);
    try {await file.writeFile(JSON.stringify({settings, lighting}, null, 2));} finally {await file.close();}
    console.log('Read-only saved-state snapshot complete; no setters.');
    for (let i = 0; i < 3; i++) console.log(await capture(`pre-flash-${i}`));
  } else {
    const initial = await status(); confirmed = true;
    assert.equal(initial.cap, 18); await off();
    running = true;
    heartbeat = (async () => {while (running) {await command(0x87); await Bun.sleep(1000);}})()
      .catch(error => {failure = error; running = false;});
    for (const key of map.front) await api.setLedBrightness(key.index, 255);
    await off(); await sample('off-start', {rgb: [0, 0, 0]});
    for (const group of ['front', 'rear', 'badge']) {
      for (const [color, hue, saturation] of [['red', 0, 255], ['green', 85, 255], ['blue', 170, 255], ['white', 0, 0]] as const) {
        for (const brightness of [6, 12, 18]) {
          await set(group, brightness, hue, saturation);
          await sample(`${group}-${color}-${brightness}`, {group, brightness, hue, saturation});
        }
      }
      await off(); await sample(`off-after-${group}`, {rgb: [0, 0, 0]});
    }
    for (const [color, hue, saturation] of [['yellow', 43, 255], ['cyan', 128, 255], ['magenta', 213, 255], ['white', 0, 0]] as const) {
      await set('all', 18, hue, saturation);
      await sample(`all-${color}-18`, {group: 'all', brightness: 18, hue, saturation});
    }
    await off(); await sample('off-end', {rgb: [0, 0, 0]});
  }
} catch (error) {
  await log({event: 'failure', message: String(error)}); throw error;
} finally {
  running = false;
  if (confirmed && native.opened) {try {await off(); console.log('All LEDs blanked; saved lighting unchanged.');} catch (error) {console.error('All-off unconfirmed; watchdog must expire.', error);}}
  await heartbeat;
  if (native.opened) await native.close();
  await logQueue;
  await events.close();
}
