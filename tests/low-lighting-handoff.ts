// Opt-in hardware handoff: zero saved output first, then low existing colours/effects.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';

const [dependencies, location, brightnessText, reportPath] = process.argv.slice(2);
if (!dependencies || !location || !brightnessText || !reportPath)
  throw new Error('Required: NODE_MODULES USB_LOCATION BRIGHTNESS REPORT_JSON.');
const brightness = Number(brightnessText);
assert.ok(Number.isInteger(brightness) && brightness > 0 && brightness <= 8);
const board = new NativeHIDDevice(rawPath(Number(location), dependencies), dependencies);
await board.open();
const hid = new ToffeeHIDDevice(board as unknown as HIDDevice);
const api = new ToffeeLightingAPI(hid);
const zero = async () => {
  const [status, data] = await hid.executeCommand(0x8b as CommandID, new TextEncoder().encode('ZERO'));
  assert.equal(status, 0);
  assert.deepEqual([...data.slice(0, 5)], [1, 7, 0, 0, 0]);
};
try {
  await zero();
  const front = await api.getFrontState();
  const badge = await api.getBadgeState();
  await api.setFrontState({...front, brightness});
  await api.setBadgeState({...badge, brightness});
  await api.setBrightness(brightness);
  await Bun.sleep(2500); // Firmware debounce is one second; no controller keepalive.
  const state = {front: await api.getFrontState(), rear: await api.getLightingState(), badge: await api.getBadgeState()};
  for (const group of Object.values(state)) assert.equal(group.brightness, brightness);
  const power = await api.getPowerStatus();
  assert.equal(power.modelRevision, 4);
  assert.ok(power.effectiveLedMa < 160);
  const file = await open(reportPath, 'wx', 0o600);
  try {await file.writeFile(JSON.stringify({date: new Date().toISOString(), state, power,
    save: 'normal firmware debounce elapsed; physical restart not tested'}, null, 2));}
  finally {await file.close();}
  console.log(`All groups set to ${brightness}/255; auto-save interval elapsed. LED estimate ${power.effectiveLedMa} mA.`);
} catch (error) {
  await zero();
  throw error;
} finally {await board.close();}
