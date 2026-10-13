// Opt-in single-board normal deployment checks; no firmware flashing here.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';
import map from '../src/utils/toffee_studio/lighting-map.json';

const [dependencies, location, action, baselineFile, reportFile] = process.argv.slice(2);
if (!dependencies || !location || !action || !baselineFile || !reportFile)
  throw new Error('Required: NODE_MODULES USB_LOCATION snapshot|verify BASELINE_JSON NEW_REPORT_JSON.');
assert.ok(action === 'snapshot' || action === 'verify');
assert.ok(Number.isInteger(Number(location)) && Number(location) > 0);
const board = new NativeHIDDevice(rawPath(Number(location), dependencies), dependencies);
await board.open();
const hid = new ToffeeHIDDevice(board as unknown as HIDDevice);
const api = new ToffeeLightingAPI(hid);
const state = async () => ({front: await api.getFrontState(), rear: await api.getLightingState(),
  badge: await api.getBadgeState(), overrides: await Promise.all(map.front.map(async key =>
    ({index: key.index, brightness: await api.getLedBrightness(key.index)})))});
const zero = async () => {
  const [status, response] = await hid.executeCommand(0x8b as CommandID, new TextEncoder().encode('ZERO'));
  assert.equal(status, 0, 'Firmware did not verify persistent rescue.');
  assert.deepEqual([...response.slice(0, 5)], [1, 7, 0, 0, 0]);
};
let rescueSupported = false;
try {
  const initial = await state();
  const settings = await board.readSettings();
  let result: object;
  if (action === 'snapshot') {
    result = {date: new Date().toISOString(), location, lighting: initial, settings,
      note: 'Read-only pre-flash RAM state; temporary-firmware preferences may differ from saved startup.'};
  } else {
    const baseline = await Bun.file(baselineFile).json();
    assert.deepEqual(settings, baseline.settings, 'VIA changed during deployment.');
    const power = await api.getPowerStatus();
    assert.equal(power.modelRevision, 4);
    assert.equal(power.configured, true);
    assert.equal(power.boardLimitMa, 900);
    assert.equal(power.ledBudgetMa, 680);
    assert.equal((await hid.executeCommand(0x86 as CommandID, new Uint8Array()))[0], 0xef,
      'Temporary firmware/watchdog is still installed.');
    await zero(); rescueSupported = true;
    const expected = {...initial, front: {...initial.front, brightness: 0},
      rear: {...initial.rear, brightness: 0}, badge: {...initial.badge, brightness: 0}};
    assert.deepEqual(await state(), expected);
    await Bun.sleep(100);
    assert.equal((await api.getPowerStatus()).effectiveLedMa, 0);
    // Small rear-only solid pattern: no test keepalive is ever sent.
    await api.setAnimation(0);
    await api.setBrightness(8);
    await Bun.sleep(8000);
    const held = await api.getPowerStatus();
    assert.ok(held.effectiveLedMa > 0, 'Output did not remain lit beyond the former watchdog.');
    assert.equal((await api.getLightingState()).brightness, 8);
    await api.setBrightness(0);
    await api.setAnimation(initial.rear.effect);
    await Bun.sleep(1300); // Persist restored effect before the zero-only recovery command.
    await zero();
    assert.deepEqual(await state(), expected);
    assert.deepEqual(await board.readSettings(), baseline.settings);
    await Bun.sleep(100);
    const finalPower = await api.getPowerStatus();
    assert.equal(finalPower.effectiveLedMa, 0);
    result = {date: new Date().toISOString(), location, normalFirmware: true,
      testStatusRejected: true, persistentZeroVerified: true, viaUnchanged: true,
      savedNonBrightnessPreferencesPreserved: true, noKeepaliveHoldMs: 8000,
      heldPower: held, finalPower, physicalColdPowerAndTyping: 'not tested'};
    console.log('PASS: normal firmware, output held8s without keepalive, persistent zero verified, saved preferences/VIA preserved.');
  }
  const file = await open(reportFile, 'wx', action === 'snapshot' ? 0o600 : 0o644);
  try {await file.writeFile(JSON.stringify(result, null, 2) + '\n');} finally {await file.close();}
} catch (error) {
  if (rescueSupported) await zero().catch(() => {});
  throw error;
} finally {await board.close();}
