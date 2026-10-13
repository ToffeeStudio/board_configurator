#!/usr/bin/env python3
"""Select three raw LEDs in red, blue, green order; 255 = unused."""

import argparse
import sys

import hid

VID = 0x1067
PID = 0x626D
RAW_USAGE_PAGE = 0xFF60
RAW_USAGE = 0x61
COMMAND = 0x7C
PACKET_SIZE = 32
COLORS = ("red", "blue", "green")


def find_module():
    devices = [
        device for device in hid.enumerate(VID, PID)
        if device["usage_page"] == RAW_USAGE_PAGE and device["usage"] == RAW_USAGE
    ]
    if len(devices) != 1:
        raise ValueError("Connect exactly one Module keyboard with its raw HID interface available.")
    return devices[0]


def show_leds(led_indices):
    device_info = find_module()

    packet = bytearray(PACKET_SIZE)
    packet[0] = 0x09
    packet[1] = COMMAND
    packet[6:11] = bytes(led_indices) + b"\xff\xff"
    with hid.Device(path=device_info["path"]) as device:
        device.write(b"\x00" + packet)
        response = device.read(PACKET_SIZE, timeout=2000)

    if len(response) != PACKET_SIZE or response[1:11] != packet[1:11]:
        raise ValueError("No matching discovery response; flash the discovery firmware and close the configurator.")
    if response[0] != 0:
        raise ValueError(f"Discovery rejected these indices (status 0x{response[0]:02X}).")

    print(f"Discovery active: {response[11]} LED addresses")
    for color, index in zip(COLORS, led_indices):
        print(f"{color}: {'off' if index == 255 else index}")
    return response[11]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("indices", nargs=3, type=int, metavar="INDEX")
    args = parser.parse_args()
    if any(index < 0 or index > 255 for index in args.indices):
        raise ValueError("Provide three byte indices; use 255 for an unused colour.")
    show_leds(args.indices)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, hid.HIDException) as error:
        print(f"LED discovery: {error}", file=sys.stderr)
        sys.exit(1)
