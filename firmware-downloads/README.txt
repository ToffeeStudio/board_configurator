Toffee Module firmware / macOS native updater

Close all configurator tabs, rescue loops and other HID clients. Connect only
the intended Module. Unlimited variants can overload the board: watch the
physical meter. The 940 mA limit is an ESTIMATE, not an onboard current sensor.

Choices:
normal.uf2: normal profile9, 940 mA estimate limit, front/badge rescaled to200,
  normal saves and 1-second dark startup followed by 1-second fade.
manual.uf2: manual build0x26101002/profile0x8006; no output/current cap or timeout,
  starts dark, test changes not saved, older informational estimator.
current-unlimited.uf2: normal profile10, current limit removed ONLY; keeps
  front/badge200, normal saves and startup. Saved high output can return!

Browser:
Use a desktop WebHID-capable browser on HTTPS or localhost. Choose a version,
download the private VIA backup, enter bootloader, and copy the selected UF2
to the RPI-RP2 drive. Reconnect on the update page and verify/restore VIA.
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
  normal.uf2: af994d79b5215235ad269ce759b82865f7c45ac0
  manual.uf2: 5b96a707636bb8ec70a2ba831da1b6eec382d7c6
  current-unlimited.uf2: d94f43ae6e9c712c8f6e77a9ef8ed03f5469a9bf
  bundled Python updater: d94f43ae6e9c712c8f6e77a9ef8ed03f5469a9bf

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
