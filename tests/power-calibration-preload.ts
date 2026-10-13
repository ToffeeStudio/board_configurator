// Offline failure tests only: replace all USB/camera/OCR adapters before loading runner.
import {mock} from 'bun:test';
import childProcess from 'node:child_process';
import {promisify} from 'node:util';
const scenario = process.env.TOFFEE_CALIBRATION_SIMULATION;
if (!scenario) throw new Error('Required simulation scenario.');
console.log('SIMULATION ONLY — no PCB, camera or electrical measurements.');
class FakeDevice extends EventTarget {
  opened = false;
  async open() {this.opened = true;}
  async close() {this.opened = false;}
  async sendReport(_id: number, packet: Uint8Array) {
    const code = packet[1], reply = new Uint8Array(32), view = new DataView(reply.buffer);
    reply[26] = 0xa5; reply[27] = code; reply.set(packet.slice(2, 6), 28);
    if (code === 0x85) reply.set([2, 66, 22, 16, 104, 9], 1);
    else if (code === 0x86) {
      reply.set([1, scenario === 'wrong-cap' ? 255 : 18, 0, 0], 1);
      view.setUint32(5, 10000, true);
      view.setUint32(9, scenario === 'wrong-build' ? 0x26100202 : 0x26100402, true);
    } else if (code === 0x88) {
      reply.set([1, 21], 1); view.setUint16(3, 0x8001, true);
      view.setUint16(9, 900, true); view.setUint16(11, 120, true); view.setUint16(13, 100, true);
      view.setUint16(19, 1000, true); view.setUint16(21, 1000, true); view.setUint16(23, 680, true);
    } else if (code === 0x89) {
      reply.set([1, 1], 1); view.setUint16(5, scenario === 'stale-rgb' ? 500 : 0, true);
    } else if (code === 0x7c) {
      if (scenario === 'failed-off') reply[0] = 0xef;
      else reply[11] = 201;
    } else if (![0x87, 0x7b].includes(code)) throw new Error(`Unexpected simulation command ${code}`);
    const event = new Event('inputreport');
    Object.assign(event, {device: this, reportId: 0, data: view});
    this.dispatchEvent(event);
  }
}
mock.module('./native-hid-adapter', () => ({NativeHIDDevice: FakeDevice, rawPath: () => 'SIMULATION'}));
globalThis.fetch = (async (url: string) => {
  if (url.endsWith('/status')) return Response.json({ready: true, alive: true, error: null, helperPid: 123});
  if (scenario === 'camera-error') return new Response('SIMULATION failure', {status: 503});
  return new Response('SIMULATION NOT A REAL IMAGE', {headers: {'x-camera-pid': scenario === 'camera-owner' ? '456' : '123', 'x-frame-number': '42'}});
}) as typeof fetch;
childProcess.execFile = Object.assign(() => {}, {[promisify.custom]: async () => ({stdout: JSON.stringify([
  {text: scenario === 'low-voltage' ? '4.50V' : '5.20V', confidence: 1},
  {text: scenario === 'bad-ocr' ? 'O.09A' : scenario === 'overcurrent' ? '0.45A' : '0.09A', confidence: 1},
])})}) as unknown as typeof childProcess.execFile;
