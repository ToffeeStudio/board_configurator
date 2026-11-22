import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {identifyModulePort, identifyTarget, parseMacUsb, parseWindowsUsb} from '../usb/topology.mjs';

test('USB port, controller and host identity have to match exactly', () => {
  const at = (port, host = 'host A') => identifyModulePort('win32', host, parseWindowsUsb(JSON.stringify([{
    InstanceId: 'USB\\VID_1067&PID_626D\\4&1234&0&1',
    Paths: ['PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(' + port + ')'],
  }])));
  assert.equal(at(1), at(1));
  assert.notEqual(at(1), at(2));
  assert.notEqual(at(1), at(1, 'host B'));
});

test('enumeration fails closed on multiple matches, unknown paths, or a board in bootloader', () => {
  const module = {id: '1067:626d', path: '02010000'};
  assert.ok(identifyModulePort('darwin', 'host', [module]));
  assert.equal(identifyModulePort('darwin', 'host', [module, {...module}]), null);
  assert.equal(identifyModulePort('darwin', 'host', [{...module, path: null}]), null);
  assert.equal(identifyModulePort('darwin', 'host', [module, {id: '2e8a:0003', path: '02020000'}]), null);
  assert.equal(identifyModulePort('darwin', undefined, [module]), null);
});

test('macOS accepts the USB device physical location and ignores unrelated service IDs', () => {
  const input = `+-o Module@02100000  <class IOUSBHostDevice, id 0x100000912>
    {
      "idVendor" = 4199
      "idProduct" = 25197
      "locationID" = 34603008
    }
+-o Some hub@01000000  <class IOUSBHostDevice, id 0x100000913>
    {
      "idVendor" = 1234
      "idProduct" = 12345
      "locationID" = 16777216
    }`;
  assert.deepEqual(parseMacUsb(input), [{id: '1067:626d', path: '02100000', serial: null}]);
});

test('Windows rejects multiple port paths and composite HID interfaces', () => {
  const candidate = {InstanceId: 'USB\\VID_1067&PID_626D\\A', Paths: ['path A', 'path B']};
  assert.deepEqual(parseWindowsUsb(JSON.stringify([candidate])), [{id: '1067:626d', path: null, serial: 'A'}]);
  assert.throws(() => parseWindowsUsb(JSON.stringify([{...candidate, InstanceId: 'USB\\VID_1067&PID_626D&MI_00\\A'}])));
});

test('application and bootloader agree only on the same USB location', () => {
  const module = {id: '1067:626d', path: '02100000'};
  const boot = {id: '2e8a:0003', path: '02100000', serial: 'E0C9125B0D9B'};
  const app = identifyTarget('darwin', 'host', [module], 'module');
  const rp2 = identifyTarget('darwin', 'host', [boot], 'bootloader');
  assert.equal(app.location, rp2.location);
  assert.equal(rp2.serial, boot.serial);
  assert.notEqual(identifyTarget('darwin', 'host', [{...boot, path: '00100000'}], 'bootloader').location, app.location);
  assert.equal(identifyTarget('darwin', 'host', [boot, module], 'bootloader'), null);
  assert.equal(identifyTarget('darwin', 'host', [module], 'bootloader'), null);
});
