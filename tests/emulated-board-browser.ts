// Real app, isolated browser; the only board is the Debug emulated Module. Physical WebHID is
// replaced before loading, so no USB device can be reached.
// Run: bun tests/emulated-board-browser.ts <dir with playwright-core> http://127.0.0.1:5173 <new report.json> <screenshot.png>
// CHROME_PATH and HEADLESS=1 are optional overrides for machines without the Mac Chrome path.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const [dependencies, base, report, screenshot] = process.argv.slice(2);
if (!dependencies || !base || !report || !screenshot) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname, '127.0.0.1');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({
  headless: process.env.HEADLESS === '1',
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const checks: string[] = [], errors: string[] = [];
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route: any) => route.abort());
// The 3D preloads fetch the Draco decoder from gstatic; serve three's copy so this runs offline.
const draco = path.resolve('node_modules/three/examples/jsm/libs/draco');
await context.route(/https:\/\/www\.gstatic\.com\/draco\/.*\/(draco_[a-z_]+\.(js|wasm))$/, (route: any) => {
  const file = route.request().url().split('/').pop();
  route.fulfill({path: path.join(draco, file), contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'});
});
await context.addInitScript(() => {
  const hid = new EventTarget();
  const calls = {getDevices: 0, requestDevice: 0};
  Object.assign(hid, {
    getDevices: async () => {calls.getDevices++; return [];},
    requestDevice: async () => {calls.requestDevice++; throw new Error('Physical hardware forbidden.');},
  });
  Object.defineProperty(navigator, 'hid', {value: hid, configurable: true});
  (window as any).physicalHidCalls = calls;
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', (error: Error) => errors.push(error.message));
const check = (message: string) => {checks.push(message); console.info('EMULATED BOARD PASS:', message);};
const text = (value: string) => page.getByText(value, {exact: true});
const DEBUG_NAV = ['Key Tester', 'Firmware Update', 'Lighting Debug', 'Toffee Test [DEPRECATED]'];
const nav = (name: string) => text(name).first(); // the sidebar comes first in the page
const navCount = async () => (await Promise.all(DEBUG_NAV.map(name => text(name).count()))).reduce((a, b) => a + b, 0);
const physicalCalls = () => page.evaluate(() => ({...(window as any).physicalHidCalls}));
const emulatedState = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('toffee-emulated-board') || 'null'));
const brightness = (value: number) => page.waitForFunction((value: number) =>
  document.querySelector<HTMLInputElement>('input[aria-label="Underglow brightness"]')?.value === String(value), value);
try {
  await page.goto(new URL('/?debug=0', base).href);
  await text('Connect Keyboard').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await text('Connect emulated board').count(), 0);
  assert.equal(await navCount(), 0);
  await page.goto(new URL('/', base).href);
  await text('Connect Keyboard').waitFor();
  assert.equal(await text('Connect emulated board').count(), 0);
  check('Debug off (?debug=0, then no parameter): no emulated-board button and no Debug navigation');

  await page.goto(new URL('/?debug=1', base).href);
  await text('Connect emulated board').waitFor();
  assert.equal(await navCount(), DEBUG_NAV.length);
  check('?debug=1 shows "Connect emulated board" under "Connect Keyboard" and the Debug navigation');

  await text('Connect emulated board').click();
  await text('Emulated board · no hardware').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 66);
  assert.equal(await text('Connect Keyboard').count(), 0);
  await page.screenshot({path: screenshot});
  check('Emulated board loads the Configure page with the real board graphic (66 keys) and a visible status');

  await nav('Lighting').click();
  await page.waitForURL(url => url.pathname === '/toffee-lighting' && url.searchParams.get('debug') === '1');
  for (const tab of ['Underglow', 'Front Lighting', 'Per-Key LED', 'Badge']) await text(tab).waitFor();
  await page.getByRole('button', {name: 'Debug: current budget'}).waitFor();
  await brightness(180);
  check('Lighting page reads the emulated underglow; Per-Key LED and the power panel show in Debug; URL keeps ?debug=1');

  await page.locator('input[aria-label="Underglow brightness"]').evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '61');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('toffee-emulated-board') || 'null')?.rear?.[2] === 61);
  await page.reload();
  await text('Emulated board · no hardware').waitFor();
  await brightness(61);
  assert.equal((await emulatedState()).rear[2], 61);
  assert.equal(new URL(page.url()).searchParams.get('debug'), '1');
  check('A lighting change reaches the emulated board, and a reload reconnects it with the change kept');

  await nav('Lighting Debug').click();
  await text('Lighting measurements need a real Module. Disconnect the emulated board first.').waitFor();
  check('Lighting Debug measurements refuse the emulated board');

  // The counters restarted with the reload, which reconnected the emulated board before any scan.
  assert.deepEqual(await physicalCalls(), {getDevices: 0, requestDevice: 0});
  check('No physical WebHID call while the emulated board is connected, including the reload');

  await nav('Configure').click();
  await page.getByRole('button', {name: 'Disconnect'}).click();
  await text('Connect Keyboard').waitFor();
  await text('Connect emulated board').waitFor();
  assert.equal(await text('Emulated board · no hardware').count(), 0);
  await page.reload();
  await text('Connect emulated board').waitFor();
  assert.equal(await text('Emulated board · no hardware').count(), 0);
  check('Disconnect returns to the connect screen and stays disconnected after a reload');

  await page.goto(new URL('/?debug=0', base).href);
  await text('Connect Keyboard').waitFor();
  assert.equal(await text('Connect emulated board').count(), 0);
  assert.equal(await navCount(), 0);
  await page.goto(new URL('/toffee-lighting', base).href); // the Lighting tabs render behind the connect screen
  await text('Underglow').waitFor({state: 'attached'});
  assert.equal(await text('Per-Key LED').count(), 0);
  check('?debug=0 turns Debug off again, including the Per-Key LED tab');
  assert.deepEqual(errors, []);
} catch (failure) {
  await page.screenshot({path: screenshot.replace(/\.png$/, '') + '.failure.png'}).catch(() => {});
  throw failure;
} finally {
  await writeFile(report, JSON.stringify({scope: 'Emulated board only; physical WebHID replaced', checks, errors}, null, 2), {flag: 'wx'});
  await browser.close();
}
