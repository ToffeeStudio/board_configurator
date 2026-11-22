import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {build} from 'vite';

const root = new URL('./', import.meta.url);
const downloads = new URL('../../firmware-downloads/', root);

export async function buildFactoryRenderer(output) {
  const catalogue = JSON.parse(await readFile(new URL('manifest.json', downloads), 'utf8'));
  const [firmware] = catalogue.filter(entry => entry.id === 'normal');
  if (firmware?.file !== 'normal.uf2' || firmware.mode !== 'normal') {
    throw new Error('The Normal firmware release is missing.');
  }

  const image = await readFile(new URL(firmware.file, downloads));
  if (createHash('sha256').update(image).digest('hex') !== firmware.sha256) {
    throw new Error('The bundled Normal firmware does not match its release checksum.');
  }
  await build({
    configFile: false,
    root: fileURLToPath(root),
    publicDir: false,
    plugins: [react()],
    build: {outDir: fileURLToPath(output), emptyOutDir: true},
  });
  await mkdir(new URL('toffee-firmware/', output));
  await rename(new URL('index.html', output), new URL('toffee-firmware/index.html', output));
  const assets = new URL('firmware-downloads/', output);
  await mkdir(assets);
  await writeFile(new URL(firmware.file, assets), image);
  await writeFile(new URL('manifest.json', assets), JSON.stringify([firmware]));
}
