// Visible isolated Chrome against the actual app and protected calibration PCB.
// Native JS bridge; no personal browser profile, desktop clicks or macros printed.
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {ToffeeHIDDevice, ToffeeLightingAPI, CommandID} from '../src/utils/toffee_studio/hid';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';
import {calibrationStatus, finalSums} from './visual-measurement';

const [dependencies, locationText, baseUrl, outputFile, testBuild] = process.argv.slice(2);
if (!dependencies || !locationText || !baseUrl || !outputFile || !testBuild)
  throw new Error('Required: NODE_MODULES_DIRECTORY USB_LOCATION LOCAL_APP_URL REPORT_JSON TEST_BUILD.');
assert.ok(Number.isInteger(Number(locationText)) && Number(locationText) > 0);
assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const board = new NativeHIDDevice(rawPath(Number(locationText), dependencies), dependencies);
await board.open();
const hid = new ToffeeHIDDevice(board as unknown as HIDDevice);
const api = new ToffeeLightingAPI(hid);
const command = async (code: number, payload = new Uint8Array()) => {
  const [status, data] = await hid.executeCommand(code as CommandID, payload);
  assert.equal(status, 0); return data;
};
calibrationStatus(await command(0x86), Number(testBuild));
const initialPower = await api.getPowerStatus();
assert.ok(initialPower.configured && initialPower.modelRevision === 0x8002 && initialPower.boardLimitMa === 450);
await command(0x7c, new Uint8Array([255,255,255,255,255]));
const before = {rear: await api.getLightingState(), front: await api.getFrontState(),
  badge: await api.getBadgeState(), esc: await api.getLedBrightness(91), space: await api.getLedBrightness(10)};
assert.ok(before.rear.brightness <= 18 && before.front.brightness <= 18 && before.badge.brightness <= 18,
  'This test requires the already-established low-brightness fixture.');
const browser = await chromium.launch({headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
page.setDefaultTimeout(15000);
const errors: string[] = [];
const results: string[] = [];
const traffic: string[] = [];
const readbacks: unknown[] = [];
const lifecycle: string[] = [];
page.on('framenavigated', (frame: any) => {if (frame === page.mainFrame()) {lifecycle.push(`navigate ${frame.url()}`); console.log(lifecycle.at(-1));}});
page.on('console', (message: any) => {
  const text = message.text();
  if (/^\[vite\]|^Keyboard definitions ready|^Setting connected device|^Clearing retries|^Hard resetting device store|^Underglow:/.test(text)) {
    lifecycle.push(text); console.log('APP:', text);
  }
});
const expected = structuredClone(before);
let pending = 0;
let maximumPending = 0;
let lastTrafficAt = Date.now();
const deliveries = new Set<Promise<void>>();
const bridgeErrors: string[] = [];
let available = true;
let forbiddenWrites = 0;
const counts: Record<string, number> = {};
const bounds = {rear: 0, front: 0, badge: 0};
page.on('pageerror', (error: Error) => errors.push(error.message));
let rejectCommand: number | null = null;
let relay = true;
const receive = (bytes: number[]) => page.evaluate((packet: number[]) => {
  const device = (window as any).__module;
  const event = new Event('inputreport');
  Object.assign(event, {device, reportId: 0, data: new DataView(new Uint8Array(packet).buffer)});
  device.dispatchEvent(event);
}, bytes);
board.addEventListener('inputreport', event => {
  lastTrafficAt = Date.now();
  if (relay) {
    const data = (event as HIDInputReportEvent).data;
    traffic.push(`RX ${data.getUint8(0).toString(16)}`);
    const delivery = receive(Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)))
      .catch((error: Error) => {bridgeErrors.push(error.message); console.error('Bridge:', error.message);})
      .finally(() => deliveries.delete(delivery));
    deliveries.add(delivery);
  }
});
await page.exposeFunction('__moduleSend', async (packet: number[]) => {
  lastTrafficAt = Date.now();
  traffic.push(`TX ${packet[0].toString(16)}${packet[0] === 9 ? ':' + packet[1].toString(16) : ''}`);
  if (packet[0] === 9 && packet[1] === rejectCommand) {
    rejectCommand = null;
    const response = new Uint8Array(32);
    response[0] = 0xef; response[26] = 0xa5; response[27] = packet[1];
    response.set(packet.slice(2, 6), 28);
    await receive(Array.from(response));
  } else {
    // Fail closed at the hardware boundary: no flash, keymap/macro write,
    // diagnostic LED override, or high-brightness command can reach the PCB.
    const command = packet[1];
    const allowed = packet[0] === 9
      ? [0x71, 0x72, 0x74, 0x75, 0x76, 0x7b, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x87, 0x88].includes(command)
        && (command !== 0x74 || packet[6] <= 150)
        && (command !== 0x81 || packet[8] <= 150)
        && (command !== 0x83 || packet[7] <= 150)
        && (command !== 0x7b || packet[6] === 91)
      : [1, 2, 4, 8, 0x0c, 0x0d, 0x0e, 0x11, 0x12, 0x14].includes(packet[0]);
    if (!allowed) {forbiddenWrites++; throw new Error('Browser test rejected an out-of-scope HID command.');}
    const key = packet[0] === 9 ? `lighting-${command.toString(16)}` : `via-${packet[0].toString(16)}`;
    counts[key] = (counts[key] || 0) + 1;
    if (packet[0] === 9 && command === 0x74) bounds.rear = Math.max(bounds.rear, packet[6]);
    if (packet[0] === 9 && command === 0x81) bounds.front = Math.max(bounds.front, packet[8]);
    if (packet[0] === 9 && command === 0x83) bounds.badge = Math.max(bounds.badge, packet[7]);
    pending++; maximumPending = Math.max(maximumPending, pending);
    try {await board.sendReport(0, new Uint8Array(packet));} finally {pending--;}
  }
});
await page.exposeFunction('__moduleAvailable', () => available);
await page.addInitScript(() => {
  class Device extends EventTarget {
    vendorId = 0x1067; productId = 0x626d; productName = 'Module'; opened = false;
    collections = [{usagePage: 0xff60, usage: 0x61}];
    async open() {this.opened = true;}
    async close() {this.opened = false;}
    async forget() {}
    async sendReport(_id: number, data: Uint8Array) {await (window as any).__moduleSend(Array.from(data));}
  }
  const device = new Device();
  (window as any).__module = device;
  const hid = Object.assign(new EventTarget(), {
    getDevices: async () => await (window as any).__moduleAvailable() ? [device] : [],
    requestDevice: async () => await (window as any).__moduleAvailable() ? [device] : [],
  });
  Object.defineProperty(navigator, 'hid', {value: hid});
});
const slider = async (name: string, expected?: number) => {
  const control = page.getByRole('slider', {name, exact: true});
  await control.waitFor();
  if (expected !== undefined) await page.waitForFunction(({name, expected}: {name: string; expected: number}) =>
    (document.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement)?.value === String(expected), {name, expected});
  return control;
};
const setSlider = async (name: string, value: number) => {
  const control = await slider(name);
  await control.evaluate((input: HTMLInputElement, next: number) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(next));
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }, value);
  await page.waitForFunction(({name, value}: {name: string; value: number}) =>
    (document.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement)?.value === String(value), {name, value});
};
const tab = async (name: string) => page.getByText(name, {exact: true}).click();
const quiet = async () => {
  // On reconnect the app can reuse loaded layers while refreshing macros.
  // Finish native-to-page deliveries before destroying that page on reload.
  const deadline = Date.now() + 15000;
  while (Date.now() - lastTrafficAt < 250 || pending || deliveries.size) {
    assert.ok(Date.now() < deadline, 'HID bridge did not become idle.');
    await Bun.sleep(25);
  }
};
const ready = async () => {
  await page.evaluate(async () => {
    const {store} = await import('/src/store/index.ts' as string);
    const {getSelectedDefinition} = await import('/src/store/definitionsSlice.ts' as string);
    const {getLoadProgress} = await import('/src/store/keymapSlice.ts' as string);
    (window as any).__appReady = () => Boolean(getSelectedDefinition(store.getState())) && getLoadProgress(store.getState()) === 1;
  });
  // This installed Playwright treats a Promise predicate as truthy. Import
  // first, then synchronously poll the real Redux state, not an async wrapper.
  await page.waitForFunction(() => (window as any).__appReady());
  await quiet();
  await page.evaluate(async () => {
    if ((window as any).__testHeartbeat) return;
    const {ToffeeHIDDevice} = await import('/src/utils/toffee_studio/hid.ts' as string);
    const hid = new ToffeeHIDDevice((window as any).__module);
    (window as any).__testHeartbeat = setInterval(() => {
      void hid.executeCommand(0x87).catch((error: Error) => {clearInterval((window as any).__testHeartbeat); console.error(error);});
    }, 1000);
  });
  console.log('APP READY: selected definition and all keymap layers loaded.');
};
const verify = async (label: string) => {
  // Use the app's existing per-device queue, not a competing native reader.
  const actual = await page.evaluate(async () => {
    const {ToffeeLightingAPI, ToffeeHIDDevice} = await import('/src/utils/toffee_studio/hid.ts' as string);
    const api = new ToffeeLightingAPI(new ToffeeHIDDevice((window as any).__module));
    return {rear: await api.getLightingState(), front: await api.getFrontState(), badge: await api.getBadgeState(),
      esc: await api.getLedBrightness(91), space: await api.getLedBrightness(10)};
  });
  assert.deepEqual(actual, expected, label);
  readbacks.push({label, actual});
  console.log('UI + PCB PASS:', label);
};
const keyboardSlider = async (name: string, value: number) => {
  const control = await slider(name);
  await control.focus(); await control.press('Home');
  for (let step = 0; step < value; step++) await control.press('ArrowRight');
  await slider(name, value);
};
const dragSlider = async (name: string, value: number) => {
  const control = await slider(name);
  await control.focus(); await control.press('Home');
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box);
  // Actual input thumb is 24px wide; pointer events stay inside the low-drive
  // portion for brightness. Speed is safe to exercise across its full range.
  const x = box.x + 12, y = box.y + box.height / 2;
  assert.equal(await control.evaluate((element: HTMLElement, point: {x: number; y: number}) =>
    document.elementFromPoint(point.x, point.y) === element, {x, y}), true, 'Slider must not be covered.');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (box.width - 24) * value / 255, y, {steps: 18});
  await page.mouse.up();
  const actual = Number(await control.inputValue());
  assert.ok(Math.abs(actual - value) <= 2, `Pointer drag ${name}: ${actual}, expected near ${value}`);
  return actual;
};
const selectOption = async (name: string, label: string) => {
  const control = page.getByRole('combobox', {name, exact: true});
  await control.fill(label);
  await page.getByRole('option', {name: label, exact: true}).click();
};
try {
  await page.goto(baseUrl + '/toffee-lighting');
  // The actual app must finish connection/definition/keymap loading before
  // any stimulus. A visible slider behind its global loader is not readiness.
  await ready();
  await slider('Underglow brightness', before.rear.brightness);
  results.push('Underglow loads real saved state');
  await verify('initial saved state');
  expected.rear.brightness = await dragSlider('Underglow brightness', 14);
  await verify('rear mouse drag and group isolation');
  await keyboardSlider('Underglow brightness', 17); expected.rear.brightness = 17;
  await verify('rear keyboard input');
  expected.rear.speed = await dragSlider('Underglow speed', 220);
  await verify('rear speed drag');
  await (await slider('Underglow speed')).press('End'); expected.rear.speed = 255;
  await verify('rear speed maximum');
  await keyboardSlider('Underglow speed', 9); expected.rear.speed = 9;
  // Rapid JavaScript input supplements (does not substitute for) real events.
  for (const value of [0, 18, 3, 17, 1, 16, 8]) await setSlider('Underglow brightness', value);
  await setSlider('Underglow brightness', 17);
  await verify('rapid rear input, final value wins');
  rejectCommand = 0x74;
  await (await slider('Underglow brightness')).press('ArrowLeft');
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /status 0xef/);
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await slider('Underglow brightness', 17);
  await verify('rejected slider write is visible; Retry restores actual board value');
  await selectOption('Underglow effect', 'Breathing'); expected.rear.effect = 1;
  await verify('rear effect selection');
  await tab('Front Lighting'); await slider('Front brightness', before.front.brightness);
  expected.front.brightness = await dragSlider('Front brightness', 14);
  await verify('front mouse drag and group isolation');
  await keyboardSlider('Front brightness', 16); expected.front.brightness = 16;
  expected.front.speed = await dragSlider('Front speed', 210);
  await verify('front speed drag');
  await (await slider('Front speed')).press('End'); expected.front.speed = 255;
  await verify('front speed maximum');
  await keyboardSlider('Front speed', 7); expected.front.speed = 7;
  for (const value of [0, 18, 4, 15, 2, 12, 16]) await setSlider('Front brightness', value);
  await setSlider('Front speed', 99); expected.front.speed = 99;
  await selectOption('Front effect', 'Breathing'); expected.front.effect = 2;
  await verify('front rapid mixed controls, final state wins');
  await tab('Badge'); await slider('Badge brightness', before.badge.brightness);
  expected.badge.brightness = await dragSlider('Badge brightness', 14);
  await verify('badge mouse drag and group isolation');
  await keyboardSlider('Badge brightness', 15); expected.badge.brightness = 15;
  const enabled = page.getByRole('checkbox', {name: 'Badge lighting enabled'});
  await enabled.uncheck(); expected.badge.enabled = false; await verify('badge disabled');
  await enabled.check(); expected.badge.enabled = true; await verify('badge enabled');
  for (const value of [0, 18, 1, 16, 3, 15]) await setSlider('Badge brightness', value);
  await verify('rapid badge slider changes');
  results.push('Independent front and badge controls write through the actual browser app');
  await tab('Per-Key LED'); await slider('Key brightness', before.esc);
  expected.esc = await dragSlider('Key brightness', 14); await verify('per-key mouse drag');
  await (await slider('Key brightness')).press('End'); expected.esc = 255;
  await verify('per-key maximum stays scaled by low global front brightness');
  await keyboardSlider('Key brightness', 17); expected.esc = 17;
  await verify('per-key keyboard input');
  await selectOption('Front key', 'Space'); await slider('Key brightness', before.space);
  await selectOption('Front key', 'Esc'); await slider('Key brightness', 17);
  await verify('key selection does not write another key');
  results.push('Key selection reads each actual override; Esc differs from Space');
  await Bun.sleep(1300);
  await quiet();
  await page.reload();
  await ready();
  await slider('Underglow brightness', 17);
  await tab('Front Lighting'); await slider('Front brightness', 16); await slider('Front speed', 99);
  await tab('Badge'); await slider('Badge brightness', 15);
  await tab('Per-Key LED'); await slider('Key brightness', 17);
  await verify('reload preserves final values');
  results.push('Reload/reconnect retains real group and per-key state');
  rejectCommand = 0x85;
  await tab('Badge'); await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /status 0xef/);
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await slider('Badge brightness', 15);
  results.push('Injected read and slider-write rejections show errors; Retry reloads real board state');
  // The real HID remains plugged in: these are app-level WebHID events only.
  // A genuine empty enumeration must still show the loader, then recover.
  available = false;
  await page.evaluate(() => {
    const event = new Event('disconnect'); Object.assign(event, {device: (window as any).__module});
    navigator.hid.dispatchEvent(event);
  });
  await page.getByText('Connect Keyboard', {exact: true}).waitFor();
  await Bun.sleep(1200); // Both existing USB-monitor scans must settle.
  available = true;
  await page.getByText('Connect Keyboard', {exact: true}).click();
  await ready(); await slider('Badge brightness', 15);
  await verify('simulated disconnect/reconnect recovers without discarding settings');
  results.push('Empty-enumeration overlay and explicit reconnect work (simulated WebHID event, USB stays powered)');
  for (let attempt = 0; attempt < 4; attempt++) {
    await quiet();
    await page.reload(); await ready();
    await tab('Front Lighting'); await slider('Front brightness', 16);
    await tab('Badge'); await slider('Badge brightness', 15);
    await tab('Per-Key LED'); await slider('Key brightness', 17);
    await verify(`repeat reload ${attempt + 1}`);
  }
  await page.screenshot({path: outputFile.replace(/\.json$/, '-success.png')});
  results.push('Mouse drags and keyboard input exercise all six lighting sliders with real PCB readback');
  results.push('Four additional reloads retain connection and all final values');
  await tab('Underglow'); await selectOption('Underglow effect', 'Solid'); expected.rear.effect = 0;
  expected.rear.brightness = await dragSlider('Underglow brightness', 148);
  await tab('Front Lighting'); await selectOption('Front effect', 'Solid'); expected.front.effect = 1;
  expected.front.brightness = await dragSlider('Front brightness', 148);
  await tab('Badge'); expected.badge.brightness = await dragSlider('Badge brightness', 148);
  await verify('high requested slider values remain unchanged by shared limiter');
  await page.getByRole('button', {name: 'Debug: current budget'}).click();
  await page.getByText('Temporary test profile', {exact: false}).waitFor();
  await page.getByText('Limiting active', {exact: false}).waitFor();
  const debug = await page.locator('section[aria-label="Lighting power debug"]').innerText();
  const effective = Number((await page.getByTestId('power-effective').innerText()).split(' ')[0]);
  assert.ok(effective <= 230);
  await verify('Debug polling coexists with VIA and readback');
  await page.screenshot({path: outputFile.replace(/\.json$/, '-debug.png')});
  readbacks.push({label: 'live Debug under limiting', debug});
  await page.getByRole('button', {name: 'Hide Debug'}).click();
  await verify('limiting does not require Debug open');
  results.push('Real high-slider drags, temporary-profile warning, live Debug and saved-request preservation pass');
  await quiet();
  assert.deepEqual(errors, []); assert.deepEqual(bridgeErrors, []); assert.equal(forbiddenWrites, 0);
  results.push('No uncaught browser errors');
} catch (error) {
  console.error('Lifecycle:', lifecycle);
  console.error('HID command/status trace (no keymap/macro contents):', traffic.slice(-30));
  console.error('Load state:', await page.evaluate(async () => {
    const {store} = await import('/src/store/index.ts' as string);
    const {getSelectedDefinition, getDefinitions} = await import('/src/store/definitionsSlice.ts' as string);
    const {getLoadProgress} = await import('/src/store/keymapSlice.ts' as string);
    const state = store.getState();
    return {device: state.devices.selectedDevicePath, layers: state.keymap.numberOfLayers,
      connected: Object.values(state.devices.connectedDevicePaths).map((device: any) => ({path: device.path, version: device.requiredDefinitionVersion, protocol: device.protocol, vendorProductId: device.vendorProductId})),
      definitionKeys: Object.keys(getDefinitions(state)), selectedDefinitionPresent: Boolean(getSelectedDefinition(state)), loadProgress: getLoadProgress(state),
      loaded: Object.values(state.keymap.rawDeviceMap).map((layers: any) => layers.map((layer: any) => layer.isLoaded)),
      errorStateKeys: Object.keys(state.errors)};
  }));
  await page.screenshot({path: outputFile.replace(/\.json$/, '-failure.png')});
  console.error('Browser failure:', await page.getByText('Front Lighting', {exact: true}).evaluate((element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const covering = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)!;
    return {target: element.outerHTML, covering: covering.outerHTML.slice(0, 1800),
      targetZ: getComputedStyle(element.parentElement!).zIndex, coveringZ: getComputedStyle(covering).zIndex};
  }));
  throw error;
} finally {
  relay = false;
  await Promise.all(deliveries);
  await browser.close();
  try {
    // The browser owns keepalive. Closing it must autonomously blank the PCB;
    // no off command before this assertion, and no unsafe restore on cleanup.
    await Bun.sleep(5500);
    const state = calibrationStatus(await command(0x86), Number(testBuild));
    assert.ok(state.expired && !state.active, 'Browser closure must trip the firmware watchdog.');
    assert.deepEqual(finalSums(await command(0x89)).groups, [[0,0,0],[0,0,0],[0,0,0]]);
    results.push('Actual browser closure stops keepalive; PCB independently transmits all black within 5.5 seconds');
  } finally {
    try {await command(0x7c, new Uint8Array([255,255,255,255,255]));}
    finally {await board.close();}
  }
}
const report = {date: new Date().toISOString(), target: locationText, testBuild, mode: 'visible isolated Chrome, native JS HID bridge',
  results, errors, bridgeErrors, readbacks, counts, bounds, forbiddenWrites, maximumPending, lifecycle,
  startupSavedSettings: 'Temporary firmware disables saves; persistence checked separately after reboot.', finalOutput: 'off'};
const output = await open(outputFile, 'wx', 0o644);
try {await output.writeFile(JSON.stringify(report, null, 2) + '\n');} finally {await output.close();}
console.log('BROWSER PASS:', results.join('; '));
