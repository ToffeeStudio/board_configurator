// Read-only hardware snapshot. Settings are private (0600); candidate copy is immutable.
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {NativeHIDDevice, rawPath} from './native-hid-adapter';

const [dependencies, outputDirectory, firmware] = process.argv.slice(2);
if (!dependencies || !outputDirectory || !firmware)
  throw new Error('Required arguments: NODE_MODULES_DIRECTORY EXISTING_OUTPUT_DIRECTORY CANDIDATE_UF2.');
const digest = (hex: string) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const inventory = [];
for (const location of [0x02140000, 0x01142000]) {
  const devicePath = rawPath(location, dependencies);
  const device = new NativeHIDDevice(devicePath, dependencies);
  await device.open();
  try {
    const settings = await device.readSettings();
    const filename = path.join(outputDirectory, `module-${location.toString(16)}-settings.json`);
    const file = await open(filename, 'wx', 0o600);
    try {await file.writeFile(JSON.stringify(settings, null, 2) + '\n'); await file.sync();}
    finally {await file.close();}
    inventory.push({location: `0x${location.toString(16)}`, path: devicePath,
      layers: settings.layers, macro_bytes: settings.macros.length / 2,
      keymap_sha256: digest(settings.keymap), macro_sha256: digest(settings.macros),
      settings_file: filename});
  } finally {await device.close();}
}
const image = await Bun.file(firmware).arrayBuffer();
const sha256 = createHash('sha256').update(new Uint8Array(image)).digest('hex');
const archived = path.join(outputDirectory, sha256 + '.uf2');
const file = await open(archived, 'wx', 0o444);
try {await file.writeFile(new Uint8Array(image)); await file.sync();} finally {await file.close();}
console.log(JSON.stringify({boards: inventory, candidate: archived, sha256}, null, 2));
