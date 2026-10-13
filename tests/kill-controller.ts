// Disposable controller for the explicit process-kill watchdog test only.
import assert from 'node:assert/strict';
import {CommandID, ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {parseTestStatus} from './extensive-plan';

const [dependencies, location, build] = process.argv.slice(2);
if (!dependencies || !location || !build) throw new Error('Required: NODE_MODULES USB_LOCATION EXPECTED_TEST_BUILD_ID.');
assert.equal(Number(location), 0x01142000);
const native = new NativeHIDDevice(rawPath(Number(location), dependencies), dependencies);
const hid = new ToffeeHIDDevice(native as unknown as HIDDevice);
await native.open(); await new ToffeeLightingAPI(hid).getCapabilities();
const [status, payload] = await hid.executeCommand(0x86 as CommandID, new Uint8Array());
assert.equal(status, 0); parseTestStatus(payload, Number(build));
const [armed] = await hid.executeCommand(0x7c as CommandID, new Uint8Array([0, 255, 255, 255, 255]));
assert.equal(armed, 0);
console.log('CONTROLLER_ARMED_LED_0');
// Deliberately no cleanup handler: the supervisor kills this exact child with
// SIGKILL, so only the MCU watchdog can blank the held pattern afterwards.
while (true) {
  await Bun.sleep(1000);
  const [result] = await hid.executeCommand(0x87 as CommandID, new Uint8Array());
  assert.equal(result, 0);
}
