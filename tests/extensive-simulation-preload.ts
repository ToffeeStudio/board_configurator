// Explicit opt-in Bun preload for offline runner tests. No native HID or camera
// modules are loaded. All outputs are labelled simulation, never PCB evidence.
import {mock} from 'bun:test';
import {EventEmitter} from 'node:events';
import {promisify} from 'node:util';
import childProcess from 'node:child_process';

const scenario = process.env.TOFFEE_SIMULATION_SCENARIO;
if (!scenario) throw new Error('Required TOFFEE_SIMULATION_SCENARIO.');
const began = performance.now();
let front = [1, 100, 11, 36, 255], badge = [1, 2, 36, 255], rear = [0, 100, 11, 36, 255];
let blank = true, expired = false, last = performance.now(), pattern = 0, captures = 0, offAttempts = 0;
const keys = new Uint8Array(104).fill(255);
const rearSet = new Set([1, 3, 5, 8, 9, 11, 12, 14, 16, 32, 33, 48, 49, 81, 82, 84, 85, 86, 87, 88, 89, 90]);
const isFront = (index: number) => index < 104 && !(index >= 65 && index <= 80) && !rearSet.has(index);
class SimulatedHID extends EventEmitter {
  async write(bytes: number[]) {
    const packet = bytes.slice(1), code = packet[1], args = packet.slice(6);
    const response = new Uint8Array(32);
    response[26] = 0xa5; response[27] = code; response.set(packet.slice(2, 6), 28);
    const invalid = () => {response[0] = 0xef;};
    const changed = () => {blank = false; expired = false; last = performance.now();};
    const expire = () => {if (!blank && performance.now() - last >= 5000) {blank = true; expired = true;}};
    if (code === 0x85) response.set([2, 66, 22, 16, 104, 9], 1);
    else if (code === 0x86) {
      expire();
      response.set([1, scenario === 'wrong-cap' ? 19 : 18, +!blank, +expired], 1);
      const view = new DataView(response.buffer);
      view.setUint32(5, Math.floor(performance.now() - began) + 1000, true);
      view.setUint32(9, 0x26100202, true);
      response.set([pattern, front[0], front[2], rear[0], rear[2], badge[0], badge[1]], 13);
      response[20] = blank ? 0 : 7; view.setUint32(21, Math.floor(performance.now() - last), true);
    } else if (code === 0x87) {expire(); last = performance.now();}
    else if (code === 0x7c) {
      const indices = args.slice(0, 5).filter(index => index !== 255);
      if (indices.some(index => index >= 201) || new Set(indices).size !== indices.length) invalid();
      else {
        offAttempts += Number(indices.length === 0);
        if (scenario === 'failed-off' && offAttempts === 1) invalid();
        else {blank = indices.length === 0; expired = false; pattern = blank ? 0 : 1; last = performance.now(); response[11] = 201;}
      }
    } else if (code === 0x80) response.set(front, 1);
    else if (code === 0x82) response.set(badge, 1);
    else if (code === 0x76) response.set(rear, 1);
    else if (code === 0x81) {if (args[0] > 8) invalid(); else {front = args.slice(0, 5); changed();}}
    else if (code === 0x83) {if (args[0] > 1) invalid(); else {badge = args.slice(0, 4); changed();}}
    else if (code === 0x7b || code === 0x84) {
      if (!isFront(args[0])) invalid();
      else if (code === 0x7b) {keys[args[0]] = args[1]; changed();}
      else response.set([args[0], keys[args[0]]], 1);
    } else if (code === 0x71) {if (args[0] > 9) invalid(); else {rear[0] = args[0]; changed();}}
    else if (code === 0x72) {rear[1] = args[0]; changed();}
    else if (code === 0x74) {rear[2] = args[0]; changed();}
    else if (code === 0x75) {rear[3] = args[0]; rear[4] = args[1]; changed();}
    else invalid();
    queueMicrotask(() => this.emit('data', Buffer.from(response)));
    return bytes.length;
  }
  async close() {}
}
mock.module('node-hid', () => ({
  devices: () => [{path: 'SIMULATION-Module-B', vendorId: 0x1067, productId: 0x626d, usagePage: 0xff60, usage: 0x61}],
  HIDAsync: {open: async () => new SimulatedHID()},
}));
const camera = async (_file: string, args: string[]) => {
  captures++;
  if (scenario === 'camera-failure' && captures === 1) throw new Error('SIMULATION: camera capture failed.');
  // A generated one-pixel fixture, not a camera frame or visual test pass.
  await Bun.write(args[1], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1cAAAAASUVORK5CYII=', 'base64'));
  return {stdout: `SIMULATION camera fixture: ${args[1]}`, stderr: ''};
};
const execFile = Object.assign(() => {throw new Error('Simulation camera must use its explicit async contract.');}, {[promisify.custom]: camera});
// Bun 1.2 does not replace named builtin imports with mock.module. Patch the
// shared default object in this isolated test child before loading the runner.
childProcess.execFile = execFile as unknown as typeof childProcess.execFile;
childProcess.execFileSync = (() => '{"SIMULATION-Module-B":18096128}') as typeof childProcess.execFileSync;
console.log(`SIMULATION ONLY: ${scenario}; native HID, Python enumeration and cameras replaced with offline adapters.`);
