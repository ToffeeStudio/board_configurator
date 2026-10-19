import {CommandID, ToffeeHIDDevice, ToffeeLightingAPI} from './hid';
import {DEBUG_ENABLED} from '../../config/debug';

export type FirmwareChoice = {
  id: string; name: string; description: string; file: string; sha256: string;
  profile: number; mode: 'normal' | 'manual' | 'current-unlimited'; testBuild: number | null;
  lightingProtocol: number;
};
export type ViaSettings = {layers: number; keymap: string; macros: string; layout: string};
export const MODULE_FILTER = {vendorId: 0x1067, productId: 0x626d, usagePage: 0xff60, usage: 0x61};
const requireDebug = () => {if (!DEBUG_ENABLED) throw new Error('Firmware updater is disabled.');};
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g) || [], b => parseInt(b, 16));
export function validateSettings(value: ViaSettings): ViaSettings {
  if (!value || !Number.isInteger(value.layers) || value.layers < 1 || value.layers > 32 ||
      typeof value.keymap !== 'string' || typeof value.macros !== 'string' || typeof value.layout !== 'string' ||
      !/^[0-9a-f]+$/.test(value.keymap) || value.keymap.length !== value.layers * 9 * 8 * 4 ||
      !/^(?:[0-9a-f]{2})*$/.test(value.macros) || value.macros.length > 131070 ||
      !/^[0-9a-f]{8}$/.test(value.layout))
    throw new Error('Invalid Module VIA backup: require layers, keymap, macros and layout.');
  return {layers: value.layers, keymap: value.keymap, macros: value.macros, layout: value.layout};
}
export async function validateFirmware(bytes: Uint8Array, expectedHash: string) {
  if (!bytes.length || bytes.length % 512) throw new Error('Incomplete UF2 image.');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Firmware exceeds the permitted first 1 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 512) {
    const u32 = (n: number) => view.getUint32(offset + n, true);
    if (u32(0) !== 0x0a324655 || u32(4) !== 0x9e5d5157 || u32(508) !== 0x0ab16f30 ||
        u32(8) !== 0x2000 || u32(12) !== 0x10000000 + offset / 2 || u32(16) !== 256 ||
        u32(20) !== offset / 512 || u32(24) !== bytes.length / 512 || u32(28) !== 0xe48bff56)
      throw new Error('Not a complete sequential RP2040 flash image.');
  }
  const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  if (hash !== expectedHash) throw new Error('Firmware SHA-256 does not match the release manifest.');
}
export async function fetchFirmware(choice: FirmwareChoice) {
  requireDebug();
  const response = await fetch('/firmware-downloads/' + choice.file);
  if (!response.ok) throw new Error('Firmware download failed.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  await validateFirmware(bytes, choice.sha256);
  return bytes;
}
export async function chooseModule(): Promise<HIDDevice> {
  requireDebug();
  const selected = await navigator.hid.requestDevice({filters: [MODULE_FILTER]});
  const modules = await grantedModules();
  if (selected.length !== 1 || modules.length !== 1 || modules[0] !== selected[0])
    throw new Error('Connect exactly one Module and select its raw HID interface.');
  if (!selected[0].opened) await selected[0].open();
  return selected[0];
}
export async function grantedModules(): Promise<HIDDevice[]> {
  requireDebug();
  return (await navigator.hid.getDevices()).filter(d =>
    d.vendorId === MODULE_FILTER.vendorId && d.productId === MODULE_FILTER.productId &&
    d.collections.some(c => c.usagePage === MODULE_FILTER.usagePage && c.usage === MODULE_FILTER.usage));
}

// Dedicated page only: never share this reader with VIA's normal polling loop.
export class FirmwareConnection {
  private busy = false;
  private failed = false;
  constructor(readonly device: HIDDevice) {requireDebug();}
  async via(code: number, payload = new Uint8Array()): Promise<Uint8Array> {
    if (this.busy || this.failed) throw new Error('Reconnect before starting another firmware operation.');
    this.busy = true;
    const packet = new Uint8Array(32); packet[0] = code; packet.set(payload, 1);
    let timer: ReturnType<typeof setTimeout>;
    let listener: (event: HIDInputReportEvent) => void;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('VIA timed out. Close other board tabs and reconnect.')), 2000);
    });
    const response = new Promise<Uint8Array>((resolve) => {
      listener = event => {
        if (event.device !== this.device || event.data.byteLength !== 32) return;
        const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, 32);
        if (bytes[26] === 0xa5 || bytes[0] !== code) return;
        // Match buffer offsets/counts and keyboard-value IDs as well as opcode.
        const echoed = [0x12, 0x13, 0x0e, 0x0f].includes(code) ? 3 : [2, 3].includes(code) ? 1 : 0;
        if (bytes.slice(1, 1 + echoed).some((b, i) => b !== payload[i])) return;
        resolve(bytes.slice());
      };
      this.device.addEventListener('inputreport', listener);
    });
    try {
      // Observe response rejection immediately, including a hung sendReport.
      return await Promise.race([Promise.all([this.device.sendReport(0, packet), response]).then(results => results[1]), deadline]);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      clearTimeout(timer!); this.device.removeEventListener('inputreport', listener!); this.busy = false;
    }
  }
  private async buffer(code: number, size: number) {
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 28) {
      const count = Math.min(28, size - offset);
      const reply = await this.via(code, new Uint8Array([offset >> 8, offset & 255, count]));
      bytes.set(reply.slice(4, 4 + count), offset);
    }
    return hex(bytes);
  }
  async readSettings(): Promise<ViaSettings> {
    const version = await this.via(1);
    if (version[1] !== 0 || version[2] !== 12) throw new Error('Require VIA protocol 12.');
    const layers = (await this.via(0x11))[1];
    const capacity = await this.via(0x0d);
    if (layers < 1 || layers > 32) throw new Error('Invalid layer count; no settings written.');
    return validateSettings({
      layers, keymap: await this.buffer(0x12, layers * 9 * 8 * 2),
      macros: await this.buffer(0x0e, capacity[1] * 256 + capacity[2]),
      layout: hex((await this.via(2, new Uint8Array([2]))).slice(2, 6)),
    });
  }
  async restoreSettings(saved: ViaSettings) {
    const current = await this.readSettings();
    if (current.layers !== saved.layers || current.macros.length !== saved.macros.length)
      throw new Error('Firmware settings capacity differs. No backup was written.');
    for (const [field, code] of [['keymap', 0x13], ['macros', 0x0f]] as const) {
      if (current[field] === saved[field]) continue;
      const bytes = unhex(saved[field]);
      for (let offset = 0; offset < bytes.length; offset += 28) {
        const chunk = bytes.slice(offset, offset + 28);
        await this.via(code, new Uint8Array([offset >> 8, offset & 255, chunk.length, ...chunk]));
      }
    }
    if (current.layout !== saved.layout) await this.via(3, new Uint8Array([2, ...unhex(saved.layout)]));
    const actual = await this.readSettings();
    if (JSON.stringify(actual) !== JSON.stringify(saved)) throw new Error('VIA settings readback differs from backup.');
  }
  async enterBootloader() {
    requireDebug();
    if (this.busy || this.failed) throw new Error('Reconnect before entering bootloader.');
    const packet = new Uint8Array(32); packet.set([9, 0x79]);
    console.info('Firmware updater: requesting RP2 bootloader.');
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([this.device.sendReport(0, packet), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Bootloader request timed out; outcome uncertain.')), 2000);
      })]);
    } finally {clearTimeout(timer!); this.failed = true;}
  }
  async verify(choice: FirmwareChoice) {
    const hid = new ToffeeHIDDevice(this.device);
    const power = await new ToffeeLightingAPI(hid).getPowerStatus();
    if (power.modelRevision !== choice.profile || power.manualMeasurement !== (choice.mode === 'manual') ||
        power.currentUnlimited !== (choice.mode === 'current-unlimited') ||
        (choice.mode !== 'manual' && power.frontBadgeMax !== 200))
      throw new Error('Connected firmware does not match the selected profile/mode. No backup written.');
    if (choice.testBuild !== null) {
      const [status, data] = await hid.executeCommand(0x86 as CommandID);
      if (status !== 0 || new DataView(data.buffer, data.byteOffset).getUint32(8, true) !== choice.testBuild)
        throw new Error('Wrong manual test build. No backup written.');
    }
    const capabilities = await new ToffeeLightingAPI(hid).getCapabilities();
    if (capabilities.version !== choice.lightingProtocol)
      throw new Error('Connected firmware does not match the selected lighting protocol. No backup written.');
    const start = Date.now(); let previous = -1;
    do {
      const reply = await this.via(2, new Uint8Array([1]));
      const uptime = new DataView(reply.buffer).getUint32(2);
      if (uptime <= previous) throw new Error('Board restarted during verification.');
      previous = uptime;
      if (Date.now() - start >= 15000) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } while (true);
    console.info('Firmware updater: expected mode/profile and 15-second uptime verified.');
  }
}
