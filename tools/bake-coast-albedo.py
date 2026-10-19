"""Derive the optional 2-metre coastal colour tile from Poly Haven's CC0 scan.

Requires Pillow in the asset-authoring environment, never in the site runtime.
Source: https://polyhaven.com/a/seaside_rock (Dimitrios Savva, CC0).
"""

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.read_bytes()
    expected = "36cc332a0797aa8164a909737d763203"
    if hashlib.md5(source).hexdigest() != expected:
        raise ValueError("Expected the unmodified Seaside Rock diffuse 1k PNG")
    with Image.open(io.BytesIO(source)) as original:
        if original.size != (1024, 1024):
            raise ValueError("Expected a 1024-square source")
        tile = original.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
    encoded = io.BytesIO()
    tile.save(encoded, format="WEBP", quality=88, method=6)
    data = encoded.getvalue()
    if len(data) > 96 * 1024:
        raise ValueError("Coastal colour exceeds the 96 KiB optional-tile cap")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)
    with Image.open(io.BytesIO(data)) as decoded:
        pixels = list(decoded.convert("RGB").get_flattened_data())
    def linear(code):
        value = code / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    means = [sum(linear(rgb[channel]) for rgb in pixels) / len(pixels) for channel in range(3)]
    print(json.dumps({
        "source": "https://polyhaven.com/a/seaside_rock",
        "source_md5": expected,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data), "size": [512, 512], "tile_metres": 2,
        "linear_mean": means,
        "linear_luma_mean": sum(value * weight for value, weight in zip(means, (.2126, .7152, .0722))),
    }, indent=2))


if __name__ == "__main__":
    main()
