// Offline transport only. No USB enumeration and no native HID dependency.
const front = [0,2,4,6,7,10,13,15,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,34,35,36,37,38,39,40,41,42,43,44,45,46,47,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,83,91,92,93,94,95,96,97,98,99,100,101,102,103];
export class ManualHIDFixture extends EventTarget {
  opened = false;
  productName = 'Offline simulated Module';
  manual = true;
  build = 0x26101002;
  age = 0;
  mismatch = false;
  reject = false;
  delay = 0;
  frame = 0;
  pending = 0;
  maxPending = 0;
  packets: number[][] = [];
  pixels = Array.from({length: 104}, () => [0, 0, 0]);
  async open() {this.opened = true;}
  totals() {
    const totals = [[0,0,0], [0,0,0], [0,0,0]];
    this.pixels.forEach((rgb, i) => rgb.forEach((v, c) => {totals[front.includes(i) ? 0 : i >= 65 && i <= 80 ? 2 : 1][c] += v;}));
    return totals;
  }
  async sendReport(report: number, packet: Uint8Array) {
    if (report !== 0 || !this.opened) throw new Error('Unexpected fixture transport.');
    this.packets.push([...packet]);
    this.maxPending = Math.max(this.maxPending, ++this.pending);
    try {
      if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay));
      const reply = new Uint8Array(32), data = reply.subarray(1, 26), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (this.reject) reply[0] = 0xef;
      else if (packet[1] === 0x88) {
        const requested = Math.round(this.totals().flat().reduce((a,b) => a+b, 0) * 12 / 255);
        data[0] = 1; data[1] = 1 | 4 | 16 | (this.manual ? 32 : 0);
        [this.manual ? 0x8006 : 4, ++this.frame, this.age, 1000, 120, 50,
          requested, this.manual ? requested : Math.min(830, requested), 1000, 1000, 830]
          .forEach((v, i) => view.setUint16(2+i*2, v, true));
      } else if (packet[1] === 0x86) {
        data[0] = 1; data[1] = 255;
        view.setUint32(4, 60000, true); view.setUint32(8, this.build, true);
      } else if (packet[1] === 0x89) {
        data[0] = 1; data[1] = 1;
        view.setUint16(2, ++this.frame, true); view.setUint16(4, this.age, true);
        this.totals().flat().forEach((v, i) => view.setUint16(6+i*2, v, true));
        if (this.mismatch) view.setUint16(6, 1, true);
      } else if (packet[1] === 0x7c) {
        if (packet.slice(6, 11).some(n => n !== 255)) throw new Error('Expected legacy volatile all-off sentinel.');
        this.pixels = this.pixels.map(() => [0,0,0]);
      } else if (packet[1] === 0x8c) {
        if (![0x26101001,0x26101002].includes(this.build)) reply[0] = 0xef;
        else this.pixels = this.pixels.map((_, i) => {
          const group = front.includes(i) ? 0 : i >= 65 && i <= 80 ? 2 : 1;
          return [...packet.slice(6 + group * 3, 9 + group * 3)];
        });
      } else if (packet[1] === 0x8a) {
        this.pixels = this.pixels.map((_, i) => packet[9+(i>>3)] & (1<<(i&7)) ? [...packet.slice(6,9)] : [0,0,0]);
      } else throw new Error(`Forbidden offline command ${packet[1]}`);
      reply[26] = 0xa5; reply[27] = packet[1]; reply.set(packet.slice(2,6), 28);
      const event = new Event('inputreport');
      Object.assign(event, {device: this, reportId: 0, data: new DataView(reply.buffer)});
      this.dispatchEvent(event);
    } finally {this.pending--;}
  }
}
