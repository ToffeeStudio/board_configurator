// Explicit native adapter for tests. It never enumerates/selects a board itself.
import {createRequire} from 'node:module';
import childProcess from 'node:child_process';
import path from 'node:path';

export function nodeHID(dependencies: string) {
  return createRequire(path.join(dependencies, 'package.json'))('node-hid');
}
export function rawPath(location: number, dependencies: string): string {
  const firmwareTools = path.resolve('../firmware/keyboards/toffee_studio/module/tools');
  const result = childProcess.execFileSync('/Users/ethanhan/.pyenv/shims/python3', ['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);import flash_module;print(json.dumps({k.decode():v for k,v in flash_module.registry_locations().items()}))',
    firmwareTools], {timeout: 7000, encoding: 'utf8'});
  const locations = JSON.parse(result);
  const matches = nodeHID(dependencies).devices(0x1067, 0x626d)
    .filter((d: any) => d.usagePage === 0xff60 && d.usage === 0x61 && locations[d.path] === location);
  if (matches.length !== 1) throw new Error(`Require one raw Module at location 0x${location.toString(16)}.`);
  return matches[0].path;
}
export class NativeHIDDevice extends EventTarget {
  opened = false;
  private native: any;
  private failure: Error | null = null;
  constructor(private devicePath: string, private dependencies: string) {super();}
  async open() {
    this.native = await nodeHID(this.dependencies).HIDAsync.open(this.devicePath);
    this.native.on('data', (buffer: Uint8Array) => {
      const event = new Event('inputreport');
      Object.assign(event, {device: this, reportId: 0,
        data: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)});
      this.dispatchEvent(event);
    });
    this.native.on('error', (error: Error) => {this.failure = error; console.error('Native HID:', error.message);});
    this.opened = true;
    await Bun.sleep(10); // Start the native reader before the first request.
  }
  async sendReport(report: number, payload: Uint8Array) {
    if (this.failure) throw this.failure;
    await this.native.write([report, ...payload]);
  }
  async close() {await this.native.close(); this.opened = false;}
  async via(code: number, payload: number[] = []): Promise<Uint8Array> {
    const request = new Uint8Array(32);
    request.set([code, ...payload]);
    let listener!: EventListener;
    let timer!: ReturnType<typeof setTimeout>;
    const reply = new Promise<Uint8Array>((resolve, reject) => {
      listener = event => {
        const data = (event as HIDInputReportEvent).data;
        if (data.byteLength !== 32 || data.getUint8(0) !== code) return;
        resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
      };
      this.addEventListener('inputreport', listener);
      timer = setTimeout(() => reject(new Error(`VIA 0x${code.toString(16)} timed out.`)), 2000);
    });
    try {const [, response] = await Promise.all([this.sendReport(0, request), reply]); return response;}
    finally {clearTimeout(timer); this.removeEventListener('inputreport', listener);}
  }
  async readSettings() {
    const layers = (await this.via(0x11))[1];
    const capacity = await this.via(0x0d);
    const size = capacity[1] * 256 + capacity[2];
    const read = async (code: number, count: number) => {
      const result = new Uint8Array(count);
      for (let offset = 0; offset < count; offset += 28) {
        const length = Math.min(28, count - offset);
        const response = await this.via(code, [offset >> 8, offset & 255, length]);
        result.set(response.slice(4, 4 + length), offset);
      }
      return Buffer.from(result).toString('hex');
    };
    return {layers, keymap: await read(0x12, layers * 9 * 8 * 2), macros: await read(0x0e, size),
      layout: Buffer.from((await this.via(0x02, [2])).slice(2, 6)).toString('hex')};
  }
}
