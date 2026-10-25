Toffee Module firmware / macOS native updater

Close all configurator tabs, rescue loops and other HID clients. Connect only
the intended Module. Unlimited variants can overload the board: watch the
physical meter. The 940 mA limit is an ESTIMATE, not an onboard current sensor.

Choices:
The two normal variants use the current estimate fitted specifically to repaired
PCB-B:75 mA baseline and nine RGB coefficients. This is not a universal A/B fit.
They include lighting-v3:45 front options and independent badge animations.
Earlier normal profile11 was flashed on22 October, then validated against100 additional
held lighting profiles (500 manually read meter photos; mean absolute error
16.10 mA). Controlled interrupted-update recovery, settings and reconnect checks
passed. Physical cold-power, sleep/wake and electrical/thermal checks remain open.
The current profiles13/14 lower the shared front/badge output cap from200 to190
at Ethan's request, with the same estimator coefficients and940mA normal limit.
Both new images are build/host-tested; no new physical flash was performed.
Both normal variants now also support a firmware-level lighting reset: hold
both physical Shift switches before plugging in. All three brightness settings
are saved as zero before lighting starts; colours/effects, per-key overrides,
VIA keymaps and macros are preserved. VIA remapping cannot disable this chord.
Hold Escape at startup for the existing EEPROM reset and bootloader entry.
The new Shift shortcut needs intact running application firmware; interrupted
firmware flashing still uses the separate bootloader recovery procedure below.
The manual measurement image is unchanged.
normal.uf2: normal profile13, 940 mA estimate limit, front/badge rescaled to190,
  normal saves and 1-second dark startup followed by 1-second fade.
manual.uf2: manual build0x26101002/profile0x8006; no output/current cap or timeout,
  starts dark, test changes not saved, older informational estimator.
current-unlimited.uf2: normal profile14, current limit removed ONLY; keeps
  front/badge190, normal saves and startup. Saved high output can return!

Browser:
Use desktop Chrome/Edge with WebHID and WebUSB on HTTPS or localhost. Choose a
version and press Update firmware. Approve Module and RP2 Boot when prompted.
The page backs up locally, enters bootloader, writes via PICOBOOT, reads back
every affected byte, reboots and verifies/restores VIA. No manual UF2 copying
or Python installation is needed. A reconnect permission may be required.
Recovery settings and original affected sectors are stored in this browser's
IndexedDB, never uploaded. Download them optionally; clearing site data removes
them. They are not a full-device dump. Failed backup prevents writing; uncertain
writes are not retried automatically. Actual browser recovery on22 October
completed after early, halfway and near-end software USB interruptions, including
reconnect/settings verification. Those tests did not remove electrical power.
Physical boot/reset can enter bootloader if application HID is unresponsive.
Do not confuse firmware download or bootloader entry with a completed flash.

Native updater (macOS only; dependencies are not bundled):
  brew install hidapi libusb
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
  .venv/bin/python flash_module.py --help

Both Python files must stay together. 'hid' is the ctypes package, NOT 'hidapi'.
Freshly identify the physical USB location and expected RP2 bootloader serial.
Do NOT copy someone else's location/serial from old logs. The updater requires
these explicitly and validates them again before any write:
  .venv/bin/python flash_module.py normal.uf2 --usb-location 0xYOUR_LOCATION \
    --bootloader-serial YOUR_VERIFIED_SERIAL --boot-drive /Volumes/RPI-RP2 \
    --recovery-dir ./recovery --start-mode application --check
Remove --check only when ready to flash. See --help for already-bootloader mode;
it requires a previously captured module-settings.json backup.

To inspect current macOS application interfaces without writing:
  .venv/bin/python -c "import flash_module; print(flash_module.registry_locations())"
Use macOS System Information > USB / ioreg to inspect bootloader identity at
the same physical connection. If identity is unknown, use manual UF2 copying
with only the intended RP2 connected rather than inventing values.

The updater archives the selected candidate and private VIA settings before
booting, validates UF2, copies once, then verifies VIA settings and 15s uptime.
No full-flash readback/attestation is provided. Normal lighting/overrides remain
in on-board storage; the VIA JSON covers only keymap, macros and layout.
Never publish private backups: macros may contain personal text.
On a copy failure STOP: don't loop/retry writes blindly. Keep the recovery copy.

SHA256 values are in manifest.json. GPL license is included. Complete firmware
source is available in https://github.com/ToffeeStudio/qmk_firmware on the
screenless-pcb branch. Exact corresponding source checkpoints:
  normal.uf2: e66f75d5c902a183141da26d86e0f4f777a63653
  manual.uf2: 5b96a707636bb8ec70a2ba831da1b6eec382d7c6
  current-unlimited.uf2: e66f75d5c902a183141da26d86e0f4f777a63653
  bundled Python updater: e66f75d5c902a183141da26d86e0f4f777a63653
The matching source checkpoints must be available on screenless-pcb before
publishing these binaries. Private settings and recovery images are not bundled.

Clone the complete repository, including its pinned submodules:
  git clone --recursive https://github.com/ToffeeStudio/qmk_firmware.git
  cd qmk_firmware
Check out the corresponding commit above, then initialise its exact submodules:
  git checkout CORRESPONDING_COMMIT
  git submodule update --init --recursive
Install QMK's build dependencies as described in docs/getting_started_build_tools.md.
These commands build only; they do not flash or change a connected board:
  normal: make toffee_studio/module:via -j1
  manual: make toffee_studio/module:via -j1 MODULE_EXTENSIVE_TEST=yes MODULE_POWER_CALIBRATION=yes MODULE_MANUAL_MEASUREMENT=yes MODULE_TEST_BUILD_ID=0x26101002
  current-unlimited: make toffee_studio/module:via -j1 MODULE_CURRENT_UNLIMITED=yes
Output: toffee_studio_module_via.uf2. Read the Module rules.mk and board README
for build contracts and experimental-mode limitations. Source and library
licenses are retained in the source repository; do not redistribute binaries
without retaining access to their corresponding source and these instructions.
