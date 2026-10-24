// Test adapter only. This module never enumerates or accesses physical USB.
export class FirmwareFakeDevice extends EventTarget {
  vendorId = 0x1067; productId = 0x626d;
  collections = [{usagePage: 0xff60, usage: 0x61}];
  opened = true; profile = 11; mode = 'normal'; build = 0x26101002;
  baseMa = 75;
  lightingProtocol = 3;
  packets: number[][] = []; booted = false; timeout = false; badEcho = false; restarted = false;
  keymap = new Uint8Array(144).fill(7); macros = new Uint8Array(56).fill(5); layout = new Uint8Array([1, 2, 3, 4]);
  async open() {this.opened = true;}
  async close() {this.opened = false;}
  async sendReport(id: number, packet: Uint8Array) {
    if (id !== 0 || packet.length !== 32) throw new Error('Unexpected packet format');
    this.packets.push(Array.from(packet));
    if (packet[0] === 9 && packet[1] === 0x79) {this.booted = true; this.opened = false; return;}
    if (this.timeout) return;
    const reply = packet.slice();
    const view = new DataView(reply.buffer);
    if (packet[0] === 9) {
      reply.fill(0); reply[26] = 0xa5; reply[27] = packet[1]; reply.set(packet.slice(2, 6), 28);
      if (packet[1] === 0x88) {
        reply[1] = this.mode === 'manual' ? 1 : 2;
        reply[2] = 1 | 4 | 16 | (this.mode === 'manual' ? 32 : this.mode === 'current-unlimited' ? 64 : 0);
        [this.profile, 10, 5, 940, this.baseMa, 0, 1000, this.mode === 'normal' ? 800 : 950, 1000, 1000, 940 - this.baseMa]
          .forEach((v, i) => view.setUint16(3 + i * 2, v, true));
        reply[25] = reply[1] === 2 ? 200 : 0;
      } else if (packet[1] === 0x86) {reply[1] = 1; view.setUint32(9, this.build, true);}
      else if (packet[1] === 0x85) reply.set(this.mode === 'manual' || this.lightingProtocol === 2
        ? [2,66,22,16,104,9] : [3,66,22,16,104,45,6],1);
      else throw new Error('Forbidden custom command in updater');
    } else if (packet[0] === 1) {reply[1] = 0; reply[2] = 12;}
    else if (packet[0] === 0x11) reply[1] = this.keymap.length / 144;
    else if (packet[0] === 0x0d) view.setUint16(1, this.macros.length);
    else if ([0x12, 0x0e, 0x13, 0x0f].includes(packet[0])) {
      const offset = packet[1] * 256 + packet[2], count = packet[3];
      const data = [0x12, 0x13].includes(packet[0]) ? this.keymap : this.macros;
      if ([0x13, 0x0f].includes(packet[0])) data.set(packet.slice(4, 4 + count), offset);
      else reply.set(data.slice(offset, offset + count), 4);
      if (this.badEcho) reply[2]++;
    } else if (packet[0] === 2 && packet[1] === 2) reply.set(this.layout, 2);
    else if (packet[0] === 2 && packet[1] === 1) view.setUint32(2, this.restarted ? 1 : Math.floor(performance.now()));
    else if (packet[0] === 3 && packet[1] === 2) this.layout.set(packet.slice(2, 6));
    else throw new Error('Forbidden VIA command in updater');
    const event = new Event('inputreport');
    Object.assign(event, {device: this, data: new DataView(reply.buffer)});
    this.dispatchEvent(event);
  }
}
