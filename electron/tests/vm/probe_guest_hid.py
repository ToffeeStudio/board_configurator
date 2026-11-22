"""Test the virtual Module through a diskless Alpine guest's native HID driver."""

import argparse
import base64
import json
import os
from pathlib import Path
import re
import select
import socket
import subprocess
from tempfile import TemporaryDirectory
import time


BOARD_ID = bytes.fromhex("11223344556677880000000000000000")
EXPECTED = bytes.fromhex("0003421610682d06") + bytes(18) + bytes.fromhex("a58501000000")


def read_until(process, marker, timeout):
    output = bytearray()
    deadline = time.monotonic() + timeout
    while marker not in output:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([process.stdout], [], [], remaining)[0]:
            raise ValueError(f"Guest never printed {marker!r}: {bytes(output[-2500:])!r}")
        chunk = os.read(process.stdout.fileno(), 4096)
        if not chunk:
            raise ValueError(f"Guest exited before {marker!r}: {bytes(output[-2500:])!r}")
        output += chunk
    return bytes(output)


def send_line(process, command):
    process.stdin.write(command.encode() + b"\r")
    process.stdin.flush()


def command(cmd, stamp, payload=b""):
    packet = bytes([0, 9, cmd, stamp, 0, 0, 0]) + payload
    return base64.b64encode(packet.ljust(33, b"\0")).decode()


def run_probe(process, script, marker):
    encoded = base64.b64encode(script.encode()).decode()
    send_line(process, f"printf '%s\\n' {encoded} | base64 -d > /tmp/toffee-probe.sh; sh /tmp/toffee-probe.sh")
    output = read_until(process, marker, 24)
    if b"localhost:~#" not in output.split(marker)[-1]:
        output += read_until(process, b"localhost:~#", 10)
    return output


def probe(process, port):

    get = command(0x8f, 2)
    set800 = command(0x8f, 3, bytes([1]) + (800).to_bytes(2, "little") + BOARD_ID)
    # Check the device identity and physical port before opening its sole hidraw handle.
    # The first byte of the Linux write buffer is the report ID (0 for an unnumbered report).
    script = f"""set -eu
for i in $(seq 1 12); do
    for node in /sys/class/hidraw/hidraw*; do
        [ -f "$node/device/uevent" ] || continue
        grep -q '^HID_ID=0003:00001067:0000626D$' "$node/device/uevent" || continue
        phys=$(sed -n 's/^HID_PHYS=//p' "$node/device/uevent")
        case "$phys" in *-{port}/input0) break 2;; esac
    done
    sleep 1
done
case "${{phys:-}}" in *-{port}/input0);; *) exit 2;; esac
exec 3<>"/dev/$(basename "$node")"
exchange() {{
    printf '%s\\n' "$1" | base64 -d >&3
    timeout 8 dd bs=32 count=1 <&3 2>/dev/null | hexdump -ve '1/1 "%02x"'
}}
caps=$(exchange {command(0x85, 1)})
budget=$(exchange {get})
raised=$(exchange {set800})
printf 'TOFFEE_PROBE_%s %s %s %s %s\\n' {port} "$phys" "$caps" "$budget" "$raised"
"""
    output = run_probe(process, script, b"TOFFEE_PROBE_" + str(port).encode() + b" ")
    match = re.search(rb"TOFFEE_PROBE_" + str(port).encode() +
                      rb" (\S+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+)", output)
    if not match or bytes.fromhex(match[2].decode()) != EXPECTED:
        raise ValueError(f"Unexpected HID result: {output[-1800:]!r}")
    for reply, ma, stamp in [(match[3], 450, 2), (match[4], 800, 3)]:
        expected = b"\0\1" + ma.to_bytes(2, "little") + (940).to_bytes(2, "little") + BOARD_ID
        expected += bytes(4) + bytes([0xa5, 0x8f, stamp, 0, 0, 0])
        if bytes.fromhex(reply.decode()) != expected:
            raise ValueError(f"Expected the {ma} mA budget response, got {reply!r}")
    return {"port": port, "location": match[1].decode(), "initialMa": 450, "appliedMa": 800}



def probe_rom(process, port, binary, short_read):
    # Keep the serial terminal's line discipline well under its 4 KiB buffer.
    encoded = base64.b64encode(binary.read_bytes()).decode()
    send_line(process, ": > /tmp/toffee-picoboot.b64")
    read_until(process, b"localhost:~#", 8)
    for offset in range(0, len(encoded), 1200):
        send_line(process, f"printf '%s\\n' {encoded[offset:offset + 1200]} >> /tmp/toffee-picoboot.b64")
        read_until(process, b"localhost:~#", 8)
    script = f"""set -eu
base64 -d /tmp/toffee-picoboot.b64 > /tmp/toffee-picoboot
chmod 700 /tmp/toffee-picoboot
for node in /sys/class/hidraw/hidraw*; do
    [ -f "$node/device/uevent" ] || continue
    grep -q '^HID_UNIQ=TOFFEEVM0001$' "$node/device/uevent" || continue
    exec 3<>"/dev/$(basename "$node")"
    printf '%s\\n' {command(0x79, 4)} | base64 -d >&3
    exec 3>&-
    break
done
for i in $(seq 1 12); do
    for usb in /sys/bus/usb/devices/*; do
        [ -f "$usb/serial" ] || continue
        [ "$(cat "$usb/serial")" = TOFFEEVMROM1 ] || continue
        [ "$(cat "$usb/idVendor")" = 2e8a ] && [ "$(cat "$usb/idProduct")" = 0003 ]
        [ "$(cat "$usb/devpath")" = {port} ]
        dev=$(printf '/dev/bus/usb/%03d/%03d' "$(cat "$usb/busnum")" "$(cat "$usb/devnum")")
        result=0
        /tmp/toffee-picoboot "$dev" || result=$?
        if [ "$result" -ne 0 ]; then
            [ "$(cat "$usb/serial")" = TOFFEEVMROM1 ]
        fi
        printf 'TOFFEE_ROM_RESULT %s %s\\n' "$(basename "$usb")" "$result"
        exit "$result"
    done
    sleep 1
done
exit 3
"""
    output = run_probe(process, script, b"TOFFEE_ROM_RESULT ")
    match = re.search(rb"TOFFEE_ROM_RESULT (\S+) (\d+)", output)
    expected = b"24" if short_read else b"0"
    if not match or match[2] != expected:
        raise ValueError(f"PICOBOOT guest probe failed: {output[-1800:]!r}")
    return {"location": match[1].decode(), "vendor": "2e8a:0003",
            "result": "short-read rejected" if short_read else "256-byte read and 4096-byte write verified"}


def wait_for_socket(path, process):
    deadline = time.monotonic() + 15
    while not path.exists():
        if process.poll() is not None or time.monotonic() >= deadline:
            raise ValueError(f"Process did not create its socket at {path}")
        time.sleep(0.05)


def move_device(qmp_path, fixture_path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(8)
        sock.connect(str(qmp_path))
        stream = sock.makefile("rb")
        version = json.loads(stream.readline())["QMP"]["version"]["qemu"]

        deleted = False

        def receive():
            nonlocal deleted
            message = json.loads(stream.readline())
            if message.get("event") == "DEVICE_DELETED" and message["data"].get("device") == "module":
                deleted = True
            return message

        def command(name, **arguments):
            sock.sendall(json.dumps({"execute": name, "arguments": arguments}).encode() + b"\n")
            while True:
                message = receive()
                if "error" in message:
                    raise ValueError(f"{name}: {message['error']}")
                if "return" in message:
                    return

        command("qmp_capabilities")
        command("device_del", id="module")
        while not deleted:
            receive()
        command("chardev-add", id="hid", backend={
            "type": "socket", "data": {"addr": {
                "type": "unix", "data": {"path": str(fixture_path)},
            }, "server": False},
        })
        command("device_add", driver="usb-redir", id="module", chardev="hid", bus="xhci.0", port="2")
        return version


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ["qemu", "bios-dir", "alpine-iso", "kernel", "initrd", "picoboot-probe"]:
        parser.add_argument("--" + arg, required=True, type=Path)
    parser.add_argument("--short-rom-read", action="store_true")
    args = parser.parse_args()
    with TemporaryDirectory(prefix="toffee-guest-", dir="/tmp") as directory:
        scratch = Path(directory)
        fixture_path, qmp_path = scratch / "hid.sock", scratch / "qmp.sock"
        with (scratch / "fixture.log").open("w+") as log:
            fixture = subprocess.Popen(
                ["bun", str(Path(__file__).with_name("module-usb.ts")), str(fixture_path)] +
                (["--short-rom-read"] if args.short_rom_read else []),
                stdout=log, stderr=subprocess.STDOUT,
            )
            guest = None
            try:
                wait_for_socket(fixture_path, fixture)
                guest = subprocess.Popen([
                    str(args.qemu), "-L", str(args.bios_dir), "-machine", "q35", "-m", "768",
                    "-nic", "none", "-display", "none", "-monitor", "none", "-serial", "stdio",
                    "-kernel", str(args.kernel), "-initrd", str(args.initrd),
                    "-append", "console=ttyS0 alpine_dev=sr0 quiet", "-cdrom", str(args.alpine_iso),
                    "-device", "qemu-xhci,id=xhci", "-chardev", f"socket,id=hid,path={fixture_path}",
                    "-device", "usb-redir,id=module,chardev=hid,bus=xhci.0,port=1",
                    "-qmp", f"unix:{qmp_path},server=on,wait=off", "-no-reboot",
                ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                read_until(guest, b"localhost login:", 90)
                send_line(guest, "root")
                read_until(guest, b"localhost:~#", 12)
                addresses = [probe(guest, 1)]
                wait_for_socket(qmp_path, guest)
                version = move_device(qmp_path, fixture_path)
                addresses.append(probe(guest, 2))
                if addresses[0]["location"] == addresses[1]["location"]:
                    raise ValueError("The guest reported the same topology after the port move.")
                rom = probe_rom(guest, 2, args.picoboot_probe, args.short_rom_read)
                recovered = None
                if not args.short_rom_read:
                    recovered = probe(guest, 2)
                    if recovered["location"] != addresses[1]["location"]:
                        raise ValueError("The Module returned on an unexpected guest port.")
                send_line(guest, "poweroff")
                read_until(guest, b"Power down", 30)
                guest.wait(timeout=12)
                print(json.dumps({"qemu": version, "guest": "Alpine x86_64",
                                  "driver": "hid-generic", "port_checks": addresses,
                                  "picoboot": rom, "returned": recovered}))
            except Exception:
                log.seek(0)
                print(log.read(), end="")
                raise
            finally:
                if guest is not None:
                    stop(guest)
                stop(fixture)


if __name__ == "__main__":
    main()
