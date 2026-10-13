import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const [dependencies, base, report, screenshot] = process.argv.slice(2);
if (!dependencies || !base || !report || !screenshot) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname, '127.0.0.1');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
page.setDefaultTimeout(22000);
const checks: string[] = [], errors: string[] = [];
await page.route('https://**/*', (route: any) => route.abort());
page.on('pageerror', (error: Error) => errors.push(error.message));
const check = (message: string) => {checks.push(message); console.info('UPDATER UI PASS:', message);};
const fixture = new URL('/tests/firmware-update-fixture.html', base).href;
try {
  const html = await (await fetch(fixture, {headers: {accept: '*/*'}})).text();
  await page.route(fixture, (route: any) => route.fulfill({contentType: 'text/html', body: html}));
  for (const [mode, profile] of [['normal', 9], ['manual', 0x8006], ['current-unlimited', 10]]) {
    await page.goto(fixture);
    await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.packets.length), 0);
    assert.equal(await page.getByRole('button', {name: 'Connect & prepare backup'}).isDisabled(), true);
    await page.getByLabel('Firmware version').selectOption(mode);
    await page.getByLabel('Only the intended Module', {exact: false}).check();
    await page.getByRole('button', {name: 'Connect & prepare backup'}).click();
    await page.getByText('Ready. Download your backup', {exact: false}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Enter bootloader', exact: true}).isDisabled(), true);
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.booted), false);
    const download = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download private VIA backup'}).click();
    assert.equal((await download).suggestedFilename(), 'module-settings.json');
    await page.getByLabel('My backup and selected UF2').check();
    await page.getByRole('button', {name: 'Enter bootloader', exact: true}).click();
    await page.getByText('Drag', {exact: false}).filter({hasText: 'RPI-RP2'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.booted), true);
    assert.equal(await page.getByRole('button', {name: 'Reconnect, verify & restore VIA'}).isDisabled(), true);
    await page.evaluate(({mode, profile}: any) => {
      const device = (window as any).firmwareFixture;
      device.mode = mode; device.profile = profile; device.keymap.fill(0);
    }, {mode, profile});
    await page.getByLabel('The UF2 copy finished').check();
    await page.getByRole('button', {name: 'Reconnect, verify & restore VIA'}).click();
    await page.getByText('Expected firmware profile/mode', {exact: false}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.keymap.every((b: number) => b === 7)), true);
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.packets.filter((p: number[]) => p[0] === 9 && p[1] === 0x79).length), 1);
    check(mode + ': gated backup, one explicit boot, selected-mode check,15-second uptime, VIA restoration/readback');
  }
  await page.goto(fixture);
  await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
  await page.getByLabel('Only the intended Module', {exact: false}).check();
  await page.locator('input[type=file]').setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}')});
  await page.getByRole('alert').filter({hasText: 'Invalid Module VIA backup'}).waitFor();
  assert.equal(await page.evaluate(() => (window as any).firmwareFixture.packets.length), 0);
  check('Invalid recovery JSON fails before any HID command');
  // Render the real isolated route, with enumeration disabled by a mock.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hid', {configurable: true, value: {
      getDevices: async () => {throw new Error('Unexpected automatic enumeration');},
      requestDevice: async () => {throw new Error('No physical hardware permitted in this test');},
      addEventListener() {}, removeEventListener() {},
    }});
  });
  await page.goto(new URL('/toffee-firmware', base).href, {waitUntil: 'domcontentloaded'});
  await page.getByRole('heading', {name: 'Module firmware update', exact: true}).waitFor();
  await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
  await page.waitForTimeout(1000);
  await page.screenshot({path: screenshot, fullPage: true});
  check('Real route renders without Home/VIA enumeration or hardware access');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(report, JSON.stringify({checks, errors, hardware: 'simulated only'}, null, 2), {flag: 'wx'});
  await browser.close();
}
