"""Bake a bounded optional soil roughness tile from the known CC0 Dirt source.

Authoring only: Pillow is not a site build or runtime dependency.
"""

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import struct

from PIL import Image, features


SOURCE_SHA256 = "29f68a8972f1e69cf47e67924efe469350f953a5f707f63633a9c36cd7c63f6a"
SIZE = 512
MAX_BYTES = 12 * 1024


def roughness_image(source, size=None):
    """Normalize the actual 16-bit samples before float filtering."""
    if source.mode not in ("I;16", "I;16B", "I;16L", "I"):
        raise ValueError("Soil roughness requires a 16-bit grayscale source")
    values = source.convert("F").point(lambda value: value / 65535.0)
    if size is not None:
        values = values.resize((size, size), Image.Resampling.LANCZOS)
    data = bytes(max(0, min(255, math.floor(value * 255 + 0.5))) for value in values.get_flattened_data())
    return Image.frombytes("L", values.size, data)


def encode(source):
    image = roughness_image(source, SIZE)
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=78, method=6)
    data = output.getvalue()
    if len(data) > MAX_BYTES:
        raise ValueError("Soil roughness exceeds its 12 KiB asset bound")
    decoded = Image.open(io.BytesIO(data)).convert("L")
    mean = sum(decoded.get_flattened_data()) / (SIZE * SIZE * 255)
    return data, mean, decoded.getextrema()


def self_test():
    source = Image.frombytes("I;16", (3, 1), struct.pack("<HHH", 0, 32768, 65535))
    assert list(roughness_image(source).get_flattened_data()) == [0, 128, 255]
    white = Image.frombytes("I;16", (2, 2), struct.pack("<HHHH", *([65535] * 4)))
    assert roughness_image(white, SIZE).getextrema() == (255, 255)
    try:
        roughness_image(Image.new("L", (2, 2), 128))
    except ValueError:
        pass
    else:
        raise AssertionError("8-bit input must not silently use 16-bit normalization")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true", help="Verify the saved tile without writing")
    parser.add_argument("--self-test", action="store_true", help="Check 16-bit normalization in memory")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("16-bit normalization tests passed")
        return
    if args.source is None or args.output is None:
        parser.error("--source and --output are required unless --self-test is used")
    source_bytes = args.source.read_bytes()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    if source_sha != SOURCE_SHA256:
        raise ValueError("Unexpected Dirt roughness source SHA-256")
    source = Image.open(io.BytesIO(source_bytes))
    if source.size != (1024, 1024):
        raise ValueError("Unexpected Dirt roughness dimensions")
    data, mean, extrema = encode(source)
    if args.check:
        if args.output.read_bytes() != data:
            raise ValueError("Saved soil roughness does not match this deterministic bake")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(data)
    print(json.dumps({
        "source": "Poly Haven Dirt by Charlotte Baglioni, CC0",
        "source_sha256": source_sha,
        "source_mode": source.mode,
        "source_extrema": source.getextrema(),
        "size": [SIZE, SIZE],
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "decoded_mean": mean,
        "decoded_extrema": extrema,
        "encoding": "grayscale WebP, quality 78, method 6; linear roughness data",
        "pillow": Image.__version__,
        "webp": features.version("webp"),
    }, indent=2))


if __name__ == "__main__":
    main()
