import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {expect, test} from '@playwright/test';

const appName = 'Toffee Factory Flasher';
const root = fileURLToPath(new URL('../.build/packages/' + appName + '-' + process.platform + '-' + process.arch + '/', import.meta.url));
const fixture = fileURLToPath(new URL('../.build/test-fixtures/installer.js', import.meta.url));
const installer = 'toffee://app/toffee-firmware/';

test('portable flasher ships only the Normal firmware and flashes a simulated blank PCB', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'toffee-factory-'));
  const executablePath = process.platform === 'darwin' ?
    join(root, appName + '.app', 'Contents', 'MacOS', appName) : join(root, appName + '.exe');
  let app;
  try {
    app = await _electron.launch({executablePath, args: ['--user-data-dir=' + profile]});
    const page = await app.firstWindow();
    await page.waitForURL(installer + '?new=1');
    await expect(page.getByRole('heading', {name: 'Flash a new Module board'})).toBeVisible();
    await expect(page.getByRole('link', {name: /Configurator/})).toHaveCount(0);
    await expect(page.getByRole('option', {name: 'Normal · 940 mA'})).toHaveCount(1);

    const resources = await page.evaluate(async () => {
      const base = '/firmware-downloads/';
      const entries = await (await fetch(base + 'manifest.json')).json();
      const bytes = await (await fetch(base + entries[0].file)).arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      const unavailable = await Promise.all(['/', base + 'usb-500ma.uf2', base + 'manual.uf2',
        base + 'current-unlimited.uf2'].map(async url => (await fetch(url)).status));
      return {ids: entries.map(e => e.id), hash, unavailable};
    });
    expect(resources).toEqual({
      ids: ['normal'],
      hash: '3166a155e2a37b6dc3bf67a1ddff3467aa4bc100a0eca08b659963734a17bd94',
      unavailable: [404, 404, 404, 404],
    });
    await app.evaluate(({ipcMain, dialog}) => {
      dialog.showMessageBoxSync = () => 1;
      ipcMain.removeHandler('toffee:installer-target');
      ipcMain.handle('toffee:installer-target', (_, mode) => ({
        location: 'a'.repeat(64),
        serial: mode === 'bootloader' ? 'SIMULATED-RP2' : null,
      }));
    });
    await page.addInitScript({path: fixture});
    await page.goto(installer + '?new=1');
    const flash = page.getByRole('button', {name: 'Flash firmware', exact: true});
    await expect(flash).toBeDisabled();
    await page.getByRole('checkbox', {name: 'Only one new Module is connected, in BOOTSEL.'}).check();
    await flash.click();
    await expect(page.getByRole('status').filter({hasText: 'Board programmed. Firmware readback and startup verified.'}))
      .toBeVisible({timeout: 40_000});
    expect(await page.evaluate(() => window.readInstallerFixture())).toMatchObject({erases: 1, settingsWrites: 0});
    await page.getByRole('link', {name: 'Flash another board'}).click();
    await expect(page.getByRole('button', {name: 'Flash firmware', exact: true})).toBeDisabled();
  } finally {
    await app?.close();
    await rm(profile, {recursive: true, force: true});
  }
});
