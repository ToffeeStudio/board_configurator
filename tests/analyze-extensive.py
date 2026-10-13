"""Offline package-local camera measurements. Never opens HID or edits images."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def image(path):
    pixels = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    if pixels.shape != (1080, 1920, 3):
        raise ValueError(f"Expected original 1920x1080 camera frame: {path}")
    return pixels


def projection(entries, anchors):
    equations, targets = [], []
    lookup = {str(e["index"]): e for e in entries}
    for index, (u, v) in anchors.items():
        e = lookup[index]
        x, y = e["image_x"], e["image_y"]
        equations.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y],
                          [0, 0, 0, x, y, 1, -v*x, -v*y]])
        targets.extend([u, v])
    h = np.append(np.linalg.solve(equations, targets), 1).reshape(3, 3)
    result = {}
    for e in entries:
        p = h @ [e["image_x"], e["image_y"], 1]
        result[e["index"]] = (p[:2] / p[2]).tolist()
    return result


def patch(pixels, xy, radius):
    x, y = np.rint(xy).astype(int)
    return pixels[y-radius:y+radius+1, x-radius:x+radius+1]


def measure(pixels, baseline, xy, radius, color):
    current = patch(pixels, xy, radius)
    delta = current - patch(baseline, xy, radius)
    channel = {"red": 0, "green": 1, "blue": 2}[color]
    others = [i for i in range(3) if i != channel]
    contrast = current[:, :, channel] - current[:, :, others].max(axis=2)
    excess = delta[:, :, channel] - delta[:, :, others].max(axis=2)
    mask = (contrast > 18) & (excess > 18) & (current[:, :, channel] > 100)
    score = delta.max(axis=2)
    brightest = np.argsort(score.ravel())[-max(4, int(score.size * .1)):]
    yy, xx = np.nonzero(mask)
    center = None
    if len(xx):
        origin = np.rint(xy).astype(int) - radius
        center = [round(float(xx.mean() + origin[0]), 1), round(float(yy.mean() + origin[1]), 1)]
    return {"chromatic_pixels": int(mask.sum()), "observed_xy": center,
            "peak_delta": round(float(score.max()), 1),
            "bright_delta_rgb": np.mean(delta.reshape(-1, 3)[brightest], axis=0).round(1).tolist(),
            "result": "EMISSION_MATCH" if mask.sum() >= 4 else "REVIEW"}


if len(sys.argv) != 7:
    raise ValueError("Required: SESSION_DIRECTORY FRONT_PHYSICAL_MAP REAR_PHYSICAL_MAP CALIBRATION_JSON BASELINE_DIRECTORY NEW_REPORT_JSON.")
directory, front_file, rear_file, calibration_file, baseline_dir, destination = map(Path, sys.argv[1:])
calibration = json.loads(calibration_file.read_text())
front_entries = json.loads(front_file.read_text())["entries"]
rear_entries = json.loads(rear_file.read_text())["entries"]
front_positions = projection(front_entries, calibration["front_anchors"])
# The badge is calibrated separately so its 14-pixel neighbours cannot be
# confused by a small whole-board fit error.
front_positions.update(projection([e for e in front_entries if e["group"] == "badge"], calibration["badge_anchors"]))
# 103's archival entry was measured in a different repair photograph. Its
# explicit current-frame coordinate is required, even though the fault is excluded.
front_positions[103] = calibration["equals_position"]
rear_positions = projection(rear_entries, calibration["rear_anchors"])
positions = {"front": front_positions, "back": rear_positions}
baselines = {face: image(baseline_dir / f"all-off-baseline-{face}.png") for face in positions}
events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
cases = [event for event in events if event["event"] == "case-complete" and event["id"] == "L1"]
results = []
for case in cases:
    face = case["expected"]["face"]
    pixels = image(directory / f'{case["name"]}-{face}.png')
    for expected in case["expected"]["packages"]:
        index = expected["index"]
        xy = positions[face][index]
        radius = (16 if case["name"].startswith("individual-") else 5) if 65 <= index <= 80 else 24
        measured = measure(pixels, baselines[face], xy, radius, expected["color"])
        if 65 <= index <= 80 and case["name"].startswith("individual-") and measured["observed_xy"] is not None:
            measured["position_error_pixels"] = round(float(np.linalg.norm(np.array(measured["observed_xy"]) - xy)), 1)
            if measured["position_error_pixels"] > 8:
                measured["result"] = "REVIEW"
        if index == 103:
            measured["result"] = "KNOWN_HARDWARE_EXCLUSION" if measured["result"] == "REVIEW" else "REVIEW"
        results.append({"case": case["name"], "face": face, **expected,
                        "projected_xy": np.round(xy, 1).tolist(), **measured})
report = {"method": "Explicit inspected four-point geometry per face and badge; package-local colour excess over original all-off frame.",
          "limitations": "Emission matching is not calibrated brightness/current, uniformity, absence of reflected leakage, or a full physical PASS. Review ambiguous and known-fault cases separately.",
          "images_modified": False, "calibration": str(calibration_file), "projected_positions": positions,
          "completed_package_channel_checks": len(results),
          "emission_matches": sum(r["result"] == "EMISSION_MATCH" for r in results),
          "known_exclusions": sum(r["result"] == "KNOWN_HARDWARE_EXCLUSION" for r in results),
          "needs_review": [r for r in results if r["result"] == "REVIEW"], "results": results}
with destination.open("x") as output:
    json.dump(report, output, indent=2)
    output.write("\n")
print(json.dumps({k: v for k, v in report.items() if k not in ("results", "needs_review", "projected_positions")}))
print("REVIEW:", [(r["index"], r["color"], r["chromatic_pixels"]) for r in report["needs_review"]])
