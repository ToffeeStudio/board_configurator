"""Verify port hotplug on a disposable QEMU controller. No guest disk or host USB."""

import argparse
import json
import subprocess


def request(command, **arguments):
    return {"execute": command, "arguments": arguments}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qemu", required=True, help="Path to qemu-system-x86_64")
    options = parser.parse_args()

    def plug(port):
        return request(
            "device_add", driver="usb-kbd", id="toffee-fixture",
            bus="toffee-xhci.0", port=str(port),
        )

    commands = [
        request("qmp_capabilities"),
        plug(1),
        request("human-monitor-command", **{"command-line": "info usb"}),
        request("device_del", id="toffee-fixture"),
        plug(2),
        request("human-monitor-command", **{"command-line": "info usb"}),
        request("quit"),
    ]
    process = subprocess.run(
        [options.qemu, "-machine", "q35", "-nodefaults", "-display", "none", "-S",
         "-device", "qemu-xhci,id=toffee-xhci", "-qmp", "stdio"],
        input="".join(json.dumps({**command, "id": i}) + "\n"
                      for i, command in enumerate(commands)),
        text=True, capture_output=True, check=True, timeout=15,
    )
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    version = messages[0]["QMP"]["version"]["qemu"]
    replies = {msg["id"]: msg for msg in messages if "id" in msg}
    for i, command in enumerate(commands):
        if "return" not in replies.get(i, {}):
            raise ValueError(f"QMP {command['execute']} failed: {replies.get(i)}")
    for idx, port in [(2, 1), (5, 2)]:
        listing = replies[idx]["return"]
        if f"Port {port}," not in listing or "ID: toffee-fixture" not in listing:
            raise ValueError(f"QMP did not enumerate the fixture on port {port}: {listing!r}")
    print(json.dumps({"qemu": version, "controller": "qemu-xhci", "ports": [1, 2],
                      "fixture": "built-in USB keyboard", "guest": False}))


if __name__ == "__main__":
    main()
