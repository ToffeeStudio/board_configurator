// Simulated RP2040 ROM only. No native USB imports or physical enumeration.
import {FLASH_BASE, PicobootDevice} from '../src/utils/toffee_studio/picoboot';

export class FirmwareFakeUSB implements PicobootDevice {
  vendorId = 0x2e8a; productId = 3; serialNumber = 'SIMULATED-RP2'; opened = false;
  configuration = {interfaces: [{interfaceNumber: 1, alternates: [{alternateSetting: 0,
    interfaceClass: 0xff, interfaceSubclass: 0, interfaceProtocol: 0,
    endpoints: [{type: 'bulk', direction: 'out', endpointNumber: 3}, {type: 'bulk', direction: 'in', endpointNumber: 4}],
  }]}]};
  flash = new Uint8Array(0x100000).fill(0x5a);
  packets: Uint8Array[] = []; code = 0; token = 0; length = 0; address = 0; size = 0;
  dataPending = false; xip = false; flashPrepared = false; programmed = false;
  short = false; badStatus = false; shortRead = false; corruptReadback = false;
  constructor(private onReboot: () => void) {}
  async open() {this.opened = true;}
  async close() {this.opened = false;}
  async selectConfiguration(value: number) {if (value !== 1) throw new Error('Bad simulated configuration.');}
  async claimInterface(value: number) {if (value !== 1) throw new Error('Bad simulated interface.');}
  async selectAlternateInterface(iface: number, alternate: number) {
    if (iface !== 1 || alternate !== 0) throw new Error('Bad simulated alternate.');
  }
  async clearHalt(direction: 'in' | 'out', endpoint: number) {
    if (endpoint !== (direction === 'in' ? 4 : 3)) throw new Error('Bad simulated bulk endpoint.');
  }
  async controlTransferOut() {return {status: 'ok', bytesWritten: 0};}
  async controlTransferIn() {
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setUint32(0, this.token, true); view.setUint32(4, this.badStatus ? 1 : 0, true); bytes[8] = this.code;
    return {status: 'ok', data: view};
  }
  async transferOut(endpoint: number, bytes: Uint8Array) {
    if (endpoint !== 3) throw new Error('Not the simulated vendor OUT endpoint.');
    if (this.dataPending) {
      this.flash.set(bytes, this.address - FLASH_BASE); this.dataPending = false; this.programmed = true;
    } else if (bytes.length === 32) {
      this.packets.push(bytes.slice()); const view = new DataView(bytes.buffer, bytes.byteOffset);
      if (view.getUint32(0, true) !== 0x431fd10b) throw new Error('Bad PICOBOOT magic.');
      this.token = view.getUint32(4, true); this.code = bytes[8]; this.length = view.getUint32(12, true);
      this.address = view.getUint32(16, true); this.size = view.getUint32(20, true);
      if (this.code === 1 && (bytes[9] !== 1 || bytes[16] !== 1)) throw new Error('Require exclusive mode1.');
      if (this.code === 7) {
        if (!this.flashPrepared) throw new Error('EXIT_XIP is required before reading.');
        this.xip = true;
      }
      if (this.code === 6) {this.xip = false; this.flashPrepared = true;}
      if (this.code === 3) {
        if (this.xip || this.length) throw new Error('Bad simulated erase.');
        this.flash.fill(255, this.address - FLASH_BASE, this.address - FLASH_BASE + this.size);
      }
      if (this.code === 5) {
        if (this.xip || this.size !== this.length) throw new Error('Bad simulated write.');
        this.dataPending = true;
      }
      if (this.code === 0x84 && (!this.xip || this.size !== this.length)) throw new Error('Bad simulated read.');
    } else if (this.code !== 0x84 || bytes.length !== 1) throw new Error('Bad simulated read ACK.');
    return {status: 'ok', bytesWritten: bytes.length - (this.short ? 1 : 0)};
  }
  async transferIn(endpoint: number, count: number) {
    if (endpoint !== 4) throw new Error('Not the simulated vendor IN endpoint.');
    const bytes = count === 1 ? new Uint8Array() : this.flash.slice(this.address - FLASH_BASE,
      this.address - FLASH_BASE + count - (this.shortRead ? 1 : 0));
    if (this.corruptReadback && this.programmed && bytes.length) bytes[0] ^= 1;
    if (this.code === 2) {this.opened = false; this.onReboot();}
    return {status: 'ok', data: new DataView(bytes.buffer)};
  }
}
