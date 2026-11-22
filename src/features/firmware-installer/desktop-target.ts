export function requireInstallerTarget(
  mode: ToffeeUsbMode, actual: ToffeeUsbTarget | null,
  location: string | undefined, serial?: string,
): string {
  if (!actual) throw new Error('Connect only the intended device on a recognised USB port.');
  if (location && actual.location !== location) {
    throw new Error('The USB port changed. Reconnect the same keyboard to its original port.');
  }
  if (mode === 'bootloader' && (!serial || actual.serial?.toUpperCase() !== serial.toUpperCase())) {
    throw new Error('The selected RP2 Boot device does not match the USB inventory.');
  }
  return actual.location;
}
