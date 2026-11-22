import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const options = {timeout: 3500, maxBuffer: 1024 * 1024, windowsHide: true};
const moduleId = '1067:626d';
const bootloaderId = '2e8a:0003';

export function parseMacUsb(text) {
  return text.split(/(?=^.*?\+-o )/m).flatMap(entry => {
    const number = (key) => Number(entry.match(new RegExp('^\\s*[| ]*"' + key + '" = (\\d+)\\s*$', 'm'))?.[1]);
    const id = [number('idVendor'), number('idProduct')].map(value => value.toString(16).padStart(4, '0')).join(':');
    if (id !== moduleId && id !== bootloaderId) return [];
    const location = number('locationID');
    const serial = entry.match(/^\s*[| ]*"USB Serial Number" = "([^"]+)"\s*$/m)?.[1];
    return [{id, path: Number.isInteger(location) && location > 0 ? location.toString(16).padStart(8, '0') : null,
      serial: serial ?? null}];
  });
}

function windowsPortPath(paths) {
  const unique = [...new Set(paths.map(path => path.toUpperCase()))];
  if (unique.length <= 1) return unique[0] ?? null;
  // PnP can report both PCI and ACPI names for the same controller and USB chain.
  const pciPaths = unique.filter(path => /^PCIROOT\([0-9A-F]+\)(#PCI\([0-9A-F]+\))+#USBROOT\(/.test(path));
  if (pciPaths.length !== 1) return null;
  const [pciPath] = pciPaths;
  const usbChain = pciPath.match(/#USBROOT\([0-9]+\)(#USB\([0-9]+\))+$/)?.[0];
  if (!usbChain || unique.some(path => path !== pciPath &&
    (!path.startsWith('ACPI(') || path.slice(path.indexOf('#USBROOT(')) !== usbChain))) return null;
  return pciPath;
}

export function parseWindowsUsb(text) {
  const devices = JSON.parse(text);
  if (!Array.isArray(devices)) throw new Error('Unexpected Windows USB inventory.');
  return devices.map(({InstanceId, Paths}) => {
    const match = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\([^\\]+)$/i.exec(InstanceId);
    if (!match) throw new Error('Unexpected USB device instance.');
    return {id: (match[1] + ':' + match[2]).toLowerCase(), path: windowsPortPath(Paths),
      serial: match[3]};
  });
}

export function identifyTarget(os, host, targets, mode) {
  const expected = mode === 'module' ? moduleId : bootloaderId;
  if (!host || targets.length !== 1 || targets[0].id !== expected || !targets[0].path) return null;
  const [device] = targets;
  return {
    location: createHash('sha256').update(JSON.stringify([os, host, device.path])).digest('hex'),
    serial: device.serial ?? null,
  };
}

export function identifyModulePort(os, host, targets) {
  return identifyTarget(os, host, targets, 'module')?.location ?? null;
}

export async function readUsbTarget(mode) {
  if (process.platform === 'darwin') {
    const [host, usb] = await Promise.all([
      exec('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], options),
      exec('/usr/sbin/ioreg', ['-r', '-c', 'IOUSBHostDevice', '-d', '1', '-l', '-w', '0'], options),
    ]);
    const identity = host.stdout.match(/"IOPlatformUUID" = "([0-9a-f-]+)"/i)?.[1];
    return identifyTarget('darwin', identity, parseMacUsb(usb.stdout), mode);
  }
  if (process.platform === 'win32') {
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const command = String.raw`
$ErrorActionPreference = 'Stop'
$targets = @(Get-PnpDevice -PresentOnly | Where-Object {
    $_.InstanceId -match '^USB\\VID_(1067&PID_626D|2E8A&PID_0003)\\'
} | ForEach-Object {
    $path = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_LocationPaths -ErrorAction SilentlyContinue
    @{ InstanceId = $_.InstanceId; Paths = @($path.Data | Where-Object { $_ }) }
})
@{ HostId = (Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid); Targets = $targets } |
    ConvertTo-Json -Depth 5 -Compress
`;
    const {stdout} = await exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], options);
    const {HostId, Targets} = JSON.parse(stdout);
    return identifyTarget('win32', HostId, parseWindowsUsb(JSON.stringify(Targets)), mode);
  }
  return null;
}

export async function readModulePort() {
  return (await readUsbTarget('module'))?.location ?? null;
}
