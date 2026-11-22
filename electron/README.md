# Toffee desktop configurator

For the standalone Normal 940 mA production flasher, see [Factory flasher](flasher/README.md).

The desktop package uses the same Vite build as the web app. `electron/` owns
the window, tray, local asset origin and native USB topology check.
`src/features/firmware-installer/` owns the shared update, backup and recovery
flow. `firmware-downloads/` contains the existing release assets.

From the repository root, with Node 22 or newer and Bun:

```sh
bun install --frozen-lockfile
bun install --cwd electron --frozen-lockfile
bun run build
bun run --cwd electron package
bun run --cwd electron test
```

The native package is written to `electron/.build/packages/`. The preview
package is unsigned. Electron's archive is checked against the hashes in the
pinned Electron npm package before packaging.

The desktop Lighting panel can remember an estimated USB budget on an exact
computer, USB location and Module identity. Profile 16 is an experimental
firmware build with a 450 mA default and a five-second RAM-only override lease.
It is built in the firmware repository with
`make toffee_studio/module:via -j1 MODULE_DESKTOP_BUDGET=yes`. The four public
firmware images are unchanged. Desktop flashing stays disabled by default.
Qualification builds launched with `--qualify-usb-installer` check that the
only supported device stays on the original USB location before bootloader
entry, before erasing, and before restoring settings. Use one physical
keyboard throughout an update. RP2040 ROM serials identify a ROM build and
cannot distinguish two boards with that ROM at the same USB socket.

**Start at login and stay in the tray** keeps the app available to restore
opted-in profiles. A saved budget represents the current the user verified on
that setup. A USB port path cannot establish how much power it supplies.

## Qualification

- **Local automation.** Run `bun test` with the firmware checkout beside the
  configurator, and `node --test electron/tests/topology.unit.mjs`. These cover
  updater recovery, topology parsing, ambiguous devices and cancelled writes.
- **Packaged test.** Playwright launches the native executable, checks the local
  origin and release asset hashes, restarts with the same private profile, and
  moves a simulated HID board between two ports. Installer qualification
  fixtures exercise both a verified update and rejection of a changed USB
  location before erase.
- **Windows VM.** Run the packaged application tests on a fresh Windows x64
  runner with application fixtures. The GitHub workflow is pending the
  repository login’s workflow permission.
  The [native USB VM fixture](tests/vm/README.md) also provides a virtual
  Module and RP2 bootloader over QEMU USB redirection. The diskless Alpine
  probe exercises real guest drivers, port changes and PICOBOOT read/write verification.
  Use the same fixture for the dedicated Windows guest qualification.
- **One physical qualification session.** Confirm the installed firmware and
  back up settings. Compare native port identity on replug and reboot, then a
  different port and a hub. Check the conservative default, the verified
  same-port override, and the lease expiring during app loss. Verify firmware
  recovery and compare the settings readback. Record current measurements with
  the physical meter. Use automatic logs for the software steps.
