#!/usr/bin/env python3
"""Copy a validated UF2 onto one RP2 drive and verify the returning Module."""

import argparse
import hashlib
import json
import os
import plistlib
from pathlib import Path
import signal
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4

import hid
import usb.core
import usb.util

from led_discovery import PACKET_SIZE, PID, RAW_USAGE, RAW_USAGE_PAGE, VID

BOOT_COMMAND = 0x79


def validate_uf2(firmware):
    data = firmware.read_bytes()
    if not data or len(data) % 512:
        raise ValueError("Provide a nonempty RP2040 UF2 file with complete 512-byte blocks.")
    blocks = len(data) // 512
    for i in range(blocks):
        block = data[i * 512:(i + 1) * 512]
        magic0, magic1, flags, address, size, number, total, family = struct.unpack_from("<8I", block)
        if (magic0, magic1) != (0x0A324655, 0x9E5D5157) or struct.unpack_from("<I", block, 508)[0] != 0x0AB16F30:
            raise ValueError("Invalid UF2 block magic.")
        if flags != 0x2000 or family != 0xE48BFF56 or size != 256 or number != i or total != blocks:
            raise ValueError("Require sequential RP2040 flash blocks with 256-byte payloads.")
        if address != 0x10000000 + i * 256:
            raise ValueError("Require a complete Module image starting at RP2040 flash address 0x10000000.")
    return hashlib.sha256(data).hexdigest()


def run_bounded(command, timeout):
    """A stuck macOS volume can leave even a killed child in kernel I/O wait."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as error:
        os.killpg(process.pid, signal.SIGKILL)
        # Do not use subprocess.run's unbounded wait after killing a stuck child.
        try:
            process.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            process.stdout.close()
        raise TimeoutError(f"Timed out after {timeout}s: {command[0]}; drive I/O may be stalled.") from error
    if process.returncode:
        raise ValueError(f"Command failed ({process.returncode}): {command[0]}: {output.strip()}")
    return output


def registry_locations():
    registry = plistlib.loads(subprocess.check_output(
        ["/usr/sbin/ioreg", "-r", "-c", "IOHIDDevice", "-a", "-l"], timeout=5))
    roots = registry if type(registry) is list else [registry]
    locations = {}
    def visit(node):
        if node.get("VendorID") == VID and node.get("ProductID") == PID:
            locations[("DevSrvsID:" + str(node["IORegistryEntryID"])).encode()] = node["LocationID"]
        for child in node.get("IORegistryEntryChildren", []):
            visit(child)
    for root in roots:
        visit(root)
    return locations


def target_interfaces(location):
    locations = registry_locations()
    return [info for info in hid.enumerate(VID, PID) if locations.get(info["path"]) == location]


def find_target(location):
    raw = [info for info in target_interfaces(location)
           if info["usage_page"] == RAW_USAGE_PAGE and info["usage"] == RAW_USAGE]
    if len(raw) != 1:
        raise ValueError(f"Require exactly one Module raw HID interface at USB location 0x{location:08x}.")
    return raw[0]


def bootloader(serial, location):
    devices = list(usb.core.find(find_all=True, idVendor=0x2E8A, idProduct=0x0003))
    if len(devices) != 1 or devices[0].serial_number != serial:
        raise ValueError(f"Require exactly one RP2 bootloader, serial {serial}.")
    registry = plistlib.loads(subprocess.check_output(["/usr/sbin/ioreg", "-p", "IOUSB", "-a", "-l"], timeout=5))
    found = []
    def visit(node):
        if node.get("idVendor") == 0x2E8A and node.get("idProduct") == 3:
            found.append(node)
        for child in node.get("IORegistryEntryChildren", []): visit(child)
    visit(registry)
    if len(found) != 1 or found[0]["locationID"] != location:
        raise ValueError("RP2 bootloader appeared at the wrong physical USB connection.")
    return devices[0]


def inspect_drive(drive):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        mounts = run_bounded(["/sbin/mount"], 5)
        if f" on {drive} (msdos," in mounts:
            break
        time.sleep(0.2)
    else:
        raise ValueError(f"Expected a mounted FAT bootloader drive at {drive} within 20 seconds.")
    info = run_bounded(["/bin/cat", str(drive / "INFO_UF2.TXT")], 5)
    if "Board-ID: RPI-RP2" not in info.splitlines():
        raise ValueError("The selected drive is not an RP2040 RPI-RP2 bootloader.")


def prepare_drive(drive, serial, location):
    bootloader(serial, location)
    try:
        inspect_drive(drive)
        return False
    except TimeoutError:
        print("Drive read stalled; resetting this bootloader's USB connection before copying.", flush=True)
        device = bootloader(serial, location)
        device.reset()
        usb.util.dispose_resources(device)
        time.sleep(1)
        bootloader(serial, location)
        inspect_drive(drive)
        return True


def via_command(device, code, payload=b""):
    packet = bytes([code]) + payload
    device.write(b"\x00" + packet.ljust(PACKET_SIZE, b"\x00"))
    response = device.read(PACKET_SIZE, timeout=2000)
    if len(response) != PACKET_SIZE or response[0] != code:
        raise ValueError(f"Invalid VIA response to 0x{code:02x}.")
    return response


def read_buffer(device, code, size):
    result = bytearray()
    for offset in range(0, size, 28):
        count = min(28, size - offset)
        response = via_command(device, code, offset.to_bytes(2, "big") + bytes([count]))
        result.extend(response[4:4 + count])
    return bytes(result)


def read_settings(device):
    layers = via_command(device, 0x11)[1]
    macro_size = int.from_bytes(via_command(device, 0x0D)[1:3], "big")
    return {
        "layers": layers,
        "keymap": read_buffer(device, 0x12, layers * 9 * 8 * 2).hex(),
        "macros": read_buffer(device, 0x0E, macro_size).hex(),
        "layout": via_command(device, 0x02, b"\x02")[2:6].hex(),
    }


def restore_settings(device, saved):
    current = read_settings(device)
    if current["layers"] != saved["layers"] or len(current["macros"]) != len(saved["macros"]):
        raise ValueError("New firmware's keymap/macro capacity differs; saved settings were not written.")
    for name, code in (("keymap", 0x13), ("macros", 0x0F)):
        if current[name] == saved[name]:
            continue
        print(f"Restoring {name} from the pre-flash snapshot.", flush=True)
        data = bytes.fromhex(saved[name])
        for offset in range(0, len(data), 28):
            chunk = data[offset:offset + 28]
            via_command(device, code, offset.to_bytes(2, "big") + bytes([len(chunk)]) + chunk)
    if current["layout"] != saved["layout"]:
        via_command(device, 0x03, b"\x02" + bytes.fromhex(saved["layout"]))
    actual = read_settings(device)
    if any(actual[key] != saved[key] for key in actual):
        raise ValueError("Keymap/macro/layout readback did not match the saved settings.")


def wait_for_module(location):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        interfaces = target_interfaces(location)
        raw = [d for d in interfaces if d["usage_page"] == RAW_USAGE_PAGE and d["usage"] == RAW_USAGE]
        keyboard = [d for d in interfaces if d["usage_page"] == 1 and d["usage"] == 6]
        if len(raw) > 1:
            raise ValueError("Multiple Module keyboards are connected.")
        if raw and keyboard:
            return raw[0]
        time.sleep(0.2)
    raise ValueError("Copy finished, but both Module keyboard and raw HID interfaces did not return.")


def verify_stability(device):
    if via_command(device, 0x01)[1:3] != b"\x00\x0c":
        raise ValueError("Unexpected VIA protocol version.")
    previous = -1
    for sample in range(16):
        if list(usb.core.find(find_all=True, idVendor=0x2E8A, idProduct=0x0003)):
            raise ValueError("An RP2 bootloader is still present after flashing.")
        response = via_command(device, 0x02, b"\x01")
        if response[1] != 1:
            raise ValueError("Invalid VIA uptime reply.")
        uptime = int.from_bytes(response[2:6], "big")
        if uptime <= previous:
            raise ValueError("Keyboard rebooted during the stability check.")
        previous = uptime
        if sample % 5 == 0:
            print(f"Keyboard responding: uptime {uptime}ms.", flush=True)
        if sample < 15:
            time.sleep(1)


def flash_module(firmware, drive, serial, location, recovery_dir, start_mode, settings_backup, check):
    if sys.platform != "darwin" or drive.parent != Path("/Volumes"):
        raise ValueError("Provide the macOS bootloader drive directly beneath /Volumes.")
    digest = validate_uf2(firmware)
    print(f"Validated {firmware.name}; SHA256 {digest}", flush=True)
    if start_mode == "bootloader":
        if settings_backup is None:
            raise ValueError("Bootloader recovery requires --settings-backup from before flashing.")
        saved = json.loads(settings_backup.read_text())
        for key in ("layers", "keymap", "macros", "layout"):
            if key not in saved:
                raise ValueError(f"Settings backup is missing {key}.")
        if len(bytes.fromhex(saved["keymap"])) != saved["layers"] * 9 * 8 * 2 or len(bytes.fromhex(saved["layout"])) != 4:
            raise ValueError("Settings backup has invalid keymap/layout lengths.")
        bytes.fromhex(saved["macros"])
        bootloader(serial, location)
    else:
        if list(usb.core.find(find_all=True, idVendor=0x2E8A, idProduct=0x0003)):
            raise ValueError("Board is in bootloader mode; use explicit bootloader recovery mode.")
        device_info = find_target(location)
        with hid.Device(path=device_info["path"]) as device:
            saved = read_settings(device)
    if check:
        if start_mode == "bootloader":
            inspect_drive(drive)
        print("Preflight passed. No USB reset, reboot, copy or lighting command sent.", flush=True)
        return

    recovery_dir.mkdir(parents=True, exist_ok=True)
    run_dir = recovery_dir / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8])
    run_dir.mkdir()
    archive = run_dir / (digest + ".uf2")
    with archive.open("xb") as output:
        output.write(firmware.read_bytes())
        output.flush()
        os.fsync(output.fileno())
    archive.chmod(0o444)
    if validate_uf2(archive) != digest:
        raise ValueError("Firmware changed during archiving; no flashing performed.")
    snapshot = run_dir / "module-settings.json"
    with os.fdopen(os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
        output.write(json.dumps(saved, indent=2) + "\n")
    report = {"firmware": str(archive), "sha256": digest, "drive": str(drive),
              "bootloader_serial": serial, "usb_location": f"0x{location:08x}", "stage": "archived", "usb_reset_before_copy": False,
              "human_typing_and_lighting_confirmation": "pending"}
    print(f"Preserved firmware and settings in {run_dir}", flush=True)
    try:
        if start_mode == "application":
            report["stage"] = "entering_bootloader"
            with hid.Device(path=device_info["path"]) as device:
                device.write(b"\x00\x09" + bytes([BOOT_COMMAND]) + bytes(PACKET_SIZE - 2))
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if list(usb.core.find(find_all=True, idVendor=0x2E8A, idProduct=0x0003)):
                    break
                time.sleep(0.2)
            else:
                raise ValueError("RP2 bootloader did not appear within 20 seconds.")
            # macOS needs time to mount the newly enumerated mass-storage interface.
            time.sleep(2)
        report["stage"] = "checking_drive"
        report["usb_reset_before_copy"] = prepare_drive(drive, serial, location)
        bootloader(serial, location)
        report["stage"] = "copying_uf2"
        print(f"Copying {archive.name} to {drive / 'MODULE.UF2'}", flush=True)
        run_bounded(["/bin/cp", "-X", str(archive), str(drive / "MODULE.UF2")], 30)
        report["stage"] = "checking_keyboard"
        device_info = wait_for_module(location)
        with hid.Device(path=device_info["path"]) as device:
            restore_settings(device, saved)
            verify_stability(device)
        report["stage"] = "usb_verified"
        print("UF2 copied; keyboard and VIA responsive for 15 seconds; saved keymap/macros verified.", flush=True)
        print("Confirm physical typing and startup lighting. USB checks do not verify those or read back the entire flash.", flush=True)
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        (run_dir / "flash-report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Flash report: {run_dir / 'flash-report.json'}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("firmware", type=Path, help="The compiled Module UF2 to deploy.")
    parser.add_argument("--boot-drive", required=True, type=Path, help="Exact mounted RP2 drive, e.g. /Volumes/RPI-RP2.")
    parser.add_argument("--bootloader-serial", required=True, help="Expected RP2 USB serial number.")
    parser.add_argument("--usb-location", required=True, type=lambda value: int(value, 0), help="Exact physical USB location ID, e.g. 0x01142000.")
    parser.add_argument("--recovery-dir", required=True, type=Path, help="Persistent directory for immutable image copies and run reports.")
    parser.add_argument("--start-mode", required=True, choices=("application", "bootloader"))
    parser.add_argument("--settings-backup", type=Path, help="Required in bootloader mode: previously captured Module settings JSON.")
    parser.add_argument("--check", action="store_true", help="Validate the image and USB access without rebooting or flashing.")
    args = parser.parse_args()
    flash_module(args.firmware.resolve(), args.boot_drive, args.bootloader_serial, args.usb_location,
                 args.recovery_dir.resolve(), args.start_mode, args.settings_backup, args.check)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, hid.HIDException, usb.core.USBError, subprocess.SubprocessError) as error:
        print(f"Module update: {error}", file=sys.stderr)
        sys.exit(1)
