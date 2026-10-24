import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {FirmwareConnection, FirmwareChoice, validateFirmware, validateSettings} from '../src/utils/toffee_studio/firmware-update';
import {FirmwareFakeDevice} from './firmware-fake-device';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
const manifest: FirmwareChoice[] = JSON.parse(readFileSync('firmware-downloads/manifest.json', 'utf8'));
const connection = (device: FirmwareFakeDevice) => new FirmwareConnection(device as unknown as HIDDevice);
test('all three complete bundled UF2s match their release hashes', async () => {
  for (const entry of manifest) await validateFirmware(new Uint8Array(readFileSync('firmware-downloads/' + entry.file)), entry.sha256);
  expect(manifest.map(v => v.profile)).toEqual([11, 0x8006, 12]);
});
test('truncation, invalid blocks and changed image hashes fail closed', async () => {
  const image = new Uint8Array(readFileSync('firmware-downloads/normal.uf2'));
  await expect(validateFirmware(image.slice(1), manifest[0].sha256)).rejects.toThrow('Incomplete');
  const invalid = image.slice(); invalid[12]++;
  await expect(validateFirmware(invalid, manifest[0].sha256)).rejects.toThrow('sequential');
  const changed = image.slice(); changed[64]++;
  await expect(validateFirmware(changed, manifest[0].sha256)).rejects.toThrow('SHA-256');
});
test('private VIA backup validates all required fields', async () => {
  const saved = await connection(new FirmwareFakeDevice()).readSettings();
  expect(validateSettings(saved)).toEqual(saved);
  for (const bad of [null, {}, {...saved, layers: 0}, {...saved, keymap: 'aa'}, {...saved, macros: 'z'}, {...saved, macros: 11}, {...saved, layout: ''}])
    expect(() => validateSettings(bad as any)).toThrow('Invalid Module VIA backup');
});
test('unchanged VIA settings require no writes; changed buffers restore with readback', async () => {
  const device = new FirmwareFakeDevice(), c = connection(device), saved = await c.readSettings();
  device.packets = []; await c.restoreSettings(saved);
  expect(device.packets.some(p => [3, 0x13, 0x0f].includes(p[0]))).toBe(false);
  device.keymap.fill(0); device.macros.fill(0); device.layout.fill(0);
  await c.restoreSettings(saved); expect(await c.readSettings()).toEqual(saved);
  expect(device.packets.some(p => p[0] === 0x13)).toBe(true);
});
test('changed capacity refuses restoration before any writes', async () => {
  const device = new FirmwareFakeDevice(), c = connection(device), saved = await c.readSettings();
  device.macros = new Uint8Array(28); device.packets = [];
  await expect(c.restoreSettings(saved)).rejects.toThrow('capacity differs');
  expect(device.packets.some(p => [3, 0x13, 0x0f].includes(p[0]))).toBe(false);
});
test('timeout requires new connection and cannot leak into a subsequent command', async () => {
  const device = new FirmwareFakeDevice(), c = connection(device); device.timeout = true;
  await expect(c.via(1)).rejects.toThrow('timed out');
  await expect(c.via(1)).rejects.toThrow('Reconnect');
  await expect(c.enterBootloader()).rejects.toThrow('Reconnect');
  expect(device.packets.length).toBe(1);
});
test('only explicit boot action sends a single native-equivalent boot packet', async () => {
  const device = new FirmwareFakeDevice(), c = connection(device);
  await c.readSettings(); expect(device.booted).toBe(false);
  await c.enterBootloader();
  expect(device.packets.at(-1)).toEqual([9, 0x79, ...Array(30).fill(0)]);
  expect(device.booted).toBe(true);
});
test('profile or mode mismatch prevents verification/restoration', async () => {
  for (const entry of manifest.slice(1)) {
    const device = new FirmwareFakeDevice();
    await expect(connection(device).verify(entry)).rejects.toThrow('does not match');
    expect(device.packets.some(p => [3, 0x13, 0x0f].includes(p[0]))).toBe(false);
  }
});
test('released profile12 and recovery profile10 accept uncapped estimates; normal profiles cannot claim unlimited mode', async () => {
  for (const [profile, baseMa] of [[10, 103], [12, 75]]) {
    const device = new FirmwareFakeDevice(); device.mode = 'current-unlimited'; device.profile = profile; device.baseMa = baseMa;
    const value = await new ToffeeLightingAPI(new ToffeeHIDDevice(device as unknown as HIDDevice)).getPowerStatus();
    expect(value.currentUnlimited).toBe(true); expect(value.manualMeasurement).toBe(false);
    expect(value.modelRevision).toBe(profile); expect(value.baseMa).toBe(baseMa);
    expect(value.frontBadgeMax).toBe(200); expect(value.effectiveLedMa).toBeGreaterThan(value.ledBudgetMa);
  }
  for (const profile of [9, 11, 13]) {
    const device = new FirmwareFakeDevice(); device.mode = 'current-unlimited'; device.profile = profile;
    await expect(new ToffeeLightingAPI(new ToffeeHIDDevice(device as unknown as HIDDevice)).getPowerStatus()).rejects.toThrow('Inconsistent');
  }
});
test('old normal firmware cannot masquerade as the new animation build', async () => {
  const device = new FirmwareFakeDevice(); device.lightingProtocol = 2;
  await expect(connection(device).verify(manifest[0])).rejects.toThrow('lighting protocol');
  expect(device.packets.some(p => [3,0x13,0x0f].includes(p[0]))).toBe(false);
});
test('wrong manual build and mid-verification restart are rejected', async () => {
  const device = new FirmwareFakeDevice(); device.mode = 'manual'; device.profile = 0x8006; device.build = 0;
  await expect(connection(device).verify(manifest[1])).rejects.toThrow('Wrong manual test build');
  device.mode = 'normal'; device.profile = 11; device.restarted = true;
  await expect(connection(device).verify(manifest[0])).rejects.toThrow('restarted');
});
test('settings recovery rereads and repairs interruption after first/middle/last keymap chunk', async () => {
  for (const stopAfter of [1, 3, 6]) {
    const device = new FirmwareFakeDevice(), c = connection(device), saved = await c.readSettings();
    device.keymap.fill(0); device.macros.fill(0); device.layout.fill(0);
    const send = device.sendReport.bind(device); let chunks = 0;
    device.sendReport = async (id, packet) => {
      await send(id, packet);
      if (packet[0] === 0x13 && ++chunks === stopAfter) throw new Error('Simulated unplug during settings restore.');
    };
    await expect(c.restoreSettings(saved)).rejects.toThrow('unplug');
    await expect(c.restoreSettings(saved)).rejects.toThrow('Reconnect');
    device.sendReport = send;
    await connection(device).restoreSettings(saved);
    expect(await connection(device).readSettings()).toEqual(saved);
    expect(device.packets.some(p => p[0] === 9 && p[1] === 0x79)).toBe(false);
  }
});
