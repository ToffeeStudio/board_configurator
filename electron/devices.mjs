import {dialog} from 'electron';
import {isAppPage, isInstallerPage} from './renderer.mjs';

const isModule = d => d.vendorId === 0x1067 && d.productId === 0x626d;
const isRp2 = d => d.vendorId === 0x2e8a && d.productId === 0x0003;

export function configureDevices(window, qualifyInstaller) {
  const {webContents} = window;
  const {session} = webContents;
  let bootloaderGrant;
  const allowed = (contents, permission, origin) => contents === webContents && isAppPage(origin) &&
    (permission === 'hid' || permission === 'usb' && qualifyInstaller && isInstallerPage(webContents.getURL()));
  session.setPermissionCheckHandler(allowed);
  session.setDevicePermissionHandler(({deviceType, origin, device}) => {
    if (!isAppPage(origin)) return false;
    if (deviceType === 'hid') return isModule(device);
    return deviceType === 'usb' && qualifyInstaller && isInstallerPage(webContents.getURL()) &&
      isRp2(device) && Boolean(bootloaderGrant) && device.deviceId === bootloaderGrant;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed(contents, permission, details.requestingUrl));
  });

  const select = (kind, match) => async (event, details, callback) => {
    event.preventDefault();
    const frame = details.frame;
    if (!frame || frame !== webContents.mainFrame || !allowed(webContents, kind, frame.url)) {
      callback();
      return;
    }
    if (kind === 'usb') bootloaderGrant = undefined;
    const candidates = details.deviceList.filter(match);
    if (candidates.length > 1) {
      await dialog.showMessageBox(window, {
        type: 'warning',
        message: 'More than one matching USB device is connected.',
        detail: 'Disconnect the other devices and try again.',
      });
    }
    const id = candidates.length === 1 ? candidates[0].deviceId : undefined;
    if (kind === 'usb') bootloaderGrant = id;
    callback(id);
  };

  const hid = select('hid', isModule);
  const usb = select('usb', isRp2);
  session.on('select-hid-device', hid);
  session.on('select-usb-device', usb);
  return () => {
    session.off('select-hid-device', hid);
    session.off('select-usb-device', usb);
  };
}
