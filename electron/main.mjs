import {app, BrowserWindow, dialog, ipcMain, Menu, net, powerMonitor, protocol, Tray} from 'electron';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installFactoryDriver} from './flasher/driver.mjs';
import {configureDevices} from './devices.mjs';
import {appUrl, isAppPage, isInstallerPage, serveRenderer} from './renderer.mjs';
import {readModulePort, readUsbTarget} from './usb/topology.mjs';

protocol.registerSchemesAsPrivileged([{scheme: 'toffee', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
}}]);

let window;
let tray;
let quitting = false;
const {toffeeFactory: factory, productName} = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
const installerUrl = appUrl + '/toffee-firmware/';
const startUrl = factory ? installerUrl + '?new=1' : appUrl + '/';
const qualifyInstaller = factory || app.commandLine.hasSwitch('qualify-usb-installer');
const loginArgs = ['--background'];
const supportsLogin = !factory && (process.platform === 'darwin' || process.platform === 'win32');

function updateTray() {
  if (supportsLogin && app.getLoginItemSettings({args: loginArgs}).openAtLogin) {
    if (tray) return;
    tray = new Tray(join(app.getAppPath(), 'renderer', 'favicon-16x16.png'));
    tray.setToolTip('Toffee Configurator');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label: 'Show Configurator', click: showWindow},
      {role: 'quit'},
    ]));
    tray.on('click', showWindow);
  } else {
    tray?.destroy();
    tray = undefined;
  }
}
function showWindow() {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    title: productName,
    width: factory ? 780 : 1260,
    height: 840,
    minWidth: factory ? 560 : 760,
    minHeight: 540,
    backgroundColor: '#0d0b13',
    show: factory || !app.commandLine.hasSwitch('background'),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [
        ...(qualifyInstaller ? ['--toffee-installer-qualification'] : []),
        ...(factory ? ['--toffee-factory-flasher'] : []),
      ],
      preload: fileURLToPath(new URL('preload.cjs', import.meta.url)),
    },
  });

  const current = window;
  const releaseDevices = configureDevices(current, qualifyInstaller);
  current.webContents.on('will-navigate', (event, url) => {
    if (!(factory ? isInstallerPage(url) : isAppPage(url))) event.preventDefault();
  });
  current.webContents.on('will-prevent-unload', event => {
    const answer = dialog.showMessageBoxSync(current, {
      type: 'warning',
      message: 'Leave the firmware update?',
      detail: 'The update may be interrupted. Your saved backup is available through Recover keyboard.',
      buttons: ['Keep updating', 'Leave update'],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer === 1) event.preventDefault();
  });
  current.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  current.on('close', event => {
    if (tray && !quitting) {
      event.preventDefault();
      current.hide();
    }
  });
  current.on('closed', () => { releaseDevices(); window = undefined; });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{role: 'appMenu'}] : []),
    ...(factory ? [{label: 'Flasher', submenu: [{role: 'quit'}]}] : [{label: 'Configurator', submenu: [
      {label: 'Keyboard', click: () => current.loadURL(appUrl + '/')},
      {label: 'Firmware update', click: () => current.loadURL(appUrl + '/toffee-firmware/')},
      ...(supportsLogin && app.isPackaged ? [{
        label: 'Start at login and stay in the tray',
        type: 'checkbox',
        checked: app.getLoginItemSettings({args: loginArgs}).openAtLogin,
        click: item => {
          app.setLoginItemSettings({openAtLogin: item.checked, args: loginArgs});
          updateTray();
        },
      }] : []),
      {type: 'separator'}, {role: 'quit'},
    ]}]),
    {role: 'editMenu'},
    {role: 'viewMenu'},
  ]));
  void current.loadURL(startUrl).catch(error => console.error('Could not start configurator:', error));
}

const customProfile = app.commandLine.getSwitchValue('user-data-dir');
if (customProfile) app.setPath('userData', customProfile);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('before-quit', () => { quitting = true; });
  ipcMain.handle('toffee:installer-target', (event, mode) => {
    if (!qualifyInstaller || !window || event.senderFrame !== window.webContents.mainFrame ||
        !isInstallerPage(event.senderFrame.url) || (mode !== 'module' && mode !== 'bootloader')) {
      throw new Error('USB installer qualification is unavailable.');
    }
    return readUsbTarget(mode);
  });
  ipcMain.handle('toffee:installer-driver', (event, location) => {
    if (!factory || process.platform !== 'win32' || !window ||
        event.senderFrame !== window.webContents.mainFrame || !isInstallerPage(event.senderFrame.url) ||
        (location !== null && (typeof location !== 'string' || !/^[0-9a-f]{64}$/.test(location)))) {
      throw new Error('Windows USB driver setup is unavailable.');
    }
    return installFactoryDriver(location);
  });
  ipcMain.handle('toffee:module-port', event => {
    if (factory || !window || event.senderFrame !== window.webContents.mainFrame || !isAppPage(event.senderFrame.url)) {
      throw new Error('USB location is available to the local configurator.');
    }
    return readModulePort();
  });
  app.on('second-instance', () => { if (app.isReady()) showWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(() => {
    protocol.handle('toffee', request => serveRenderer(request, join(app.getAppPath(), 'renderer'), url => net.fetch(url)));
    app.on('activate', showWindow);
    if (!factory) powerMonitor.on('suspend', () => window?.webContents.send('toffee:power-change', true));
    if (!factory) powerMonitor.on('resume', () => window?.webContents.send('toffee:power-change', false));
    if (app.isPackaged) updateTray();
    showWindow();
  }).catch(error => {
    console.error('Could not start configurator:', error);
    app.exit(1);
  });
}
