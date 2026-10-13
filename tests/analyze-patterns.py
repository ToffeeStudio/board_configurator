"""Offline triage of original paired captures; never controls HID or alters images."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def load_image(file):
    pixels = np.asarray(Image.open(file).convert("RGB"), dtype=float)
    if pixels.shape != (1080, 1920, 3):
        raise ValueError(f"Expected original 1920x1080 frame: {file}")
    return pixels


def qmk_rgb(hue):
    region = hue * 6 // 255
    remainder = ((hue * 2 - region * 85) * 3) & 255
    q = 18 * (255 - ((255 * remainder) >> 8)) >> 8
    t = 18 * (255 - ((255 * (255 - remainder)) >> 8)) >> 8
    return [[18, t, 0], [q, 18, 0], [0, 18, t], [0, q, 18], [t, 0, 18], [18, 0, q], [18, t, 0]][region]


if len(sys.argv) != 6:
    raise ValueError("Required: SESSION_DIRECTORY POSITION_REPORT_JSON REAR_MAP_JSON baseline|groups|off NEW_REPORT_JSON.")
directory, position_file, rear_file, mode, destination = sys.argv[1:]
if mode not in ("baseline", "groups", "off"):
    raise ValueError("Mode must be baseline, groups or off.")
directory = Path(directory)
positions = json.loads(Path(position_file).read_text())["projected_positions"]
rear = {e["index"]: e for e in json.loads(Path(rear_file).read_text())["entries"]}
front = set(map(int, positions["front"])) - set(range(65, 81))
badge = set(range(65, 81))
baselines = {face: load_image(directory / f"all-off-baseline-{face}.png") for face in positions}
manifest = json.loads((directory / "manifest.json").read_text())
records = []
for case in manifest["cases"]:
    name = case["name"]
    expected = {}
    if mode == "baseline":
        if name.endswith("-front"):
            expected.update({i: [18, 18, 18] for i in front | badge})
        if name.endswith("-rear") or name.startswith("rear-frozen-"):
            phase = case["expected"]["phase"]
            expected.update({i: qmk_rgb(((e["x"] + e["y"]) // 2 + phase) & 255) for i, e in rear.items()})
        if name.startswith("transition-"):
            expected[case["expected"]["index"]] = [18, 0, 0]
        if name.startswith("rear-cycle-"):
            expected.update({i: None for i in rear})
    elif mode == "groups":
        if name.startswith("group-bits-"):
            bits = case["expected"]["bits"]
            for bit, indices, color in [(1, front, [18, 0, 0]), (2, rear, [0, 0, 18]), (4, badge, [0, 18, 0])]:
                if bits & bit:
                    expected.update({i: color for i in indices})
        if name.startswith("change-"):
            actual = case["expected"]["actual"]
            for group, indices in [("front", front), ("rear", rear), ("badge", badge)]:
                if actual[group]["brightness"]:
                    expected.update({i: None for i in indices})
    elif name.startswith("before-"):
        expected[0] = [18, 0, 0]
    for face, coordinates in positions.items():
        file = directory / f"{name}-{face}.png"
        pixels = load_image(file)
        measurements = []
        for index_text, xy in coordinates.items():
            index = int(index_text)
            x, y = np.rint(xy).astype(int)
            radius = 5 if index in badge else 12
            roi = pixels[y-radius:y+radius+1, x-radius:x+radius+1]
            delta = roi - baselines[face][y-radius:y+radius+1, x-radius:x+radius+1]
            change = delta.max(axis=2)
            selected = (change > 60) & (roi.max(axis=2) > 200)
            measured_on = int(selected.sum()) >= 5
            projected_on = index in expected and index != 103
            peak = np.argsort(change.ravel())[-min(20, change.size):]
            measurements.append({"index": index, "expected_rgb": expected.get(index),
                "expected_on": projected_on, "emission_pixels": int(selected.sum()),
                "peak_delta": float(change.max()), "bright_delta_rgb": delta.reshape(-1, 3)[peak].mean(axis=0).round(1).tolist(),
                "triage": "MATCH" if measured_on == projected_on else "REVIEW",
                "known_hardware_exclusion": index == 103})
        records.append({"case": name, "face": face, "image": str(file), "measurements": measurements,
            "review_indices": [m["index"] for m in measurements if m["triage"] == "REVIEW"]})
report = {"mode": mode, "session": str(directory), "images_modified": False,
    "method": "Package-local delta >60 and current maximum channel >200 in at least five pixels; 5px badge / 12px other half-width.",
    "limitations": "Triage only. Exposure, reflections and white clipping prevent calibrated colour/brightness or full physical acceptance. Original frames require review.",
    "records": records}
with Path(destination).open("x") as output:
    json.dump(report, output, indent=2)
    output.write("\n")
print(json.dumps({"frames": len(records), "review": [{"case": r["case"], "face": r["face"], "indices": r["review_indices"]} for r in records if r["review_indices"]]}))
