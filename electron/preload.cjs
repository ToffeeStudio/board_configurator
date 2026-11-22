const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('toffeeDesktop', Object.freeze({
  platform: process.platform,
  factory: process.argv.includes('--toffee-factory-flasher'),
  installUsbDriver: location => ipcRenderer.invoke('toffee:installer-driver', location),
  qualifyInstaller: process.argv.includes('--toffee-installer-qualification'),
  installerTarget: mode => ipcRenderer.invoke('toffee:installer-target', mode),
  modulePort: () => ipcRenderer.invoke('toffee:module-port'),
  onPowerChange: listener => {
    ipcRenderer.on('toffee:power-change', (_event, asleep) => listener(asleep));
  },
}));
