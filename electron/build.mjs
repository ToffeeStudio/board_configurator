import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {packager} from '@electron/packager';
import {buildFactoryRenderer} from './flasher/render.mjs';

const root = new URL('./', import.meta.url);
const {values} = parseArgs({options: {
  package: {type: 'boolean'},
  factory: {type: 'boolean'},
  platform: {type: 'string'},
  arch: {type: 'string'},
}});
const stage = new URL(values.factory ? '.build/factory/' : '.build/app/', root);
const renderer = new URL('renderer/', stage);
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await rm(stage, {recursive: true, force: true});
await mkdir(stage, {recursive: true});
if (values.factory) await buildFactoryRenderer(renderer);
else await cp(new URL('../dist/', root), renderer, {recursive: true});
for (const file of ['main.mjs', 'devices.mjs', 'renderer.mjs', 'preload.cjs']) {
  await cp(new URL(file, root), new URL(file, stage));
}
await cp(new URL('usb/', root), new URL('usb/', stage), {recursive: true});
await mkdir(new URL('flasher/', stage));
await cp(new URL('flasher/driver.mjs', root), new URL('flasher/driver.mjs', stage));
const {version, main} = metadata;
const name = values.factory ? 'toffee-factory-flasher' : metadata.name;
const productName = values.factory ? 'Toffee Factory Flasher' : metadata.productName;
await writeFile(new URL('package.json', stage), JSON.stringify({name, productName, version, main, toffeeFactory: Boolean(values.factory)}));

if (values.package) {
  const checksums = JSON.parse(await readFile(new URL('node_modules/electron/checksums.json', root), 'utf8'));
  const platform = values.platform ?? process.platform;
  const arch = values.arch ?? process.arch;
  const paths = await packager({
    platform,
    arch,
    ...(values.factory && platform === 'win32' ? {
      extraResource: fileURLToPath(new URL('../firmware-downloads/toffee-windows-setup-v1.exe', root)),
    } : {}),
    dir: fileURLToPath(stage),
    out: fileURLToPath(new URL('.build/packages/', root)),
    electronVersion: metadata.devDependencies.electron,
    download: {checksums},
    asar: true,
    overwrite: true,
    prune: false,
    appBundleId: values.factory ? 'com.toffeestudio.factoryflasher' : 'com.toffeestudio.configurator',
  });
  for (const path of paths) console.info('Packaged desktop app:', path);
}
