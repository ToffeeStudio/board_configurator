import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {expect, test} from '@playwright/test';

const packages = fileURLToPath(new URL('../.build/packages/', import.meta.url));
const firmwarePath = '/toffee-firmware/';

async function launch(profile, args = []) {
  const candidates = (await readdir(packages)).filter(name =>
    name.endsWith('-' + process.platform + '-' + process.arch));
  expect(candidates, 'Run bun run package on this OS first').toHaveLength(1);
  const root = join(packages, candidates[0]);
  const executablePath = process.platform === 'darwin'
    ? join(root, 'Toffee Configurator.app', 'Contents', 'MacOS', 'Toffee Configurator')
    : join(root, process.platform === 'win32' ? 'Toffee Configurator.exe' : 'Toffee Configurator');
  return _electron.launch({executablePath, args: ['--user-data-dir=' + profile, ...args]});
}

test('packaged renderer, offline firmware assets, and private storage survive relaunch', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'toffee-desktop-'));
  let app;
  try {
    app = await launch(profile);
    const page = await app.firstWindow();
    await page.waitForURL('toffee://app/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect.poll(() => page.evaluate(() => ({
      platform: window.toffeeDesktop.platform,
      privilegedNode: typeof window.require,
      secure: isSecureContext,
      hid: Boolean(navigator.hid),
      locks: Boolean(navigator.locks),
    }))).toEqual({platform: process.platform, privilegedNode: 'undefined', secure: true, hid: true, locks: true});

    const livePort = await page.evaluate(() => window.toffeeDesktop.modulePort());
    expect(livePort === null || /^[0-9a-f]{64}$/.test(livePort)).toBe(true);

    await page.goto('toffee://app' + firmwarePath);
    await expect(page.getByRole('heading', {name: 'Module firmware update'})).toBeVisible();
    await expect(page.getByLabel('Firmware version')).toHaveValue('usb-500ma');
    await expect(page.getByRole('button', {name: 'Update firmware'})).toBeDisabled();
    expect(await page.evaluate(async () => {
      const base = '/firmware-downloads/';
      const list = await (await fetch(base + 'manifest.json')).json();
      return Promise.all(list.map(async ({file, sha256}) => {
        const bytes = await (await fetch(base + file)).arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === sha256;
      }));
    })).toEqual([true, true, true, true]);
    await page.evaluate(() => localStorage.setItem('desktop-check', 'saved'));
    await app.close();
    app = await launch(profile);
    const reopened = await app.firstWindow();
    await reopened.waitForURL('toffee://app/');
    expect(await reopened.evaluate(() => localStorage.getItem('desktop-check'))).toBe('saved');
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});

test('packaged app restores a saved limit only on the matching USB connection', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'toffee-desktop-fake-'));
  let app;
  try {
    app = await launch(profile);
    const page = await app.firstWindow();
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('toffee:module-port');
      ipcMain.handle('toffee:module-port', () => globalThis.testPort ?? 'fixture-port');
    });
    await page.addInitScript(() => {
      const state = {milliamps: 450, writes: [], reads: 0};
      const device = Object.assign(new EventTarget(), {
        vendorId: 0x1067,
        productId: 0x626d,
        collections: [{usagePage: 0xff60, usage: 0x61}],
        opened: false,
        async open() { this.opened = true; },
        async close() { this.opened = false; },
        async sendReport(_id, packet) {
          if (packet[0] !== 9 || packet[1] !== 0x8f) return;
          if (packet[6] === 1) {
            state.milliamps = packet[7] | packet[8] << 8;
            state.writes.push(state.milliamps);
          } else {
            state.reads++;
          }
          const response = new Uint8Array(32);
          response[1] = 1;
          const view = new DataView(response.buffer);
          view.setUint16(2, state.milliamps, true);
          view.setUint16(4, 940, true);
          response.fill(0x11, 6, 22);
          response.set([0xa5, packet[1], ...packet.slice(2, 6)], 26);
          this.dispatchEvent(Object.assign(new Event('inputreport'), {data: view, device: this, reportId: 0}));
        },
      });
      const hid = Object.assign(new EventTarget(), {
        // Return no devices to the configurator's normal VIA auto-discovery while it boots.
        // The fake only becomes visible after the test arms it.
        active: false,
        async getDevices() { return this.active ? [device] : []; },
        async requestDevice() { throw new Error('Hardware is forbidden in this test.'); },
      });
      Object.defineProperty(navigator, 'hid', {value: hid});
      Object.defineProperty(navigator, 'usb', {value: undefined});
      window.fakePower = {state, hid, device};
    });
    await page.goto('toffee://app/');
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.evaluate(() => {
      localStorage.setItem('toffee-usb-budget-v1:fixture-port:' + '11'.repeat(16), '800');
      window.fakePower.hid.active = true;
    });
    await expect.poll(() => page.evaluate(() => window.fakePower.state.milliamps)).toBe(800);

    // Move the emulated board and model the firmware dropping its RAM-only lease.
    await app.evaluate(() => { globalThis.testPort = 'other-port'; });
    await page.evaluate(() => {
      const {state, hid, device} = window.fakePower;
      hid.dispatchEvent(Object.assign(new Event('disconnect'), {device}));
      state.milliamps = 450;
      state.writes.length = 0;
      state.reads = 0;
      hid.dispatchEvent(Object.assign(new Event('connect'), {device}));
    });
    // Wait for a full poll at the unfamiliar port before checking the absence of writes.
    await expect.poll(() => page.evaluate(() => window.fakePower.state.reads)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.fakePower.state.writes)).toEqual([]);
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});

const installerFixture = fileURLToPath(new URL('../.build/test-fixtures/installer.js', import.meta.url));

test('desktop installer uses the original port, then verifies flash and settings', async () => {
  test.setTimeout(85_000);
  const profile = await mkdtemp(join(tmpdir(), 'toffee-installer-'));
  let app;
  try {
    app = await launch(profile, ['--qualify-usb-installer']);
    const page = await app.firstWindow();
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('toffee:installer-target');
      ipcMain.handle('toffee:installer-target', (_, mode) => ({
        location: (mode === 'bootloader' && !globalThis.atOriginalPort ? 'b' : 'a').repeat(64),
        serial: mode === 'bootloader' ? 'SIMULATED-RP2' : null,
      }));
    });
    await page.addInitScript({path: installerFixture});
    await page.goto('toffee://app' + firmwarePath);
    const update = page.getByRole('button', {name: 'Update firmware', exact: true});
    await expect(update).toBeDisabled();
    await page.getByRole('checkbox', {name: /Only the intended keyboard/}).check();
    await update.click();

    const boot = page.getByRole('button', {name: 'Allow bootloader access', exact: true});
    await boot.click();
    await expect(page.getByRole('alert')).toContainText('The USB port changed');
    expect(await page.evaluate(() => window.readInstallerFixture().usbPackets)).toBe(0);

    await app.evaluate(() => { globalThis.atOriginalPort = true; });
    await boot.click();
    await expect(page.getByRole('status').filter({hasText: 'Update complete.'})).toBeVisible({timeout: 35_000});
    const result = await page.evaluate(() => window.readInstallerFixture());
    expect(result).toMatchObject({erases: 1, settingsMatch: true});
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});

test('desktop installer rechecks the port after saving the original bytes', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'toffee-installer-race-'));
  let app;
  try {
    app = await launch(profile, ['--qualify-usb-installer']);
    const page = await app.firstWindow();
    await app.evaluate(({ipcMain}) => {
      let checks = 0;
      ipcMain.removeHandler('toffee:installer-target');
      ipcMain.handle('toffee:installer-target', (_, mode) => ({
        location: (mode === 'bootloader' && ++checks > 1 ? 'b' : 'a').repeat(64),
        serial: mode === 'bootloader' ? 'SIMULATED-RP2' : null,
      }));
    });
    await page.addInitScript({path: installerFixture});
    await page.goto('toffee://app' + firmwarePath);
    await page.getByRole('checkbox', {name: /Only the intended keyboard/}).check();
    await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
    await page.getByRole('button', {name: 'Allow bootloader access', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('The USB port changed');
    const result = await page.evaluate(() => window.readInstallerFixture());
    expect(result.usbPackets).toBeGreaterThan(0);
    expect(result.erases).toBe(0);
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});

test('desktop installer refuses settings writes if the keyboard returns on another port', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'toffee-installer-return-'));
  let app;
  try {
    app = await launch(profile, ['--qualify-usb-installer']);
    const page = await app.firstWindow();
    await app.evaluate(({dialog, ipcMain}) => {
      globalThis.leavePrompts = 0;
      dialog.showMessageBoxSync = () => {
        globalThis.leavePrompts++;
        return 1;
      };
      let bootloader = false;
      ipcMain.removeHandler('toffee:installer-target');
      ipcMain.handle('toffee:installer-target', (_, mode) => {
        const moved = bootloader && mode === 'module';
        bootloader ||= mode === 'bootloader';
        return {
          location: (moved ? 'b' : 'a').repeat(64),
          serial: mode === 'bootloader' ? 'SIMULATED-RP2' : null,
        };
      });
    });
    await page.addInitScript({path: installerFixture});
    await page.goto('toffee://app' + firmwarePath);
    await page.getByRole('checkbox', {name: /Only the intended keyboard/}).check();
    await page.getByRole('button', {name: 'Update firmware', exact: true}).click();
    await page.getByRole('button', {name: 'Allow bootloader access', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('The USB port changed');
    const result = await page.evaluate(() => window.readInstallerFixture());
    expect(result).toMatchObject({erases: 1, settingsWrites: 0, settingsMatch: false});
    await page.getByRole('link', {name: 'Configurator', exact: false}).click();
    await page.waitForURL('toffee://app/');
    expect(await app.evaluate(() => globalThis.leavePrompts)).toBe(1);
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});
