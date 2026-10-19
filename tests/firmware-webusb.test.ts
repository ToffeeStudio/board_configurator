import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {flashBrowserFirmware, chooseBootloader, grantedBootloader} from '../src/utils/toffee_studio/firmware-webusb';
import {FirmwareFakeUSB} from './firmware-fake-usb';
import {uf2Payload} from '../src/utils/toffee_studio/picoboot';
const manifest = JSON.parse(readFileSync('firmware-downloads/manifest.json', 'utf8'));
const image = (file: string) => new Uint8Array(readFileSync('firmware-downloads/' + file));
test('all three catalogue images: archive before erase, preserve tail, byte-verify, reboot once', async () => {
  for (const choice of manifest) {
    let rebooted = 0, archived = false;
    const usb = new FirmwareFakeUSB(() => {rebooted++;}), bytes = image(choice.file), payload = uf2Payload(bytes);
    const result = await flashBrowserFirmware(usb, bytes, choice.sha256, async original => {
      expect(usb.packets.some(p => [3, 5].includes(p[8]))).toBe(false);
      expect(original.every(v => v === 0x5a)).toBe(true); archived = true;
    }, () => {});
    expect(archived).toBe(true); expect(rebooted).toBe(1); expect(usb.opened).toBe(false);
    expect(usb.flash.slice(0, payload.length)).toEqual(payload);
    expect(usb.flash.slice(payload.length).every(v => v === 0x5a)).toBe(true);
    expect(result.verifiedBytes % 4096).toBe(0);
    expect(usb.packets.filter(p => p[8] === 3)).toHaveLength(1);
    expect(usb.packets.filter(p => p[8] === 2)).toHaveLength(1);
  }
});
test('invalid hash and overlarge UF2 fail before opening or erasing', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('No reboot allowed.');});
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), '0'.repeat(64), async () => {}, () => {})).rejects.toThrow('SHA-256');
  await expect(flashBrowserFirmware(usb, new Uint8Array(2 * 1024 * 1024 + 512), '', async () => {}, () => {})).rejects.toThrow('first 1 MiB');
  expect(usb.opened).toBe(false); expect(usb.packets).toHaveLength(0);
});
test('backup failure stops before any erase or programming', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('No reboot allowed.');});
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256,
    async () => {throw new Error('Storage quota exceeded.');}, () => {})).rejects.toThrow('quota');
  expect(usb.packets.some(p => [3,5,2].includes(p[8]))).toBe(false); expect(usb.opened).toBe(false);
});
test('bad readback never reboots or automatically repeats the erase', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('No reboot allowed.');}); usb.corruptReadback = true;
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, async () => {}, () => {})).rejects.toThrow('readback mismatch');
  expect(usb.packets.filter(p => p[8] === 3)).toHaveLength(1);
  expect(usb.packets.some(p => p[8] === 2)).toBe(false); expect(usb.opened).toBe(false);
});
test('permission cancellation and multiple bootloaders never reach flash operations', async () => {
  const a = new FirmwareFakeUSB(() => {}), b = new FirmwareFakeUSB(() => {});
  await expect(chooseBootloader({requestDevice: async () => {throw new Error('User cancelled.');}, getDevices: async () => []})).rejects.toThrow('cancelled');
  await expect(grantedBootloader({requestDevice: async () => a, getDevices: async () => [a,b]})).rejects.toThrow('only the intended');
  expect(await grantedBootloader({requestDevice: async () => a, getDevices: async () => []})).toBe(null);
  expect(await chooseBootloader({requestDevice: async () => a, getDevices: async () => [a]})).toBe(a);
  expect(a.packets).toHaveLength(0);
});
test('wrong identity, missing serial and malformed descriptors fail before erase and release handles', async () => {
  for (const failure of ['identity', 'serial', 'descriptors'] as const) {
    const usb = new FirmwareFakeUSB(() => {});
    if (failure === 'identity') usb.productId = 99;
    if (failure === 'serial') usb.serialNumber = '';
    if (failure === 'descriptors') usb.configuration.interfaces = [];
    await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, async () => {}, () => {})).rejects.toThrow();
    expect(usb.packets).toHaveLength(0); expect(usb.opened).toBe(false);
  }
});
