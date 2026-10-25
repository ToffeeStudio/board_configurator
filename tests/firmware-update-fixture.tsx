import {createRoot} from 'react-dom/client';
import {FirmwareUpdate} from '../src/components/panes/firmware-update';
import {FirmwareFakeDevice} from './firmware-fake-device';
import {FirmwareFakeUSB} from './firmware-fake-usb';
import {readRecoveries, saveRecovery, recoveryHash, FirmwareRecovery} from '../src/utils/toffee_studio/firmware-recovery';
import {FLASH_BASE, eraseImage, uf2Payload} from '../src/utils/toffee_studio/picoboot';
import {createStore, del, set} from 'idb-keyval';
const device = new FirmwareFakeDevice();
// URL scenarios allow supervised browser testing without evaluating hidden app state.
const scenario = new URLSearchParams(location.search).get('scenario');
if (new URLSearchParams(location.search).has('recovery')) device.booted = true;
const fixture = {usbGranted: ['granted', 'reconnect', 'readback-failure'].includes(scenario!),
  hidAfterReboot: scenario !== 'reconnect', rebooted: false, cancelUSB: scenario === 'cancel', usbRequests: 0, hidRequests: 0,
  archiveBeforeErase: true, verifiedBeforeReboot: true, savedStatus: 'none', originalIntact: true};
const usb = new FirmwareFakeUSB(() => {
  fixture.rebooted = true;
  device.booted = false;
  device.keymap.fill(0);
  device.mode = (document.querySelector('select[aria-label="Firmware version"]') as HTMLSelectElement).value;
  device.profile = {normal: 13, manual: 0x8006, 'current-unlimited': 14}[device.mode as 'normal'];
  device.lightingProtocol = device.mode === 'manual' ? 2 : 3;
});
usb.corruptReadback = scenario === 'readback-failure';
if (scenario === 'storage-failure') {
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
    if (this.name === 'toffee-firmware-recovery-v1' && args[1] === 'readwrite')
      throw new Error('Simulated storage quota exceeded.');
    return transaction.apply(this, args);
  };
}
if (scenario === 'verified-storage-failure') {
  fixture.usbGranted = true;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === 'backups' && value.status === 'verified') throw new Error('Simulated verified-state persistence failure.');
    return put.call(this, value, key!);
  };
}
const transfer = usb.transferOut.bind(usb);
usb.transferOut = async (endpoint, bytes) => {
  if (bytes.length === 32 && bytes[8] === 3) {
    const saved = await readRecoveries();
    fixture.archiveBeforeErase &&= saved.some(record => record.status === 'writing' && record.serial === usb.serialNumber && record.originalSectors!.length > 0);
  }
  if (bytes.length === 32 && bytes[8] === 2) {
    fixture.verifiedBeforeReboot &&= (await readRecoveries()).some(record => record.status === 'verified' && record.serial === usb.serialNumber);
  }
  return transfer(endpoint, bytes);
};
Object.assign(window, {firmwareFixture: device, usbFixture: usb, updaterFixture: fixture, recoveryRecords: readRecoveries});
Object.defineProperty(navigator, 'hid', {configurable: true, value: {
  requestDevice: async () => {
    if (!navigator.userActivation.isActive) throw new Error('HID permission requires a click.');
    fixture.hidRequests++;
    if (fixture.rebooted) fixture.hidAfterReboot = true;
    return [device];
  },
  getDevices: async () => device.booted || fixture.rebooted && !fixture.hidAfterReboot ? [] : [device],
}});
Object.defineProperty(navigator, 'usb', {configurable: true, value: {
  requestDevice: async () => {
    if (!navigator.userActivation.isActive) throw new Error('USB permission requires a click.');
    fixture.usbRequests++;
    if (fixture.cancelUSB) throw new Error('User cancelled USB permission.');
    fixture.usbGranted = true; return usb;
  },
  getDevices: async () => device.booted && fixture.usbGranted ? [usb] : [],
}});
async function renderFixture() {
  if (scenario === 'resume') {
    const saved = JSON.parse(sessionStorage.getItem('simulated-updater-device')!);
    usb.flash.set(Uint8Array.from(atob(saved.flash), c => c.charCodeAt(0)));
    device.booted = saved.booted; fixture.usbGranted = true;
    device.keymap.set(saved.keymap); device.macros.set(saved.macros); device.layout.set(saved.layout);
  }
  if (scenario?.startsWith('recover-')) {
    const choice = (await (await fetch('/firmware-downloads/manifest.json')).json())[0];
    const bytes = new Uint8Array(await (await fetch('/firmware-downloads/' + choice.file)).arrayBuffer());
    const original = new Uint8Array(Math.ceil(bytes.length / 2 / 4096) * 4096).fill(0x5a);
    const record: FirmwareRecovery = {version: 2, id: 'sim-' + scenario, createdAt: new Date().toISOString(), choice,
      settings: {layers: 1, keymap: '07'.repeat(144), macros: '05'.repeat(56), layout: '01020304'},
      status: scenario === 'recover-returned' ? 'verified' : 'writing', serial: usb.serialNumber,
      targetImage: bytes, originalSectors: original, originalSha256: await recoveryHash(original), flashBase: FLASH_BASE,
      verifiedBytes: scenario === 'recover-returned' ? original.length : null};
    const db = createStore('toffee-firmware-recovery-v1', 'backups');
    await del(record.id, db);
    if (scenario === 'recover-legacy') {
      const {version, targetImage, originalSha256, flashBase, ...legacy} = record;
      await set(record.id, legacy, db);
    } else await saveRecovery(record);
    usb.flash.set(eraseImage(uf2Payload(bytes), original));
    if (['recover-partial', 'recover-legacy', 'recover-wrong-serial'].includes(scenario)) usb.flash.fill(255, 4096, original.length);
    if (scenario === 'recover-wrong-serial') usb.serialNumber = 'SIMULATED-OTHER';
    device.booted = scenario !== 'recover-returned';
    device.keymap.fill(0);
    fixture.usbGranted = true;
  }
  createRoot(document.getElementById('root')!).render(<FirmwareUpdate/>);
}
void renderFixture();
window.addEventListener('pagehide', () => {
  sessionStorage.setItem('simulated-updater-device', JSON.stringify({
    flash: btoa(Array.from(usb.flash, b => String.fromCharCode(b)).join('')), booted: device.booted,
    keymap: Array.from(device.keymap), macros: Array.from(device.macros), layout: Array.from(device.layout),
  }));
});
// These links intentionally remain inside the mocked hardware fixture.
document.addEventListener('click', event => {
  const link = (event.target as HTMLElement).closest('a');
  if (link?.getAttribute('href') === '/toffee-firmware/?recovery=1') {
    event.preventDefault(); location.href = '/tests/firmware-update-fixture.html?scenario=resume&recovery=1';
  }
});
// Visible, mock-only evidence for browser review. Never exposes real keymaps.
const evidence = document.createElement('output');
evidence.setAttribute('aria-label', 'Simulated hardware evidence');
evidence.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:100;background:#13251b;color:#d3f9df;padding:6px;font:12px monospace';
document.body.append(evidence);
setInterval(async () => {
  const records = await readRecoveries();
  const record = records[0];
  fixture.savedStatus = record?.status || 'none';
  fixture.originalIntact = record?.originalSectors?.every(v => v === 0x5a) ?? true;
  evidence.textContent = `SIMULATED ONLY · boot=${device.packets.filter(p => p[0] === 9 && p[1] === 0x79).length} · erase=${usb.packets.filter(p => p[8] === 3).length} · reboot=${usb.packets.filter(p => p[8] === 2).length} · backupBeforeErase=${fixture.archiveBeforeErase} · verifiedBeforeReboot=${fixture.verifiedBeforeReboot} · originalIntact=${fixture.originalIntact} · saved=${fixture.savedStatus} · settingsMatch=${device.keymap.every(v => v === 7)} · usbPrompts=${fixture.usbRequests} · hidPrompts=${fixture.hidRequests}`;
}, 250);
