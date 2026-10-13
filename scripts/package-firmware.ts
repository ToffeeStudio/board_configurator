// Explicit input paths; no USB access. Generated releases contain no user settings.
import {readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [normal, manual, unlimited, firmwareRoot, output] = process.argv.slice(2);
if (!normal || !manual || !unlimited || !firmwareRoot || !output)
  throw new Error('Required: NORMAL_UF2 MANUAL_UF2 UNLIMITED_UF2 FIRMWARE_ROOT NEW_OUTPUT_DIRECTORY');
if (existsSync(output)) throw new Error('Output directory already exists; never replace a release.');
mkdirSync(output, {recursive: true});
const variants = [
  {id: 'normal', name: 'Normal · 940 mA', description: 'Latest normal profile9. Estimated-current limiting, front/badge 200/255, saved lighting and 1s dark + 1s fade.', source: normal, profile: 9, mode: 'normal', testBuild: null},
  {id: 'manual', name: 'Unlimited measurement test', description: 'Build 0x26101002. Exact 0–255 output, no current limiter or timeout, starts dark, test lighting not saved. Uses the older informational estimator.', source: manual, profile: 0x8006, mode: 'manual', testBuild: 0x26101002},
  {id: 'current-unlimited', name: 'Normal · no current limit', description: 'Profile10. Normal saves and startup fade, front/badge 200/255 retained. Current estimate is informational only; saved high output returns after restart.', source: unlimited, profile: 10, mode: 'current-unlimited', testBuild: null},
];
const manifest = variants.map(({source, ...entry}) => {
  const data = readFileSync(source), file = entry.id + '.uf2';
  copyFileSync(source, join(output, file));
  return {...entry, file, sha256: createHash('sha256').update(data).digest('hex')};
});
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const tools = join(firmwareRoot, 'keyboards/toffee_studio/module/tools');
for (const file of ['flash_module.py', 'led_discovery.py']) copyFileSync(join(tools, file), join(output, file));
copyFileSync(join(firmwareRoot, 'LICENSE'), join(output, 'LICENSE'));
copyFileSync(new URL('./firmware-download-README.txt', import.meta.url), join(output, 'README.txt'));
writeFileSync(join(output, 'requirements.txt'), 'hid==1.0.6\npyusb==1.3.1\n');
execFileSync('/usr/bin/zip', ['-q', 'module-firmware-and-updater.zip',
  'README.txt', 'LICENSE', 'requirements.txt', 'flash_module.py', 'led_discovery.py', 'manifest.json',
  ...manifest.map(v => v.file)], {cwd: resolve(output)});
console.info('Packaged three UF2s and macOS Python updater:', resolve(output));
