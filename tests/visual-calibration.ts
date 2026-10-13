// Hardware controller with HUMAN/AGENT VIEWED meter readings only. No OCR.
import assert from 'node:assert/strict';
import {mkdir, open} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';
import {rawPattern, visualReading, calibrationStatus, finalSums, requestedSums, checkOutput} from './visual-measurement';

const [dependencies, location, build, cameraUrl, outputDirectory] = process.argv.slice(2);
if (!dependencies || !location || !build || !cameraUrl || !outputDirectory)
  throw new Error('Required: NODE_MODULES USB_LOCATION TEST_BUILD CAMERA_URL NEW_OUTPUT_DIRECTORY.');
assert.equal(new URL(cameraUrl).hostname, '127.0.0.1');
assert.ok(Number.isInteger(Number(location)) && Number(location) > 0);
assert.ok(Number.isInteger(Number(build)) && Number(build) > 0);
await mkdir(outputDirectory);
const events = await open(path.join(outputDirectory, 'events.jsonl'), 'wx');
let queue = Promise.resolve();
const log = (value: object) => {
  queue = queue.then(async () => {await events.write(JSON.stringify({time: new Date().toISOString(), ...value}) + '\n');});
  return queue;
};
const native = new NativeHIDDevice(rawPath(Number(location), dependencies), dependencies);
const hid = new ToffeeHIDDevice(native as unknown as HIDDevice), api = new ToffeeLightingAPI(hid);
const input = createInterface({input: process.stdin});
let confirmed = false, running = false, active = false, fault: Error | null = null;
let heartbeat = Promise.resolve(), uptime = 0, previousFrame = -1, serial = 0;
let cameraPid = '', name = 'off', patternAt = 0, lastViewed = 0;
let pending: any = null;
let requested = [[0,0,0],[0,0,0],[0,0,0]];
const command = async (code: number, payload = new Uint8Array()) => {
  const [status, bytes] = await hid.executeCommand(code as CommandID, payload);
  await log({event: 'command', code, payload: [...payload], status, data: [...bytes]});
  assert.equal(status, 0, `HID ${code.toString(16)} rejected`);
  return bytes;
};
const off = async () => {active = false; requested = [[0,0,0],[0,0,0],[0,0,0]]; await command(0x7c, new Uint8Array([255,255,255,255,255]));};
const state = async () => {
  const test = calibrationStatus(await command(0x86), Number(build));
  assert.ok(test.uptime >= uptime, 'Unexpected board reboot'); uptime = test.uptime;
  const power = await api.getPowerStatus();
  assert.ok(power.configured && power.frameValid && power.ageMs < 500);
  assert.equal(power.modelRevision, 0x8005);
  assert.equal(power.boardLimitMa, 1100);
  assert.equal(power.ledBudgetMa, 920);
  return {test, power, sums: finalSums(await command(0x89))};
};
const capture = async () => {
  assert.equal(pending, null, 'View and record the preceding frame first.');
  const telemetry = await state();
  if (active) assert.ok(telemetry.test.active && !telemetry.test.expired, 'Test pattern expired');
  assert.equal(telemetry.power.limited, false, 'Calibration output must not be dimmed.');
  checkOutput(requested, telemetry.sums.groups, false);
  const response = await fetch(`${cameraUrl}/frame.jpg`, {signal: AbortSignal.timeout(7000)});
  assert.ok(response.ok, 'Camera frame unavailable');
  assert.equal(response.headers.get('x-camera-pid'), cameraPid, 'Camera owner changed');
  const frame = Number(response.headers.get('x-frame-number'));
  assert.ok(Number.isInteger(frame) && frame > previousFrame, 'Non-advancing camera frame');
  previousFrame = frame;
  const image = path.join(outputDirectory, `${String(++serial).padStart(3, '0')}-${name}.jpg`);
  const file = await open(image, 'wx');
  try {await file.writeFile(Buffer.from(await response.arrayBuffer()));} finally {await file.close();}
  pending = {event: 'frame', frame, image, name, capturedAt: Date.now(), heldMs: Date.now() - patternAt, ...telemetry};
  if (active) {
    await off();
    await Bun.sleep(50);
    const dark = await state();
    assert.equal(dark.test.active, false, 'Controller must be off before image review.');
    checkOutput([[0,0,0],[0,0,0],[0,0,0]], dark.sums.groups, false);
    await log({event: 'review-blackout', cameraFrame: frame, sums: dark.sums});
  }
  pending.reviewWhileDark = true;
  await log(pending);
  console.log('VIEW IMAGE THEN SUBMIT reading:', JSON.stringify(pending));
};
process.on('SIGINT', () => {fault = new Error('Interrupted'); input.close();});
process.on('SIGTERM', () => {fault = new Error('Interrupted'); input.close();});
try {
  await native.open(); await state(); confirmed = true;
  await off(); patternAt = Date.now();
  const camera = await (await fetch(`${cameraUrl}/status`, {signal: AbortSignal.timeout(3000)})).json();
  assert.ok(camera.ready && camera.alive && !camera.error);
  cameraPid = String(camera.helperPid);
  await log({event: 'start', location, build, camera, method: 'explicit image viewing, no OCR'});
  running = true;
  heartbeat = (async () => {
    while (running) {
      if (active) {
        assert.ok(Date.now() - patternAt < 45000, 'Test pulse exceeded its 45-second deadline.');
        await command(0x87);
      }
      await Bun.sleep(1000);
    }
  })().catch(async error => {fault = error; running = false; await off().catch(() => {}); input.close();});
  await capture();
  for await (const line of input) {
    if (fault) throw fault;
    const request = JSON.parse(line);
    if (request.type === 'reading') {
      assert.ok(pending && request.frame === pending.frame, 'Reading must identify the displayed pending frame.');
      assert.equal(active, false, 'Review requires LEDs off.');
      assert.ok(Date.now() - pending.capturedAt < 600000, 'Captured sample is older than ten minutes.');
      await log({event: 'visual-reading', cameraFrame: pending.frame, name: pending.name, image: pending.image,
        currentMa: request.currentMa, voltage: request.voltage, heldMs: pending.heldMs, output: pending.sums,
        capturedAt: pending.capturedAt, reviewDelayMs: Date.now() - pending.capturedAt, reviewWhileDark: true});
      visualReading(request.currentMa, request.voltage);
      lastViewed = Date.now(); pending = null;
      console.log('RECORDED visually read meter:', request.currentMa, 'mA', request.voltage, 'V');
    } else if (request.type === 'pattern') {
      assert.equal(pending, null);
      assert.ok(Date.now() - lastViewed < 60000, 'Read a fresh meter image before setting a pattern.');
      assert.match(request.name, /^[a-z0-9-]+$/);
      assert.ok(Number.isInteger(request.holdMs) && request.holdMs >= 5000 && request.holdMs <= 30000,
        'Required holdMs: 5000–30000.');
      const payload = rawPattern(request.indices, request.rgb);
      const camera = await (await fetch(`${cameraUrl}/status`, {signal: AbortSignal.timeout(3000)})).json();
      assert.ok(camera.ready && camera.alive && !camera.error);
      assert.equal(String(camera.helperPid), cameraPid, 'Camera owner changed');
      const before = await state();
      assert.equal(before.test.active, false, 'Another controller activated the board.');
      checkOutput([[0,0,0],[0,0,0],[0,0,0]], before.sums.groups, false);
      await off(); await command(0x8a, payload);
      requested = requestedSums(request.indices, request.rgb);
      active = true; name = request.name; patternAt = Date.now();
      await log({event: 'pattern', name, indices: request.indices, rgb: request.rgb, holdMs: request.holdMs});
      await Bun.sleep(request.holdMs); await capture();
    } else if (request.type === 'capture') {
      assert.ok(Number.isInteger(request.waitMs) && request.waitMs >= 0 && request.waitMs <= 15000);
      name = 'off'; patternAt = Date.now();
      await Bun.sleep(request.waitMs); await capture();
    } else if (request.type === 'off') {
      await off(); name = 'off'; patternAt = Date.now(); pending = null;
      await Bun.sleep(5000); await capture();
    } else if (request.type === 'quit') break;
    else throw new Error('Required type: reading, pattern, capture, off or quit.');
  }
  if (fault) throw fault;
} catch (error) {
  await log({event: 'failure', message: String(error)}); throw error;
} finally {
  running = false;
  if (confirmed && native.opened) await off().catch(error => console.error('All-off unconfirmed; watchdog must expire.', error));
  await heartbeat;
  if (native.opened) await native.close();
  input.close(); await queue; await events.close();
  console.log('Controller closed. No saved lighting changed.');
}
