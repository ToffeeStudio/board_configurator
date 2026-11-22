# Native USB VM fixture

`module-usb.ts` emulates the Module on a private Unix socket using
[USB redirection](https://www.spice-space.org/usbredir.html). It uses the same
fake HID and PICOBOOT state as the updater tests. It exposes a vendor HID
interface in application mode and the RP2040 layout of MSC interface 0
and PICOBOOT interface 1 in bootloader mode. The drive reports no media.
The serial strings are synthetic. There is no host USB or disk passthrough.

`probe_guest_hid.py` boots a diskless, offline Alpine x64 guest and runs through
the guest's own HID and USBFS drivers. It verifies a correlated HID report and
a 450 → 800 mA request on two distinct virtual ports, reads 256 simulated bytes
and verifies one 4096-byte sector write over PICOBOOT. It then checks that the application returns on the original
bootloader port with the 450 mA default. `--short-rom-read` injects a one-byte
short read and checks that the driver probe refuses to reboot the device.

Use Bun, Python 3, and a QEMU build that lists `usb-redir` in `-device help`.
The standard Homebrew QEMU used for initial verification lacked that feature.
The local lab used upstream QEMU 11.1.3, configured with
`--target-list=x86_64-softmmu --without-default-features --enable-tcg --enable-usb-redir --disable-docs`,
and verified the release archive against Homebrew's published checksum.
On macOS the build uses Homebrew's `usbredir`, `ninja`, and the normal QEMU
build dependencies.

Get an official Alpine Virt x64 ISO and its SHA-256 from the
[Alpine release directory](https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/).
Verify the ISO and extract `boot/vmlinuz-virt` and `boot/initramfs-virt` from it.
Build the guest probe with Clang and an ELF linker. For example,
from the configurator checkout on macOS with a Rust toolchain:

```sh
lab=$(mktemp -d)
rust_host=$(rustc -vV | sed -n 's/^host: //p')
rust_lld="$(rustc --print sysroot)/lib/rustlib/$rust_host/bin/rust-lld"
clang -target x86_64-linux-gnu -ffreestanding -fno-stack-protector -fno-pic \
  -fno-asynchronous-unwind-tables -Os -c electron/tests/vm/probe_picoboot.c \
  -o "$lab/probe_picoboot.o"
"$rust_lld" -flavor gnu -static -s -o "$lab/probe_picoboot" "$lab/probe_picoboot.o"

python3 electron/tests/vm/probe_guest_hid.py \
  --qemu /path/to/qemu-system-x86_64 --bios-dir /path/to/qemu/pc-bios \
  --alpine-iso /path/to/alpine-virt.iso --kernel /path/to/vmlinuz-virt \
  --initrd /path/to/initramfs-virt --picoboot-probe "$lab/probe_picoboot"
```

For a Windows guest, start the same fixture with
`bun electron/tests/vm/module-usb.ts /path/to/private/hid.sock` on the VM host.
Attach the socket to a QEMU xHCI USB bus using
`-chardev socket,id=hid,path=/path/to/private/hid.sock` and
`-device usb-redir,id=module,chardev=hid,bus=xhci.0,port=1`, where QEMU has
`-device qemu-xhci,id=xhci`. Run inside a disposable Windows x64 guest with
a snapshot. Confirm the synthetic serial and native USB location before
testing, then verify the WinUSB binding for the PICOBOOT interface with
the existing Windows setup tool. The packaged Windows tests cover application behavior with injected fixtures.
The GitHub job is pending the repository login’s workflow permission. Windows native USB qualification
requires the separate guest with this external device attached.
