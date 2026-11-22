# Factory flasher

This standalone Electron build opens the shared Module installer directly.
Its renderer includes the existing firmware updater, backup and recovery UI.
The package offers the Normal 940 mA production image and its verified UF2.
It omits the keyboard configuration screens, desktop power profiles and tray.

From the configurator root, after installing locked dependencies:

```sh
bun run --cwd electron package:factory --platform win32 --arch x64
```

The portable Windows application lives under `electron/.build/packages/`.
Zip the whole application folder with [the operator instructions](README.txt).
The Windows package includes the existing Toffee Windows Setup helper as a
separate resource. Clicking its setup button requests administrator access
for that helper after checking the active RP2 location.

For a local Mac test:

```sh
bun run --cwd electron package:factory --platform darwin --arch arm64
bun run --cwd electron test:factory
```

The packaged test uses a simulated Module and RP2 bootloader. The factory's
first physical check should exercise a blank board, confirm firmware startup,
and verify any Windows driver setup needed on the actual station.
