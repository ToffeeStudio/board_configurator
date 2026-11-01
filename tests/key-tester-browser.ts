// Real app, isolated visible Chrome; all hardware APIs are replaced before loading.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const [dependencies, base, report, screenshot] = process.argv.slice(2);
if (!dependencies || !base || !report || !screenshot) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname, '127.0.0.1');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const checks: string[] = [], errors: string[] = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'hid', {value: {
    getDevices: async () => [], requestDevice: async () => {throw new Error('Physical hardware forbidden.');},
    addEventListener() {}, removeEventListener() {},
  }});
  localStorage.setItem('via-app-store', JSON.stringify({settings: {testKeyboardSoundsSettings: {isEnabled: false}}}));
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', (error: Error) => errors.push(error.message));
const check = (message: string) => {checks.push(message); console.info('KEY TESTER PASS:', message);};
const highlighted = page.locator('[style*="background: mediumvioletred"]');
try {
  await page.goto(new URL('/test/?debug=1', base).href);
  await page.getByRole('button', {name: 'Reset', exact: true}).waitFor();
  assert.equal(new URL(page.url()).pathname, '/test');
  assert.equal(await page.getByText('Key Tester', {exact: true}).count(), 1);
  assert.ok(await page.locator('canvas').count() > 100);
  assert.equal(await page.getByRole('button', {name: 'Connect Keyboard', exact: true}).count(), 0);
  check('Direct trailing-slash link opens native full-layout tester without a PCB or connect overlay');
  await page.keyboard.down('a');
  await page.waitForFunction(() => document.querySelector('[style*="background: mediumvioletred; opacity: 0.6"]'));
  await page.keyboard.up('a');
  await page.waitForFunction(() => document.querySelector('[style*="background: mediumvioletred; opacity: 0.4"]'));
  await page.screenshot({path: screenshot, fullPage: true});
  check('Native keyboard events show held keys and retain released-key history');
  await page.getByRole('button', {name: 'Reset', exact: true}).click();
  assert.equal(await highlighted.count(), 0);
  check('Native Reset clears key history');
  await page.getByText('Lighting Debug', {exact: true}).click();
  assert.equal(await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {code: 'KeyA', cancelable: true});
    window.dispatchEvent(event); return event.defaultPrevented;
  }), false);
  check('Leaving tester removes browser key capture');
  await page.getByText('Key Tester', {exact: true}).click();
  await page.evaluate(async () => {
    const {store} = await import('/src/store/index.ts');
    const {KeyboardAPI, KeyboardValue} = await import('/src/utils/keyboard-api.ts');
    const {HID} = await import('/src/shims/node-hid.ts');
    const {default: definition} = await import('/src/utils/test-keyboard-definition.json?import');
    const state = {reads: 0, pressed: false};
    (window as any).matrixFixture = state;
    KeyboardAPI.prototype.getKeyboardValue = async (value: number, _args: number[], size: number) => {
      if (value !== KeyboardValue.SWITCH_MATRIX_STATE) throw new Error('Unexpected keyboard command.');
      state.reads++;
      const bytes = Array(size).fill(0); bytes[2] = state.pressed ? 1 : 0; return bytes;
    };
    const device = {path: 'simulated-only', vendorProductId: 1, requiredDefinitionVersion: 'v3', protocol: 12};
    HID._cache[device.path] = {...device, _device: {
      opened: true, addEventListener() {}, removeEventListener() {},
      sendReport: async () => {throw new Error('Unexpected hardware write.');},
    }};
    store.dispatch({type: 'definitions/updateDefinitions', payload: {1: {v3: definition}}});
    store.dispatch({type: 'devices/updateConnectedDevices', payload: {[device.path]: device}});
    store.dispatch({type: 'devices/selectDevice', payload: device});
  });
  // Native switches use hidden checkbox inputs, with the visible span as the click target.
  await page.getByText('Test Matrix', {exact: true}).locator('..').locator('label').last().click();
  await page.waitForFunction(() => (window as any).matrixFixture.reads > 2);
  await page.evaluate(() => {(window as any).matrixFixture.pressed = true;});
  await page.waitForFunction(() => document.querySelector('[style*="background: mediumvioletred; opacity: 0.6"]'));
  await page.evaluate(() => {(window as any).matrixFixture.pressed = false;});
  await page.waitForFunction(() => document.querySelector('[style*="background: mediumvioletred; opacity: 0.4"]'));
  await page.getByText('Lighting Debug', {exact: true}).click();
  await page.waitForTimeout(100);
  const reads = await page.evaluate(() => (window as any).matrixFixture.reads);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => (window as any).matrixFixture.reads), reads);
  check('Simulated compatible-board matrix polling highlights transitions and stops on navigation');
  const disabled = await context.newPage();
  disabled.on('pageerror', (error: Error) => errors.push(error.message));
  // A new tab opened without ?debug=1 starts with Debug off.
  await disabled.goto(new URL('/test', base).href);
  await disabled.getByText('Debug mode is disabled.', {exact: true}).waitFor();
  assert.equal(await disabled.getByText('Key Tester', {exact: true}).count(), 0);
  assert.equal(await disabled.getByRole('button', {name: 'Reset', exact: true}).count(), 0);
  assert.equal(await disabled.locator('canvas').count(), 0);
  assert.equal(await disabled.evaluate(() => {
    const event = new KeyboardEvent('keydown', {code: 'KeyA', cancelable: true});
    window.dispatchEvent(event); return event.defaultPrevented;
  }), false);
  check('Debug off (new tab, no ?debug=1) hides tab, blocks direct tester route and attaches no key capture/canvas');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(report, JSON.stringify({checks, errors}, null, 2), {flag: 'wx'});
  await browser.close();
}
