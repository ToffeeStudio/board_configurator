import {createRoot} from 'react-dom/client';
import {FirmwareUpdate} from '../src/components/panes/firmware-update';
import {FirmwareFakeDevice} from './firmware-fake-device';
import {FirmwareFakeUSB} from './firmware-fake-usb';
import {readRecoveries} from '../src/utils/toffee_studio/firmware-recovery';
const device = new FirmwareFakeDevice();
const fixture = {usbGranted: false, hidAfterReboot: true, rebooted: false, cancelUSB: false, usbRequests: 0, hidRequests: 0,
  archiveBeforeErase: true};
const usb = new FirmwareFakeUSB(() => {
  fixture.rebooted = true;
  device.booted = false;
  device.keymap.fill(0);
  device.mode = (document.querySelector('select[aria-label="Firmware version"]') as HTMLSelectElement).value;
  device.profile = {normal: 9, manual: 0x8006, 'current-unlimited': 10}[device.mode as 'normal'];
  device.lightingProtocol = device.mode === 'manual' ? 2 : 3;
});
const transfer = usb.transferOut.bind(usb);
usb.transferOut = async (endpoint, bytes) => {
  if (bytes.length === 32 && bytes[8] === 3) {
    const saved = await readRecoveries();
    fixture.archiveBeforeErase &&= saved.some(record => record.status === 'writing' && record.serial === usb.serialNumber && record.originalSectors!.length > 0);
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
createRoot(document.getElementById('root')!).render(<FirmwareUpdate/>);
