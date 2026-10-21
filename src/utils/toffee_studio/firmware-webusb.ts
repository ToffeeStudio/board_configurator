import {DEBUG_ENABLED} from '../../config/debug';
import {validateFirmware} from './firmware-update';
import {BrowserUSB, PicobootDevice, SECTOR, eraseImage, openPicoboot, uf2Payload, usbStep} from './picoboot';

export const BOOT_FILTER = {vendorId: 0x2e8a, productId: 3};
export type FlashProgress = (stage: 'read' | 'write' | 'verify', done: number, total: number) => void;
const requireDebug = () => {if (!DEBUG_ENABLED) throw new Error('Firmware updater is disabled.');};
export async function grantedBootloader(usb: BrowserUSB): Promise<PicobootDevice | null> {
  requireDebug();
  const devices = (await usb.getDevices()).filter(d => d.vendorId === BOOT_FILTER.vendorId && d.productId === BOOT_FILTER.productId);
  if (devices.length > 1) throw new Error('Connect only the intended RP2 bootloader. No firmware written.');
  return devices.length === 1 ? devices[0] : null;
}
export async function chooseBootloader(usb: BrowserUSB): Promise<PicobootDevice> {
  requireDebug();
  // Invoke directly from a user click: a permission prompt cannot be automated.
  const selected = await usb.requestDevice({filters: [BOOT_FILTER]});
  const granted = await grantedBootloader(usb);
  if (granted !== selected)
    throw new Error('Select exactly one RP2 bootloader. No firmware written.');
  return selected;
}

export async function flashBrowserFirmware(
  device: PicobootDevice, uf2: Uint8Array, expectedHash: string,
  previous: {serial: string; sectors: Uint8Array} | null,
  preserveOriginal: (sectors: Uint8Array) => Promise<void>,
  preserveVerified: (verifiedBytes: number) => Promise<void>, progress: FlashProgress,
) {
  requireDebug();
  await validateFirmware(uf2, expectedHash);
  const payload = uf2Payload(uf2);
  if (previous && previous.serial !== device.serialNumber)
    throw new Error('Bootloader serial differs from this backup. No firmware written.');
  if (previous) eraseImage(payload, previous.sectors);
  try {
    const session = await openPicoboot(device);
    await session.prepareRead();
    const current = await session.readImage(Math.ceil(payload.length / SECTOR) * SECTOR,
      (done, total) => progress('read', done, total));
    // Recovery never replaces the original with partially programmed flash.
    const original = previous ? previous.sectors : current;
    await preserveOriginal(original.slice());
    const image = eraseImage(payload, original);
    if (current.some((byte, index) => byte !== image[index])) {
      await session.writeImage(image, (done, total) => progress('write', done, total));
      const actual = await session.readImage(image.length, (done, total) => progress('verify', done, total));
      if (actual.some((byte, index) => byte !== image[index]))
        throw new Error('Firmware readback mismatch. Reconnect and use Recover keyboard.');
    }
    // A durable verified record must survive a lost reboot acknowledgement.
    await preserveVerified(image.length);
    await session.reboot();
    console.info('Browser firmware: byte verification passed; reboot acknowledged.', image.length);
    return {verifiedBytes: image.length, serial: device.serialNumber};
  } finally {
    if (device.opened) await usbStep(device.close(), 'close').catch(error => console.warn('USB handle cleanup:', error.message));
  }
}
