"""Measure individual red-package emission; never modify the camera images."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, center_of_mass, label, sum as component_sum


def analyze(directory, mapping, physical_mapping, destination):
    positions = {key["index"]: [key["image_x"], key["image_y"]] for key in physical_mapping["entries"]
                 if key["group"] == "front_key"}
    baseline = np.asarray(Image.open(directory / "keys-off-front.png"), dtype=float)
    baseline_red = baseline[:, :, 0] - (baseline[:, :, 1] + baseline[:, :, 2]) / 2
    results = []
    for key in mapping["front"]:
        image = f'key-{key["index"]:03d}-front.png'
        pixels = np.asarray(Image.open(directory / image), dtype=float)
        red = pixels[:, :, 0] - (pixels[:, :, 1] + pixels[:, :, 2]) / 2
        mask = (red - baseline_red > 25) & (red > 25) & (pixels[:, :, 0] > 220)
        # Explicit ROI for the fixed session camera, excluding person/screens.
        mask[:450] = False
        mask[940:] = False
        mask[:, :250] = False
        mask[:, 1650:] = False
        # Merge a package's red halo when its white saturated core splits the mask.
        components, count = label(binary_dilation(mask, iterations=3))
        sizes = component_sum(mask, components, np.arange(1, count + 1))
        valid = np.where(sizes >= 15)[0] + 1
        centres = center_of_mass(mask, components, valid)
        spots = [{"x": round(c[1], 1), "y": round(c[0], 1), "pixels": int(sizes[v - 1])}
                 for v, c in zip(valid, centres)]
        results.append({"index": key["index"], "label": key["label"], "image": image,
                        "expected_xy": positions[key["index"]], "red_spots": spots})

    # Fit the observed physical geometry rather than reuse old camera pixel positions.
    # These four package centres were independently inspected in the original frames.
    calibration = {91: [273, 566], 83: [1427, 515], 17: [301, 896], 0: [1585, 863]}
    anchors = [r for r in results if r["index"] in calibration]
    for anchor in anchors:
        candidates = [spot for spot in anchor["red_spots"] if np.linalg.norm(
            np.array([spot["x"], spot["y"]]) - calibration[anchor["index"]]) < 20]
        if not candidates:
            raise ValueError(f'Anchor {anchor["index"]} does not show a red package at its inspected position.')
        anchor["anchor_spot"] = min(candidates, key=lambda spot: np.linalg.norm(
            np.array([spot["x"], spot["y"]]) - calibration[anchor["index"]]))
    design = np.array([[*r["expected_xy"], 1] for r in anchors])
    observed = np.array([[r["anchor_spot"]["x"], r["anchor_spot"]["y"]] for r in anchors])
    transform = np.linalg.lstsq(design, observed, rcond=None)[0]
    for result in results:
        projected = np.array([*result["expected_xy"], 1]) @ transform
        spots = result["red_spots"]
        result["projected_pixel_xy"] = projected.round(1).tolist()
        result["matched_spots"] = [spot for spot in spots if
            np.linalg.norm(np.array([spot["x"], spot["y"]]) - projected) < 35]
        result["visual_result"] = "red emission at expected package position" if result["matched_spots"] else "inspect"
        if result["index"] == 103:
            result["visual_result"] = "known broken physical repair; dark as expected" if not result["matched_spots"] else "inspect"

    report = {"method": "red-minus-other-channels and off-baseline contrast; connected components; archived physical package geometry anchored to four inspected keys",
              "limitation": "confirms emission at expected packages, not a certified absence of stray/reflected light; room/exposure changes create other red components",
              "thresholds": {"red_contrast": 25, "red_channel": 220, "minimum_component_pixels": 15,
                             "position_tolerance_pixels": 35},
              "images_modified": False, "results": results,
              "visually_matched_keys": sum(r["visual_result"] == "red emission at expected package position" for r in results)}
    with destination.open("x") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(f'CAMERA ANALYSIS: {report["visually_matched_keys"]} keys match; ' +
          "; ".join(f'{r["index"]}: {r["visual_result"]}' for r in results if
                    r["visual_result"] != "red emission at expected package position"))


if len(sys.argv) != 5:
    raise ValueError("Required: CAMERA_DIRECTORY FIRMWARE_MAP_JSON PHYSICAL_MAP_JSON NEW_REPORT_JSON.")
analyze(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()),
        json.loads(Path(sys.argv[3]).read_text()), Path(sys.argv[4]))
