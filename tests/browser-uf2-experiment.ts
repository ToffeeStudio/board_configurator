// EXPLICIT HARDWARE EXPERIMENT, not an automated regression or production entry.
// Native APIs only: no HID mocks, native USB bridge, permission bypass or retry.
import {chooseModule, fetchFirmware, FirmwareChoice, FirmwareConnection, ViaSettings} from '../src/utils/toffee_studio/firmware-update';
import {ToffeeHIDDevice, ToffeeLightingAPI} from '../src/utils/toffee_studio/hid';
import {DEBUG_ENABLED} from '../src/config/debug';
if (!DEBUG_ENABLED) throw new Error('Debug is disabled.');
const choice: FirmwareChoice = {
  id: 'normal', name: 'normal9', description: 'Same normal firmware', file: 'normal.uf2',
  sha256: '78d05883df9de9fcee88d9c216aa744be6ef1d4a55eeffbf2504b500f61f282b',
  profile: 9, mode: 'normal', testBuild: null,
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const evidence: {events: {at: string; stage: string; detail: unknown}[]; backup?: ViaSettings; before?: unknown; after?: unknown} = {events: []};
let connection: FirmwareConnection, saved: ViaSettings, image: Uint8Array, directory: FileSystemDirectoryHandle;
let attempted = false;
function log(stage: string, detail: unknown = '') {
  evidence.events.push({at: new Date().toISOString(), stage, detail});
  document.getElementById('log')!.textContent = evidence.events.map(e => e.at + ' ' + e.stage + ' ' + JSON.stringify(e.detail)).join('\n');
  console.info('UF2 experiment', stage, detail);
}
const deadline = async <T>(label: string, task: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timed out; no automatic retry')), ms);
  })]);} finally {clearTimeout(timer!);}
};
Object.assign(window, {
  uf2Experiment: {
    evidence,
    // Operator enables these only after independently archiving private backup
    // and validating fresh native USB/bootloader identity. Not an API simulation.
    archived() {if (!evidence.backup) throw new Error('No backup'); button('boot').disabled = false;},
    identityVerified() {if (!directory) throw new Error('No boot drive'); button('write').disabled = false;},
  },
});
log('capabilities', {webhid: !!navigator.hid, directoryPicker: !!window.showDirectoryPicker, userAgent: navigator.userAgent});
button('connect').onclick = async () => {
  button('connect').disabled = true;
  try {
    connection = new FirmwareConnection(await chooseModule());
    image = await fetchFirmware(choice);
    saved = await connection.readSettings(); evidence.backup = saved;
    evidence.before = await new ToffeeLightingAPI(new ToffeeHIDDevice(connection.device)).getPowerStatus();
    log('prepared', {imageBytes: image.length, profile: choice.profile, sha256: choice.sha256});
  } catch (e) {log('prepare-error', String(e)); button('connect').disabled = false;}
};
button('boot').onclick = async () => {
  button('boot').disabled = true;
  log('boot-request');
  try {await connection.enterBootloader(); log('boot-request-sent');}
  catch (e) {log('boot-request-uncertain', String(e));}
  button('select').disabled = false;
};
button('select').onclick = async () => {
  button('select').disabled = true;
  try {
    directory = await window.showDirectoryPicker({mode: 'readwrite', id: 'toffee-rp2'});
    const info = await deadline('Reading INFO_UF2.TXT',
      directory.getFileHandle('INFO_UF2.TXT').then(h => h.getFile()).then(f => f.text()), 8000);
    if (!/^Board-ID: RPI-RP2\s*$/m.test(info)) throw new Error('Selected drive is not RPI-RP2');
    log('drive-selected', {name: directory.name, info});
  } catch (e) {log('drive-error', String(e)); button('select').disabled = false;}
};
async function verify(device: HIDDevice) {
  connection = new FirmwareConnection(device);
  if (!device.opened) await device.open();
  log('verifying');
  await connection.verify(choice);
  await connection.restoreSettings(saved);
  evidence.after = await new ToffeeLightingAPI(new ToffeeHIDDevice(device)).getPowerStatus();
  await device.close();
  button('reconnect').disabled = true;
  log('verified', 'Expected normal profile/mode,15s uptime,VIA restored/read back. Not flash readback or physical typing.');
}
button('write').onclick = async () => {
  if (attempted) throw new Error('Single write only.');
  attempted = true; button('write').disabled = true; button('select').disabled = true;
  try {
    await deadline('Browser UF2 copy', (async () => {
      log('get-file');
      const handle = await directory.getFileHandle('MODULE.UF2', {create: true});
      log('create-writable');
      const stream = await handle.createWritable();
      log('write-start', image.length);
      await stream.write(image);
      log('write-returned');
      await stream.close();
      log('close-returned');
    })(), 30000);
  } catch (e) {
    log('copy-uncertain', String(e));
    // Do not retry write or abort-close after an uncertain disconnect.
  }
  log('waiting-for-application');
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const matches = (await navigator.hid.getDevices()).filter(d => d.vendorId === 0x1067 && d.productId === 0x626d);
    if (matches.length === 1) {
      try {await verify(matches[0]); return;}
      catch (e) {log('verification-error', String(e)); break;}
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  button('reconnect').disabled = false;
  log('manual-reconnect-needed', 'No verified application yet; no copy retry.');
};
button('reconnect').onclick = async () => {
  button('reconnect').disabled = true;
  try {await verify(await chooseModule());}
  catch (e) {log('verification-error', String(e)); button('reconnect').disabled = false;}
};
