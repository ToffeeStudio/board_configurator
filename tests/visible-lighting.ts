// Visible Chrome + native WebHID. No navigator.hid replacement or native bridge.
// Candidate selection is read-only until the keymap fingerprint matches the
// independently enumerated Module B snapshot at the explicit USB location.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {open} from 'node:fs/promises';
import path from 'node:path';

const [dependencies, baseUrl, beforeFile, outputFile] = process.argv.slice(2);
if (!dependencies || !baseUrl || !beforeFile || !outputFile)
  throw new Error('Required: NODE_MODULES_DIRECTORY LOCAL_APP_URL READ_ONLY_BASELINE_JSON NEW_REPORT_JSON.');
assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
const baseline = await Bun.file(beforeFile).json();
assert.equal(Number(baseline.location), 0x01142000);
const before = baseline.initial;
assert.ok([before.rear, before.front, before.badge].every(group => group.brightness <= 18));
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, slowMo: 90,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--window-size=1500,950', '--window-position=20,40']});
const context = await browser.newContext({viewport: {width: 1450, height: 800}});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const browserCDP = await browser.newBrowserCDPSession();
const processes = await browserCDP.send('SystemInfo.getProcessInfo');
console.log('VISIBLE TEST CHROME PID:', processes.processInfo.find((process: any) => process.type === 'browser').id);
const errors: string[] = [];
page.on('pageerror', (error: Error) => {errors.push(error.message); console.error('PAGE:', error.message);});
const probes: unknown[] = [], checks: unknown[] = [];
let verified = false;
let restored = false;
let failure: string | null = null;
const expected = structuredClone({rear: before.rear, front: before.front, badge: before.badge,
  esc: before.keys.find((key: any) => key.index === 91).brightness});
const ready = async () => {
  await page.evaluate(async () => {
    const {store} = await import('/src/store/index.ts' as string);
    const {getSelectedDefinition} = await import('/src/store/definitionsSlice.ts' as string);
    const {getLoadProgress} = await import('/src/store/keymapSlice.ts' as string);
    (window as any).__visibleReady = () => Boolean(getSelectedDefinition(store.getState())) && getLoadProgress(store.getState()) === 1;
  });
  await page.waitForFunction(() => (window as any).__visibleReady(), undefined, {timeout: 60000});
};
const installReader = async () => page.evaluate(async () => {
  const {store} = await import('/src/store/index.ts' as string);
  const {getSelectedKeyboardAPI} = await import('/src/store/devicesSlice.ts' as string);
  const {ToffeeHIDDevice, ToffeeLightingAPI} = await import('/src/utils/toffee_studio/hid.ts' as string);
  const keyboard = getSelectedKeyboardAPI(store.getState());
  const device = keyboard.getHID()._hidDevice._device;
  if (!(device instanceof HIDDevice)) throw new Error('Require native Chrome HIDDevice.');
  (window as any).__visibleLighting = new ToffeeLightingAPI(new ToffeeHIDDevice(device));
  const raw = store.getState().keymap.rawDeviceMap[store.getState().devices.selectedDevicePath];
  const bytes = new Uint8Array(raw.flatMap((layer: any) => layer.keymap.flatMap((key: number) => [key >> 8, key & 255])));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {keymap_sha256: Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join(''),
    nativeWebHID: true, vendor: device.vendorId, product: device.productId, opened: device.opened};
});
const read = async () => page.evaluate(async () => {
  const api = (window as any).__visibleLighting;
  return {rear: await api.getLightingState(), front: await api.getFrontState(),
    badge: await api.getBadgeState(), esc: await api.getLedBrightness(91)};
});
const verify = async (label: string) => {
  const actual = await read(); assert.deepEqual(actual, expected, label);
  checks.push({label, actual}); console.log('VISIBLE UI + NATIVE WEBHID PASS:', label);
};
const slider = async (name: string, value: number) => {
  await page.waitForFunction(({name, value}: {name: string; value: number}) =>
    (document.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement)?.value === String(value), {name, value});
  return page.getByRole('slider', {name, exact: true});
};
const drag = async (name: string, current: number, target: number) => {
  assert.ok(verified, 'No UI writes before target fingerprint verification.');
  const control = await slider(name, current);
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox(); assert.ok(box);
  const start = {x: box.x + 12 + (box.width - 24) * current / 255, y: box.y + box.height / 2};
  assert.equal(await control.evaluate((element: HTMLElement, point: {x: number; y: number}) =>
    document.elementFromPoint(point.x, point.y) === element, start), true, 'Uncovered slider required.');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(box.x + 12 + (box.width - 24) * target / 255, start.y, {steps: 15});
  await page.mouse.up();
  const actual = Number(await control.inputValue());
  assert.ok(Math.abs(actual - target) <= 2, `${name} mouse drag should reach ${target}, got ${actual}.`);
  return actual;
};
const tab = async (name: string) => page.getByText(name, {exact: true}).click();
try {
  await page.goto(baseUrl + '/toffee-lighting');
  await page.bringToFront();
  for (let attempt = 0; attempt < 2 && !verified; attempt++) {
    await page.getByText('Connect Keyboard', {exact: true}).click();
    console.log('NATIVE CHOOSER: select one Module via the scoped macOS accessibility helper; read-only probe', attempt + 1);
    await ready();
    const identity = await installReader(); probes.push(identity); console.log('Native selection:', identity);
    verified = identity.keymap_sha256 === baseline.keymap_sha256;
    if (!verified) {
      await page.evaluate(async () => {
        for (const device of await navigator.hid.getDevices()) {if (device.opened) await device.close(); await device.forget();}
      });
      await page.reload();
    }
  }
  assert.ok(verified, 'Could not identify exposed Module B; no lighting writes made.');
  await page.evaluate(() => (window as any).__visibleLighting.getCapabilities());
  await verify('native board identity and original state');
  await page.screenshot({path: outputFile.replace(/\.json$/, '-before.png')});
  expected.rear.brightness = await drag('Underglow brightness', expected.rear.brightness, 15);
  await verify('underglow brightness mouse drag');
  const rear = await slider('Underglow brightness', expected.rear.brightness);
  await rear.press('ArrowLeft'); expected.rear.brightness--; await verify('underglow keyboard step');
  expected.rear.speed = await drag('Underglow speed', expected.rear.speed, 120);
  await verify('underglow speed mouse drag');
  await tab('Front Lighting');
  expected.front = {...expected.front, brightness: await drag('Front brightness', expected.front.brightness, 15)};
  await verify('front brightness mouse drag');
  expected.front = {...expected.front, speed: await drag('Front speed', expected.front.speed, 120)};
  await verify('front speed mouse drag');
  await tab('Badge');
  expected.badge = {...expected.badge, brightness: await drag('Badge brightness', expected.badge.brightness, 8)};
  await verify('badge brightness mouse drag');
  const enabled = page.getByRole('checkbox', {name: 'Badge lighting enabled'});
  await enabled.uncheck(); expected.badge = {...expected.badge, enabled: false}; await verify('badge toggle off');
  await enabled.check(); expected.badge = {...expected.badge, enabled: true}; await verify('badge toggle on');
  await tab('Per-Key LED');
  expected.esc = await drag('Key brightness', expected.esc, 100);
  await verify('per-key mouse drag at low front brightness');
  await Bun.sleep(1500);
  await page.reload(); await ready();
  assert.equal((await installReader()).keymap_sha256, baseline.keymap_sha256);
  await verify('native reload retains connection and values');
  await tab('Front Lighting'); await slider('Front brightness', expected.front.brightness);
  await tab('Badge'); await slider('Badge brightness', expected.badge.brightness);
  await tab('Per-Key LED'); await slider('Key brightness', expected.esc);
  await page.screenshot({path: outputFile.replace(/\.json$/, '-success.png')});
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error); console.error(failure);
  await page.screenshot({path: outputFile.replace(/\.json$/, '-failure.png')});
} finally {
  if (verified) {
    await page.evaluate(async (state: any) => {
      const api = (window as any).__visibleLighting;
      await api.setAnimation(state.rear.effect); await api.setSpeed(state.rear.speed);
      await api.setBrightness(state.rear.brightness); await api.setColor(state.rear.hue, state.rear.saturation);
      await api.setFrontState(state.front); await api.setBadgeState(state.badge);
      await api.setLedBrightness(91, state.keys.find((key: any) => key.index === 91).brightness);
    }, before);
    await Bun.sleep(1500);
    assert.deepEqual(await read(), {rear: before.rear, front: before.front, badge: before.badge,
      esc: before.keys.find((key: any) => key.index === 91).brightness});
    restored = true;
  }
  await browser.close();
}
const output = await open(outputFile, 'wx', 0o644);
try {await output.writeFile(JSON.stringify({date: new Date().toISOString(),
  mode: 'visible Chrome, native WebHID, no transport replacement', target: baseline.location,
  result: failure ? 'FAIL' : 'PASS', failure, probes, checks, errors, originalSettingsRestored: restored}, null, 2) + '\n');}
finally {await output.close();}
if (failure) process.exitCode = 1;
