// Read-only final check of Module A's original lighting and private VIA settings.
import assert from 'node:assert/strict';
import path from 'node:path';
import {open} from 'node:fs/promises';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';

const [dependencies, locationText, inventoryFile, baselineDirectory, outputFile] = process.argv.slice(2);
if (!dependencies || !locationText || !inventoryFile || !baselineDirectory || !outputFile)
  throw new Error('Required: NODE_MODULES_DIRECTORY USB_LOCATION INITIAL_INVENTORY_JSON BASELINE_DIRECTORY NEW_REPORT_JSON.');
assert.equal(Number(locationText), 0x02140000);
const inventory = await Bun.file(inventoryFile).json();
const expected = inventory.modules.find((module: any) => module.label === 'Module A').lighting_state;
const board = new NativeHIDDevice(rawPath(Number(locationText), dependencies), dependencies);
await board.open();
let state;
try {
  assert.deepEqual(await board.readSettings(), await Bun.file(path.join(baselineDirectory, 'module-2140000-settings.json')).json());
  // Explicit old-protocol GET; not a fallback from protocol-v2 and not a setter.
  let listener!: EventListener;
  let timer!: ReturnType<typeof setTimeout>;
  const reply = new Promise<DataView>((resolve, reject) => {
    listener = event => {
      const data = (event as HIDInputReportEvent).data;
      if (data.byteLength === 32 && data.getUint8(0) === 0) resolve(data);
    };
    board.addEventListener('inputreport', listener);
    timer = setTimeout(() => reject(new Error('Module A lighting GET timed out.')), 2000);
  });
  const packet = new Uint8Array(32); packet.set([9, 0x76]);
  try {
    const [, data] = await Promise.all([board.sendReport(0, packet), reply]);
    state = {effect: data.getUint8(1), speed: data.getUint8(2), brightness: data.getUint8(3),
      hue: data.getUint8(4), saturation: data.getUint8(5)};
    assert.deepEqual(state, expected);
  } finally {clearTimeout(timer); board.removeEventListener('inputreport', listener);}
} finally {await board.close();}
const output = await open(outputFile, 'wx', 0o644);
try {await output.writeFile(JSON.stringify({date: new Date().toISOString(), location: locationText,
  read_only: true, lighting_state: state, original_lighting_unchanged: true, via_settings_unchanged: true}, null, 2) + '\n');}
finally {await output.close();}
console.log('OTHER BOARD PASS: original Module A lighting, keymap, macros and layout unchanged.');
