"""Add UV-matched photographic mountain albedo without changing geometry.

Uses the existing local mountains-v1 Cycles colour bakes and the repository's
original GLBs. Requires the already available Python Pillow and NumPy runtime;
no Blender session, network access, source modification or new dependency.

python tools/prepare-mountain-albedo.py --archive PATH/TO/mountains-v1
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess

import numpy as np
from PIL import Image


ROLES = ("mountain-ridge", "mountain-spine", "mountain-summit")
TIERS = {"high": (512, 90), "balanced": (256, 88)}


def unpack(data):
    length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20 : 20 + length]), data[28 + length :]


def filled_colour(path, size):
    """Filter colour in linear light, then fill outside the baked UV coverage."""
    rgba = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)

    def resize(array, shape):
        return np.asarray(
            Image.fromarray(array.astype(np.float32)).resize(shape, Image.Resampling.BOX)
        )

    weight = resize(alpha, (size, size))
    colour = np.stack(
        [resize(rgb[..., c] * alpha, (size, size)) for c in range(3)], -1
    )
    levels = [(colour, weight)]
    while levels[-1][1].shape[0] > 1:
        c, w = levels[-1]
        n = w.shape[0] // 2
        levels.append(
            (c.reshape(n, 2, n, 2, 3).sum((1, 3)), w.reshape(n, 2, n, 2).sum((1, 3)))
        )
    c, w = levels[-1]
    fill = c / np.maximum(w[..., None], 1e-8)
    for c, w in reversed(levels[:-1]):
        n = w.shape[0]
        up = np.stack(
            [
                np.asarray(
                    Image.fromarray(fill[..., k].astype(np.float32)).resize(
                        (n, n), Image.Resampling.BILINEAR
                    )
                )
                for k in range(3)
            ],
            -1,
        )
        own = c / np.maximum(w[..., None], 1e-8)
        fill = np.where((w > 0)[..., None], own, up)
    covered = weight > 0
    mean = float((fill[covered] @ np.array([0.2126, 0.7152, 0.0722])).mean())
    srgb = np.where(fill <= 0.0031308, fill * 12.92, 1.055 * fill ** (1 / 2.4) - 0.055)
    return Image.fromarray(np.uint8(np.clip(np.rint(srgb * 255), 0, 255))), mean


def encode(image, **options):
    out = io.BytesIO()
    image.save(out, "WEBP", method=6, **options)
    return out.getvalue()


def prepare(source, colour, size, quality, bake_hash):
    document, binary = unpack(source)
    primitive = document["meshes"][0]["primitives"][0]
    material = document["materials"][primitive["material"]]

    def image_data(texture):
        image = document["textures"][texture]["extensions"]["EXT_texture_webp"]["source"]
        view = document["bufferViews"][document["images"][image]["bufferView"]]
        offset = view.get("byteOffset", 0)
        return binary[offset : offset + view["byteLength"]]

    mask = Image.open(io.BytesIO(image_data(material["pbrMetallicRoughness"]["baseColorTexture"]["index"]))).convert("RGB")
    snow, ao, _ = mask.split()
    # Exact decoded mask values are preserved; AO occupies glTF's standard R.
    mask_bytes = encode(Image.merge("RGB", (ao, snow, ao)), lossless=True)
    decoded = Image.open(io.BytesIO(mask_bytes)).convert("RGB")
    assert decoded.getchannel("R").tobytes() == ao.tobytes()
    assert decoded.getchannel("G").tobytes() == snow.tobytes()
    normal_bytes = image_data(material["normalTexture"]["index"])
    albedo, mean = filled_colour(colour, size)
    albedo_bytes = encode(albedo, quality=quality)
    first_image = min(document["bufferViews"][im["bufferView"]].get("byteOffset", 0) for im in document["images"])
    payload = bytearray(binary[:first_image])
    views = [v for v in document["bufferViews"] if v.get("byteOffset", 0) < first_image]
    images, textures = [], []
    for name, data in (("ao-snow", mask_bytes), ("object-normal", normal_bytes), ("albedo", albedo_bytes)):
        offset = len(payload)
        payload.extend(data)
        payload.extend(bytes((-len(payload)) % 4))
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        images.append({"name": name, "mimeType": "image/webp", "bufferView": len(views) - 1})
        textures.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(images) - 1}}})
    material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 2}
    material["occlusionTexture"] = {"index": 0}
    material["normalTexture"] = {"index": 1}
    for node in document["nodes"]:
        if "mountain" in node.get("extras", {}):
            node["extras"]["mountain"].update({
                "materialLayout": "albedo-ao-snow-v1",
                "mask": "occlusionTexture R = ambient occlusion, G = source whiteness (snow)",
                "albedoMean": round(mean, 7),
                "albedoBakeSHA256": bake_hash,
            })
    document.update({"images": images, "textures": textures, "bufferViews": views, "buffers": [{"byteLength": len(payload)}]})
    text = json.dumps(document, separators=(",", ":")).encode()
    text += b" " * ((-len(text)) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 28 + len(text) + len(payload)) + struct.pack("<I4s", len(text), b"JSON") + text + struct.pack("<I4s", len(payload), b"BIN\0") + payload
    return out, {"albedoBytes": len(albedo_bytes), "maskBytes": len(mask_bytes), "albedoMean": mean, "sourceGeometrySHA256": hashlib.sha256(binary[:first_image]).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--base-ref", default="2d7277f234e0269753eb47382dc1ca816fdd9508")
    parser.add_argument("--output-dir", type=Path, default=Path("images/architecture"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = {"baseRef": args.base_ref, "models": {}, "addedBytes": {tier: 0 for tier in TIERS}}
    bake_report = json.loads((args.archive / "reports" / "bake.json").read_text())
    prepared_files = {}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for role in ROLES:
        bake = args.archive / "derived" / "bake" / f"{role}-color-bake.png"
        bake_hash = hashlib.sha256(bake.read_bytes()).hexdigest()
        assert bake_hash == bake_report[role]["outputs"]["color"]["sha256"], f"changed cached UV bake: {role}"
        for tier, (size, quality) in TIERS.items():
            filename = f"{role}-{tier}.glb"
            source = subprocess.run(["git", "show", f"{args.base_ref}:images/architecture/{filename}"], check=True, capture_output=True).stdout
            result, details = prepare(source, bake, size, quality, bake_hash)
            report["addedBytes"][tier] += len(result) - len(source)
            report["models"][filename] = {**details, "bytes": len(result), "addedBytes": len(result) - len(source), "pixels": size, "sha256": hashlib.sha256(result).hexdigest()}
            prepared_files[filename] = result
            print(filename, json.dumps(report["models"][filename]), flush=True)
    assert report["addedBytes"]["high"] <= 512 * 1024
    assert report["addedBytes"]["balanced"] <= 256 * 1024
    for filename, data in prepared_files.items():
        (args.output_dir / filename).write_bytes(data)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
