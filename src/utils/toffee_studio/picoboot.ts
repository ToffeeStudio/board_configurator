// RP2040 ROM transport, hardware-verified on 12 October 2026. Protocol: pico-sdk
// picotool/picoboot_connection.c. No filesystem access or native USB bridge.
export const FLASH_BASE = 0x10000000;
export const SECTOR = 4096;
type Alternate = {alternateSetting: number; interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number;
  endpoints: {type: string; direction: string; endpointNumber: number}[]};
type Control = {requestType: 'vendor'; recipient: 'interface'; request: number; value: number; index: number};
export type PicobootDevice = {
  vendorId: number; productId: number; serialNumber: string; opened: boolean;
  configuration: {interfaces: {interfaceNumber: number; alternates: Alternate[]}[]};
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>; selectAlternateInterface(iface: number, alternate: number): Promise<void>;
  clearHalt(direction: 'in' | 'out', endpoint: number): Promise<void>;
  controlTransferOut(setup: Control, bytes: Uint8Array): Promise<{status: string}>;
  controlTransferIn(setup: Control, length: number): Promise<{status: string; data: DataView}>;
  transferOut(endpoint: number, bytes: Uint8Array): Promise<{status: string; bytesWritten: number}>;
  transferIn(endpoint: number, length: number): Promise<{status: string; data: DataView}>;
};
export type BrowserUSB = {
  requestDevice(options: {filters: {vendorId: number; productId: number}[]}): Promise<PicobootDevice>;
  getDevices(): Promise<PicobootDevice[]>;
};
export type Progress = (done: number, total: number) => void;
export async function usbStep<T>(operation: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`USB ${name} timed out. Reconnect before recovery.`)), 8000);
    })]);
  } finally {clearTimeout(timer!);}
}
export function uf2Payload(uf2: Uint8Array) {
  // Caller must validate the complete sequential UF2 and its SHA-256 first.
  const payload = new Uint8Array(uf2.length / 2);
  for (let offset = 0; offset < uf2.length; offset += 512)
    payload.set(uf2.subarray(offset + 32, offset + 288), offset / 2);
  return payload;
}
export function eraseImage(payload: Uint8Array, before: Uint8Array) {
  if (!payload.length || before.length !== Math.ceil(payload.length / SECTOR) * SECTOR)
    throw new Error('Require original readback covering exactly the affected erase sectors.');
  const result = before.slice(); result.set(payload); return result;
}
function range(address: number, size: number) {
  if (!Number.isInteger(address) || !Number.isInteger(size) || address < FLASH_BASE ||
      size <= 0 || address + size > FLASH_BASE + 1024 * 1024 || address % 256 || size % 256)
    throw new Error('Permit aligned firmware access only within the first 1 MiB.');
  const args = new Uint8Array(8), view = new DataView(args.buffer);
  view.setUint32(0, address, true); view.setUint32(4, size, true); return args;
}
export async function openPicoboot(device: PicobootDevice) {
  if (device.vendorId !== 0x2e8a || device.productId !== 3 || !device.serialNumber)
    throw new Error('Select an RP2040 ROM bootloader with a USB serial.');
  await usbStep(device.open(), 'open');
  await usbStep(device.selectConfiguration(1), 'configuration');
  const interfaces = device.configuration.interfaces.filter(i =>
    i.alternates.some(a => a.interfaceClass === 0xff && a.interfaceSubclass === 0 && a.interfaceProtocol === 0));
  if (interfaces.length !== 1) throw new Error('Require one PICOBOOT vendor interface.');
  const iface = interfaces[0];
  const alternate = iface.alternates.find(a => a.interfaceClass === 0xff && a.interfaceSubclass === 0 && a.interfaceProtocol === 0)!;
  const incoming = alternate.endpoints.filter(e => e.type === 'bulk' && e.direction === 'in');
  const outgoing = alternate.endpoints.filter(e => e.type === 'bulk' && e.direction === 'out');
  if (incoming.length !== 1 || outgoing.length !== 1) throw new Error('Require PICOBOOT bulk IN and OUT.');
  await usbStep(device.claimInterface(iface.interfaceNumber), 'claim');
  await usbStep(device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting), 'alternate');
  console.info('PICOBOOT interface claimed:', iface.interfaceNumber);
  return new Picoboot(device, iface.interfaceNumber, incoming[0].endpointNumber, outgoing[0].endpointNumber);
}
export class Picoboot {
  private token = 0;
  private failed = false;
  private busy = false;
  constructor(readonly device: PicobootDevice, private iface: number, private incoming: number, private outgoing: number) {}
  private async operation<T>(context: () => string, work: () => Promise<T>): Promise<T> {
    if (this.failed || this.busy) throw new Error('PICOBOOT session unavailable; no automatic retry.');
    this.busy = true; let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('transfer timed out; outcome uncertain.')), 8000);
      })]);
    } catch (error) {this.failed = true; throw new Error(`PICOBOOT ${context()}: ${(error as Error).message}`);}
    finally {clearTimeout(timer!); this.busy = false;}
  }
  async resetInterface() {
    let stage = 'reset clear halt IN';
    await this.operation(() => stage, async () => {
      // Clear host endpoint state before the ROM reset, as picotool does for
      // halted endpoints. WebUSB clearHalt also resets the host data toggle.
      console.info('PICOBOOT reset: clearing bulk endpoint state');
      await this.device.clearHalt('in', this.incoming);
      if (this.failed) throw new Error('Session failed; reset stopped.');
      stage = 'reset clear halt OUT';
      await this.device.clearHalt('out', this.outgoing);
      if (this.failed) throw new Error('Session failed; reset stopped.');
      stage = 'reset control OUT';
      console.info('PICOBOOT reset: sending vendor control OUT');
      const reply = await this.device.controlTransferOut({requestType:'vendor', recipient:'interface', request:0x41, value:0, index:this.iface}, new Uint8Array());
      if (this.failed) throw new Error('Session failed; reset stopped.');
      if (reply.status !== 'ok') throw new Error('PICOBOOT interface reset failed.');
      console.info('PICOBOOT reset: complete');
    });
  }
  async command(code: number, args: Uint8Array, length: number, output: Uint8Array) {
    let stage = 'command OUT';
    return this.operation(() => `0x${code.toString(16).padStart(2, '0')} ${stage}`, async () => {
      const packet = new Uint8Array(32), view = new DataView(packet.buffer), token = ++this.token;
      view.setUint32(0, 0x431fd10b, true); view.setUint32(4, token, true);
      packet[8] = code; packet[9] = args.length; view.setUint32(12, length, true); packet.set(args, 16);
      const send = async (bytes: Uint8Array) => {
        if (this.failed) throw new Error('PICOBOOT session failed; transfer stopped.');
        const result = await this.device.transferOut(this.outgoing, bytes);
        if (this.failed) throw new Error('PICOBOOT session failed; transfer stopped.');
        if (result.status !== 'ok' || result.bytesWritten !== bytes.length) throw new Error('PICOBOOT short/failed OUT transfer.');
      };
      const receive = async (count: number) => {
        if (this.failed) throw new Error('PICOBOOT session failed; transfer stopped.');
        const result = await this.device.transferIn(this.incoming, count);
        if (this.failed) throw new Error('PICOBOOT session failed; transfer stopped.');
        if (result.status !== 'ok') throw new Error('PICOBOOT failed IN transfer.');
        return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength).slice();
      };
      await send(packet);
      let result = new Uint8Array();
      if (length) {
        if (code & 0x80) {
          stage = 'payload IN';
          result = await receive(length);
          if (result.length !== length) throw new Error('PICOBOOT short read.');
        } else {stage = 'payload OUT'; await send(output);}
      }
      // Raspberry Pi picotool sends a one-byte OUT transfer to acknowledge reads;
      // other commands acknowledge with a zero-length IN packet (max length1).
      stage = code & 0x80 ? 'acknowledgement OUT' : 'acknowledgement IN';
      if (code & 0x80) await send(new Uint8Array(1));
      else if ((await receive(1)).length !== 0) throw new Error('Invalid PICOBOOT acknowledgement.');
      stage = 'status control IN';
      const status = await this.device.controlTransferIn({requestType:'vendor', recipient:'interface', request:0x42, value:0, index:this.iface}, 16);
      if (this.failed) throw new Error('Session failed; command stopped.');
      if (status.status !== 'ok' || status.data.byteLength !== 16 || status.data.getUint32(0,true) !== token ||
          status.data.getUint32(4,true) !== 0 || status.data.getUint8(8) !== code || status.data.getUint8(9) !== 0)
        throw new Error('PICOBOOT command status mismatch/failure.');
      console.info('PICOBOOT command:', code, token, length);
      return result;
    });
  }
  async prepareRead() {
    await this.resetInterface();
    await this.command(1, new Uint8Array([1]), 0, new Uint8Array());
    // EXIT_XIP prepares the external flash before ENTER_CMD_XIP. Omitting it
    // stalls actual flash reads after an application-to-BOOTSEL transition.
    await this.command(6, new Uint8Array(), 0, new Uint8Array());
    await this.command(7, new Uint8Array(), 0, new Uint8Array());
  }
  async read(address: number, size: number) {
    const args = range(address, size);
    return this.command(0x84, args, size, new Uint8Array());
  }
  async readImage(size: number, progress: Progress) {
    range(FLASH_BASE, size);
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += SECTOR) {
      const count = Math.min(SECTOR, size - offset);
      bytes.set(await this.read(FLASH_BASE + offset, count), offset);
      progress(offset + count, size);
    }
    return bytes;
  }
  async writeImage(bytes: Uint8Array, progress: Progress) {
    if (!bytes.length || bytes.length % SECTOR) throw new Error('Require complete preserved erase sectors.');
    range(FLASH_BASE, bytes.length);
    await this.command(6, new Uint8Array(), 0, new Uint8Array());
    await this.command(3, range(FLASH_BASE, bytes.length), 0, new Uint8Array());
    for (let offset = 0; offset < bytes.length; offset += SECTOR) {
      const chunk = bytes.subarray(offset, offset + SECTOR);
      await this.command(5, range(FLASH_BASE + offset, chunk.length), chunk.length, chunk);
      progress(offset + chunk.length, bytes.length);
    }
    await this.command(7, new Uint8Array(), 0, new Uint8Array());
  }
  async reboot() {
    const args = new Uint8Array(12); new DataView(args.buffer).setUint32(8, 500, true);
    // Reboot disconnects USB; ACK is enough, status may race the disconnect.
    let stage = 'command OUT';
    await this.operation(() => `0x02 ${stage}`, async () => {
      const packet = new Uint8Array(32), view = new DataView(packet.buffer);
      view.setUint32(0, 0x431fd10b, true); view.setUint32(4, ++this.token, true);
      packet[8] = 2; packet[9] = 12; packet.set(args,16);
      const sent = await this.device.transferOut(this.outgoing,packet);
      if (this.failed) throw new Error('PICOBOOT session failed; reboot outcome uncertain.');
      if(sent.status !== 'ok' || sent.bytesWritten !== 32) throw new Error('Reboot command failed.');
      stage = 'acknowledgement IN';
      const ack = await this.device.transferIn(this.incoming,1);
      if (this.failed) throw new Error('PICOBOOT session failed; reboot outcome uncertain.');
      if(ack.status !== 'ok' || ack.data.byteLength !== 0) throw new Error('Reboot acknowledgement failed.');
    });
  }
}
