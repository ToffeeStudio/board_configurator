# Toffee Module Windows Setup

This portable helper makes the Module's RP2040 bootloader available to the
browser firmware updater. It uses the signed WinUSB driver already in Windows.
It does not download a driver, read or write firmware, or change keyboard
settings. Run it once after the Module enters update mode. If Windows has a
working WinUSB binding, setup leaves it alone.

1. Open the Module firmware updater in desktop Chrome or Edge and start the
   update. Wait for **Allow bootloader access**. If you already opened the USB
   chooser and RP2 Boot is missing, cancel it and leave the keyboard plugged in.
2. Run the Toffee Windows Setup download and approve the administrator prompt.
   Keep only the intended RP2 Boot device connected.
3. After setup reports success, return to the same updater tab. Click
   **Allow bootloader access** and choose **RP2 Boot**. If you're on the recovery
   page, retry **Recover keyboard** instead.

The helper requires Windows 10 version 2004 or later or Windows 11. The boot
ROM USB ID is shared with other RP2040 devices, so disconnect any other board
in BOOTSEL before running setup. It targets only `USB\VID_2E8A&PID_0003&MI_01`.
It does not touch the parent USB device, mass-storage interface or normal HID
interfaces. A bound driver other than WinUSB is left alone.

The helper executable is currently unsigned. Windows may warn or block it
under its local policy. The Microsoft driver it selects is Windows-signed.
Microsoft also documents [manual inbox WinUSB setup](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/winusb-installation).

## Build and release

From a Windows developer checkout, run
`powershell -File tools/windows-winusb-setup/build.ps1`. This uses the
.NET Framework compiler included with Windows. The executable requires
elevation through its manifest and can run from the Downloads folder. No
runtime installer, driver package, external downloads or Zadig are needed.

The firmware download allowlist contains the exact binary validated on
Windows. Keep the source, download and recorded SHA-256 together when
updating it. Set a new versioned filename for an updated binary so cached
pages can still use their original download. Production code signing of
the setup executable is separate from the inbox driver and remains pending.
