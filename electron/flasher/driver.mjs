import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {installerWindowsTimeoutMs, readUsbTarget} from '../usb/topology.mjs';

const exec = promisify(execFile);
const setup = 'toffee-windows-setup-v1.exe';

export async function installFactoryDriver(location) {
  const target = await readUsbTarget('bootloader', installerWindowsTimeoutMs);
  if (!target || (location && location !== target.location)) {
    throw new Error('Connect only the intended board in BOOTSEL on its original USB port.');
  }

  const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = String.raw`
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath $env:TOFFEE_USB_SETUP -ArgumentList '--quiet' -Verb RunAs -Wait -PassThru
exit $process.ExitCode
`;
  try {
    await exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      env: {...process.env, TOFFEE_USB_SETUP: join(process.resourcesPath, setup)},
      windowsHide: true,
      timeout: 120_000,
    });
  } catch (error) {
    if (error.code === 3010) return 'Restart Windows to finish USB driver setup, then reopen the flasher.';
    throw new Error('Windows could not complete USB driver setup. Keep RP2 Boot connected and approve the administrator prompt.');
  }
  return 'USB driver ready. Continue flashing the same board.';
}
