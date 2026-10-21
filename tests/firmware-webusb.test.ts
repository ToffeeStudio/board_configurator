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
    const result = await flashBrowserFirmware(usb, bytes, choice.sha256, null, async original => {
      expect(usb.packets.some(p => [3, 5].includes(p[8]))).toBe(false);
      expect(original.every(v => v === 0x5a)).toBe(true); archived = true;
    }, async () => {expect(rebooted).toBe(0);}, () => {});
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
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), '0'.repeat(64), null, async () => {}, async () => {}, () => {})).rejects.toThrow('SHA-256');
  await expect(flashBrowserFirmware(usb, new Uint8Array(2 * 1024 * 1024 + 512), '', null, async () => {}, async () => {}, () => {})).rejects.toThrow('first 1 MiB');
  expect(usb.opened).toBe(false); expect(usb.packets).toHaveLength(0);
});
test('backup failure stops before any erase or programming', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('No reboot allowed.');});
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, null,
    async () => {throw new Error('Storage quota exceeded.');}, async () => {}, () => {})).rejects.toThrow('quota');
  expect(usb.packets.some(p => [3,5,2].includes(p[8]))).toBe(false); expect(usb.opened).toBe(false);
});
test('bad readback never reboots or automatically repeats the erase', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('No reboot allowed.');}); usb.corruptReadback = true;
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, null, async () => {}, async () => {}, () => {})).rejects.toThrow('readback mismatch');
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
    await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, null, async () => {}, async () => {}, () => {})).rejects.toThrow();
    expect(usb.packets).toHaveLength(0); expect(usb.opened).toBe(false);
  }
});

test('explicit recovery repairs interrupted erase/first/middle/last writes and preserves the first original', async () => {
  const bytes = image('normal.uf2'), count = Math.ceil(uf2Payload(bytes).length / 4096);
  for (const stopAt of [0, 1, Math.floor(count / 2), count]) {
    const usb = new FirmwareFakeUSB(() => {});
    let original!: Uint8Array, written = 0;
    const transfer = usb.transferOut.bind(usb);
    usb.transferOut = async (endpoint, data) => {
      const isData = usb.dataPending;
      const result = await transfer(endpoint, data);
      if (data.length === 32 && data[8] === 3 && stopAt === 0 || isData && ++written === stopAt)
        throw new Error('Simulated cable removed after write reached hardware.');
      return result;
    };
    await expect(flashBrowserFirmware(usb, bytes, manifest[0].sha256, null,
      async sectors => {original = sectors;}, async () => {}, () => {})).rejects.toThrow('cable removed');
    expect(usb.packets.filter(p => p[8] === 3)).toHaveLength(1);
    expect(usb.packets.filter(p => p[8] === 2)).toHaveLength(0);
    const reconnected = new FirmwareFakeUSB(() => {}); reconnected.flash.set(usb.flash);
    await flashBrowserFirmware(reconnected, bytes, manifest[0].sha256,
      {serial: usb.serialNumber, sectors: original}, async sectors => {expect(sectors).toEqual(original);},
      async () => {expect(reconnected.packets.filter(p => p[8] === 2)).toHaveLength(0);}, () => {});
    expect(reconnected.flash.slice(0, bytes.length / 2)).toEqual(uf2Payload(bytes));
    expect(reconnected.flash.slice(bytes.length / 2).every(v => v === 0x5a)).toBe(true);
    expect(reconnected.packets.filter(p => p[8] === 3)).toHaveLength(stopAt === count ? 0 : 1);
    expect(reconnected.packets.filter(p => p[8] === 2)).toHaveLength(1);
  }
});
test('verified-state storage failure stops before reboot; explicit recovery verifies without another erase', async () => {
  const usb = new FirmwareFakeUSB(() => {}), bytes = image('normal.uf2');
  let original!: Uint8Array;
  await expect(flashBrowserFirmware(usb, bytes, manifest[0].sha256, null, async sectors => {original = sectors;},
    async () => {throw new Error('Verified record could not be saved.');}, () => {})).rejects.toThrow('could not be saved');
  expect(usb.packets.some(p => p[8] === 2)).toBe(false);
  const recovered = new FirmwareFakeUSB(() => {}); recovered.flash.set(usb.flash);
  await flashBrowserFirmware(recovered, bytes, manifest[0].sha256, {serial: usb.serialNumber, sectors: original},
    async sectors => {expect(sectors).toEqual(original);}, async () => {}, () => {});
  expect(recovered.packets.some(p => p[8] === 3 || p[8] === 5)).toBe(false);
  expect(recovered.packets.filter(p => p[8] === 2)).toHaveLength(1);
});
test('lost reboot acknowledgement retains durable verification and does not retry', async () => {
  const usb = new FirmwareFakeUSB(() => {throw new Error('Lost reboot acknowledgement.');});
  let verified = false;
  await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, null, async () => {},
    async () => {verified = true;}, () => {})).rejects.toThrow('Lost reboot');
  expect(verified).toBe(true);
  expect(usb.packets.filter(p => p[8] === 2)).toHaveLength(1);
});
test('wrong recovery serial and wrong original range fail before opening', async () => {
  for (const previous of [{serial: 'OTHER-BOARD', sectors: new Uint8Array(4096)},
    {serial: 'SIMULATED-RP2', sectors: new Uint8Array(4096)}]) {
    const usb = new FirmwareFakeUSB(() => {});
    await expect(flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, previous,
      async () => {}, async () => {}, () => {})).rejects.toThrow();
    expect(usb.opened).toBe(false); expect(usb.packets).toHaveLength(0);
  }
});
test.each(['open', 'claimInterface', 'close'])('hung %s is bounded and cannot continue a flash', async method => {
    const usb = new FirmwareFakeUSB(() => {});
    let release!: () => void;
    const original = usb[method as 'open'].bind(usb);
    (usb as any)[method] = async () => {await new Promise<void>(resolve => {release = resolve;}); if (method === 'open') await original();};
    const work = flashBrowserFirmware(usb, image('normal.uf2'), manifest[0].sha256, null,
      async () => {if (method === 'close') throw new Error('Stop before erase.');}, async () => {}, () => {});
    await expect(work).rejects.toThrow(method === 'close' ? 'Stop before erase' : 'timed out');
    const count = usb.packets.length;
    release(); await Bun.sleep(20);
    expect(usb.packets.length).toBe(count);
    expect(usb.packets.some(p => [2,3,5].includes(p[8]))).toBe(false);
}, 10000);
