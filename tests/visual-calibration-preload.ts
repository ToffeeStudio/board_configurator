// Fake transport/camera for fail-closed tests. Does not access hardware or read images.
import {mock} from 'bun:test';
const scenario = process.env.TOFFEE_VISUAL_SIMULATION;
if (!scenario) throw new Error('Required simulation scenario.');
console.log('SIMULATION ONLY');
let active = false, frame = 41;
class FakeDevice extends EventTarget {
  opened = false;
  async open() {this.opened = true;}
  async close() {this.opened = false;}
  async sendReport(_id: number, p: Uint8Array) {
    const code = p[1], r = new Uint8Array(32), v = new DataView(r.buffer);
    r[26] = 0xa5; r[27] = code; r.set(p.slice(2,6),28);
    if (code === 0x86) {
      r.set([1, scenario === 'wrong-cap' ? 18 : 255, Number(active), 0], 1);
      v.setUint32(9, scenario === 'wrong-build' ? 0x26100406 : 0x26100407, true);
    } else if (code === 0x88) {
      r.set([1,21],1); v.setUint16(3,scenario === 'wrong-profile' ? 0x8004 : 0x8005,true);
      v.setUint16(9,1100,true); v.setUint16(11,80,true); v.setUint16(13,100,true);
      v.setUint16(19,1000,true); v.setUint16(21,1000,true); v.setUint16(23,920,true);
    } else if (code === 0x89) {
      r.set([1,1],1); v.setUint16(5,scenario === 'stale-output' ? 500 : 0,true);
      if (active) v.setUint16(7, 255, true);
    } else if (code === 0x7c) {
      if (scenario === 'failed-off' || (scenario === 'sample-off-fails' && active)) r[0] = 0xef;
      else active = false;
    } else if (code === 0x8a) {
      active = true;
    } else if (code === 0x87) {
      // Fake keepalive; no hardware.
    } else throw new Error(`Unexpected fake command ${code}`);
    const event = new Event('inputreport');
    Object.assign(event, {device:this,reportId:0,data:v}); this.dispatchEvent(event);
  }
}
mock.module('./native-hid-adapter', () => ({NativeHIDDevice:FakeDevice,rawPath:()=> 'SIMULATION'}));
globalThis.fetch = (async (url: string) => {
  if (url.endsWith('/status')) return Response.json({ready:true,alive:true,helperPid:123});
  if (scenario === 'camera-error') return new Response('SIMULATION',{status:503});
  return new Response('SIMULATION - NOT AN IMAGE',{headers:{'x-camera-pid':scenario === 'camera-owner' ? '456':'123','x-frame-number':String(++frame)}});
}) as typeof fetch;
