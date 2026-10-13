// Read-only after a documented protected-firmware reboot. Never print private VIA data.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {open} from 'node:fs/promises';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';
import {calibrationStatus, finalSums} from './visual-measurement';
import map from '../src/utils/toffee_studio/lighting-map.json';

const [dependencies, location, build, baselineFile, reportFile] = process.argv.slice(2);
if (!dependencies || !location || !build || !baselineFile || !reportFile)
  throw new Error('Required: NODE_MODULES USB_LOCATION TEST_BUILD PRIVATE_BASELINE NEW_REPORT_JSON.');
assert.ok(Number.isInteger(Number(location)) && Number(location) > 0);
assert.ok(Number.isInteger(Number(build)) && Number(build) > 0);
const baseline = await Bun.file(baselineFile).json();
const board = new NativeHIDDevice(rawPath(Number(location), dependencies), dependencies);
await board.open();
try {
  const hid = new ToffeeHIDDevice(board as unknown as HIDDevice);
  const api = new ToffeeLightingAPI(hid);
  const readCommand = async (code: number) => {
    const [status, bytes] = await hid.executeCommand(code as CommandID, new Uint8Array());
    assert.equal(status, 0); return bytes;
  };
  const test = calibrationStatus(await readCommand(0x86), Number(build));
  assert.equal(test.active, false);
  const sums = finalSums(await readCommand(0x89));
  assert.deepEqual(sums.groups, [[0,0,0],[0,0,0],[0,0,0]]);
  const lighting = {front: await api.getFrontState(), rear: await api.getLightingState(),
    badge: await api.getBadgeState(), overrides: [] as {index: number; brightness: number}[]};
  for (const key of map.front)
    lighting.overrides.push({index: key.index, brightness: await api.getLedBrightness(key.index)});
  assert.ok(isDeepStrictEqual(lighting, baseline.lighting), 'Saved lighting or overrides differ from private baseline.');
  assert.ok(isDeepStrictEqual(await board.readSettings(), baseline.settings), 'VIA data differs from private baseline.');
  const power = await api.getPowerStatus();
  assert.equal(power.modelRevision, 0x8005);
  assert.equal(power.effectiveLedMa, 0);
  const report = await open(reportFile, 'wx');
  try {
    await report.writeFile(JSON.stringify({date: new Date().toISOString(), location, test, sums,
      lightingAnd66OverridesMatch: true, viaKeymapMacrosLayoutMatch: true,
      method: 'read-only after same-UF2 reboot; no lighting setters',
      coldPowerAndPhysicalTyping: 'not verified'}, null, 2) + '\n');
  } finally {await report.close();}
  console.log('PASS: saved lighting, all 66 overrides and private VIA data unchanged; final output zero.');
} finally {await board.close();}
