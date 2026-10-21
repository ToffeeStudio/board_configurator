import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {uf2Payload} from '../src/utils/toffee_studio/picoboot';
const [dependencies, base, report, screenshot] = process.argv.slice(2);
if (!dependencies || !base || !report || !screenshot) throw new Error('Required: DEPENDENCIES LOCAL_URL NEW_REPORT SCREENSHOT');
assert.equal(new URL(base).hostname, '127.0.0.1');
const {chromium} = createRequire(path.join(dependencies, 'package.json'))('playwright-core');
const browser = await chromium.launch({headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}});
page.setDefaultTimeout(30000);
await page.addInitScript(() => {
  for (const api of ['hid', 'usb']) Object.defineProperty(navigator, api, {configurable: true, value: {
    getDevices: async () => [], requestDevice: async () => {throw new Error('Physical hardware forbidden in this test.');},
    addEventListener() {}, removeEventListener() {},
  }});
});
const checks: string[] = [], errors: string[] = [];
await page.route('https://**/*', (route: any) => route.abort());
page.on('pageerror', (error: Error) => errors.push(error.message));
page.on('dialog', (dialog: any) => dialog.accept());
const check = (message: string) => {checks.push(message); console.info('UPDATER UI PASS:', message);};
const fixture = new URL('/tests/firmware-update-fixture.html', base).href;
const ready = async () => {
  await page.goto(fixture);
  await page.getByRole('option', {name: 'Normal · 940 mA', exact: true}).waitFor({state: 'attached'});
  assert.equal(await page.locator('button').count(), 1);
};
try {
  // The existing HTML plugin otherwise serves the app shell for fixture navigation.
  const html = await (await fetch(fixture, {headers: {accept: '*/*'}})).text();
  await page.route(fixture, (route: any) => route.fulfill({contentType: 'text/html', body: html}));
  const manifest = await (await fetch(new URL('/firmware-downloads/manifest.json', base))).json();
  for (const mode of ['normal', 'manual', 'current-unlimited']) {
    await ready(); await page.getByLabel('Firmware version').selectOption(mode);
    assert.equal(await page.evaluate(() => (window as any).firmwareFixture.packets.length), 0);
    await page.evaluate((mode: string) => {(window as any).updaterFixture.usbGranted = mode !== 'manual';}, mode);
    await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
    if (mode === 'manual') {
      const button = page.getByRole('button', {name: 'Allow bootloader access', exact: true});
      await button.waitFor();
      assert.equal(await page.evaluate(() => (window as any).usbFixture.packets.length), 0);
      await button.click();
    }
    await page.getByRole('status').filter({hasText: 'Update complete.'}).waitFor();
    const choice = manifest.find((v: any) => v.id === mode);
    const bytes = new Uint8Array(await (await fetch(new URL('/firmware-downloads/' + choice.file, base))).arrayBuffer());
    const payload = uf2Payload(bytes);
    const expected = createHash('sha256').update(payload).digest('hex');
    const actual = await page.evaluate(async (size: number) => {
      const w = window as any, stored = await w.recoveryRecords();
      const value = stored[0];
      const hash = await crypto.subtle.digest('SHA-256', w.usbFixture.flash.slice(0, size));
      return {hash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
        saved: value.status, original: value.originalSectors.every((v: number) => v === 0x5a),
        settings: w.firmwareFixture.keymap.every((v: number) => v === 7),
        bootCommands: w.firmwareFixture.packets.filter((p: number[]) => p[0] === 9 && p[1] === 0x79).length,
        erases: w.usbFixture.packets.filter((p: number[]) => p[8] === 3).length,
        archiveBeforeErase: w.updaterFixture.archiveBeforeErase, usbRequests: w.updaterFixture.usbRequests};
    }, payload.length);
    assert.equal(actual.hash, expected); assert.equal(actual.saved, 'complete');
    assert.equal(actual.original, true); assert.equal(actual.settings, true);
    assert.equal(actual.bootCommands, 1); assert.equal(actual.erases, 1); assert.equal(actual.archiveBeforeErase, true);
    assert.equal(actual.usbRequests, mode === 'manual' ? 1 : 0);
    check(mode + ': complete automatic flash, original sectors archived first, exact bytes, single erase/reboot and VIA restore');
  }
  await ready();
  assert.equal(await page.locator('select[aria-label="Recovery backup"] option').count(), 4);
  assert.equal(await page.evaluate(() => (window as any).firmwareFixture.packets.length), 0);
  check('Three separate private backups survive reload; reload sends no HID commands');
  await page.evaluate(() => {
    (window as any).updaterFixture.usbGranted = true;
    (window as any).updaterFixture.hidAfterReboot = false;
  });
  await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
  await page.getByRole('button', {name: 'Reconnect keyboard'}).click();
  await page.getByRole('status').filter({hasText: 'Update complete.'}).waitFor();
  assert.deepEqual(await page.evaluate(() => [
    (window as any).updaterFixture.hidRequests,
    (window as any).usbFixture.packets.filter((p: number[]) => p[8] === 3).length,
  ]), [2, 1]);
  check('Permission lost after reboot requests Module again without repeating flash');
  await ready();
  await page.evaluate(() => {(window as any).updaterFixture.cancelUSB = true;});
  await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
  await page.getByRole('button', {name: 'Allow bootloader access'}).click();
  await page.getByRole('alert').filter({hasText: 'User cancelled USB permission'}).waitFor();
  assert.equal(await page.evaluate(() => (window as any).usbFixture.packets.length), 0);
  check('Cancelled bootloader permission sends no USB commands and preserves prepared backup');
  await ready();
  await page.evaluate(() => {
    (window as any).updaterFixture.usbGranted = true;
    (window as any).usbFixture.corruptReadback = true;
  });
  await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
  await page.getByRole('alert').filter({hasText: 'readback mismatch'}).waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const commands = (window as any).usbFixture.packets;
    return [commands.filter((p: number[]) => p[8] === 3).length, commands.filter((p: number[]) => p[8] === 2).length];
  }), [1, 0]);
  assert.equal(await page.getByRole('button', {name: 'Update stopped', exact: true}).isDisabled(), true);
  check('Bad readback leaves bootloader, retains original sectors and offers no automatic reflash');
  await ready();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (this.name === 'toffee-firmware-recovery-v1' && args[1] === 'readwrite') throw new Error('Simulated storage quota exceeded.');
      return original.apply(this, args as any);
    };
  });
  await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
  await page.getByRole('alert').filter({hasText: 'quota exceeded'}).waitFor();
  assert.equal(await page.evaluate(() => (window as any).firmwareFixture.booted), false);
  assert.equal(await page.evaluate(() => (window as any).usbFixture.packets.length), 0);
  check('Unavailable backup storage stops before bootloader entry');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hid', {configurable: true, value: {
      getDevices: async () => {throw new Error('Unexpected automatic hardware enumeration');},
      requestDevice: async () => {throw new Error('Physical hardware forbidden');},
    }});
    Object.defineProperty(navigator, 'usb', {configurable: true, value: {
      getDevices: async () => {throw new Error('Unexpected automatic USB enumeration');},
      requestDevice: async () => {throw new Error('Physical hardware forbidden');},
    }});
  });
  const requests: string[] = [];
  page.on('request', (request: any) => requests.push(request.url()));
  await page.goto(new URL('/toffee-firmware/', base).href);
  await page.getByRole('heading', {name: 'Module firmware update', exact: true}).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(requests.some(url => url.includes('/normal-index') || url.includes('.glb')), false);
  await page.screenshot({path: screenshot, fullPage: true});
  check('Real trailing-slash route remains isolated from normal app/VIA/model loading');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(report, JSON.stringify({checks, errors, hardware: 'simulated only'}, null, 2), {flag: 'wx'});
  await browser.close();
}
