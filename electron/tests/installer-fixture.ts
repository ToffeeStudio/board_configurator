import {FirmwareFakeDevice} from '../../tests/firmware-fake-device';
import {FirmwareFakeUSB} from '../../tests/firmware-fake-usb';

const device = new FirmwareFakeDevice();
const factory = Boolean(window.toffeeDesktop?.factory);
device.booted = factory && new URLSearchParams(location.search).has('new');
let granted = false;
const usb = new FirmwareFakeUSB(() => {
  device.booted = false;
  device.profile = factory ? 13 : 15;
  device.boardLimitMa = factory ? 940 : 450;
  // Prove the installer restores settings even when the updated firmware changed them.
  device.keymap.fill(0);
});
Object.defineProperty(navigator, 'hid', {value: {
  requestDevice: async () => [device],
  getDevices: async () => device.booted ? [] : [device],
}});
Object.defineProperty(navigator, 'usb', {value: {
  requestDevice: async () => {
    if (!device.booted) throw new Error('RP2 Boot is not connected.');
    granted = true;
    return usb;
  },
  getDevices: async () => device.booted && granted ? [usb] : [],
}});
Object.assign(window, {
  readInstallerFixture: () => ({
    erases: usb.packets.filter(packet => packet[8] === 3).length,
    usbPackets: usb.packets.length,
    settingsWrites: device.packets.filter(packet => [0x13, 0x0f, 0x03].includes(packet[0])).length,
    settingsMatch: device.keymap.every(value => value === 7),
  }),
});
