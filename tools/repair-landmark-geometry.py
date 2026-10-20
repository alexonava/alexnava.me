"""Reproduce the approved local tree-fork volume and gallery-joint recess.

Requires the existing NumPy Python runtime, with no Blender or network access.
Read the four ORIGINAL, SHA-pinned GLBs from --source-dir; all four results are
validated in memory before --output-dir is written. UVs, indices, embedded maps,
JSON, byte lengths, AABBs and contact geometry stay exact. This is a small local
repair, not a topology rebuild. The two tiers retain their existing triangles.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np


ORIGINAL = {
    "tree-high": "a176298b3bb939045da0fb669ec2bed7446d059e64301af6366684f857d5c0e5",
    "tree-balanced": "688519100d5a45833aea72ed3edb3e0300ce8894b3109ad3eed392659744e7a5",
    "tower-high": "33bebce065c897d55790ffb45409d899668552181cc9c8336b1addd23066d00d",
    "tower-balanced": "f19722dbcee8e6ca69ebb3970279ed40d4e6d46baa64b617a813acddaa441e41",
}
APPROVED = {
    "tree-high": "29c068f92daf5bb0fa848fc17e61cdff972f0813741026dee6d64397a302a3a1",
    "tree-balanced": "a5029454faac1bb6cc62110a2265b777674762bc2fb319ac806da395eac8d3f2",
    "tower-high": "9520a3d84f27995e08ece5953699cb0b3f03869c549914de2278d4844bd02e69",
    "tower-balanced": "1d0c21d401e4831f02496056a7f89997a989a339b7c6d4a8cc01db1c6b35476f",
}
COMPONENTS = {5120: "i1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
TREE_CENTRE = np.array([-.13884071, .55025373, .21587493])
TREE_AXES = np.array([[-.33909859, -.92057248, -.19380002],
                      [.71307868, -.38589061, .58532661],
                      [-.61362118, .06028876, .78729557]])
TREE_RADII = np.array([.012, .025, .038])
TREE_GAIN = .6
TREE_VIEWS = (np.array([-.28284271, .2, 1.55563492]), np.array([-.906, -.45, -.423]))
JOINT_CENTRE = np.array([.128, .829, -.166])
JOINT_RADII = np.array([.012, .018, .018])
JOINT_DEPTH = .0018
JOINT_VIEW = np.array([.574, -.25, -.819])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def read_glb(data):
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    start = 28 + length
    primitive = doc["meshes"][0]["primitives"][0]

    def accessor(i):
        a = doc["accessors"][i]
        view = doc["bufferViews"][a["bufferView"]]
        dtype, width = np.dtype(COMPONENTS[a["componentType"]]), WIDTHS[a["type"]]
        array = np.ndarray((a["count"], width), dtype=dtype, buffer=data,
                           offset=start + view.get("byteOffset", 0) + a.get("byteOffset", 0),
                           strides=(view.get("byteStride", dtype.itemsize * width), dtype.itemsize)).copy()
        if a.get("normalized"):
            array = array.astype(float) / np.iinfo(dtype).max
            if dtype.kind == "i":
                array = np.maximum(array, -1)
        return array

    attributes = primitive["attributes"]
    return {"data": data, "json": doc, "start": start, "primitive": primitive,
            "p": accessor(attributes["POSITION"]), "n": accessor(attributes["NORMAL"]),
            "t": accessor(attributes["TANGENT"]) if "TANGENT" in attributes else None,
            "uv": accessor(attributes["TEXCOORD_0"]),
            "faces": accessor(primitive["indices"]).reshape(-1, 3)}


def boundary_pins(mesh, views):
    p, faces = mesh["p"], mesh["faces"]
    keys, reverse = np.unique(np.rint(p * 32767).astype(np.int16), axis=0, return_inverse=True)
    normals = unit(np.cross(p[faces[:, 1]] - p[faces[:, 0]], p[faces[:, 2]] - p[faces[:, 0]]))
    edges = {}
    for i, triangle in enumerate(reverse[faces]):
        for a, b in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])):
            edges.setdefault(tuple(sorted((a, b))), []).append(i)
    pins = np.zeros(len(keys), bool)
    for edge, fs in edges.items():
        if len(fs) != 2 or any(np.prod(normals[fs] @ view) <= 0 for view in views):
            pins[list(edge)] = True
    return pins[reverse]


def positions(mesh, role):
    p = mesh["p"]
    if role == "tree":
        pins = boundary_pins(mesh, TREE_VIEWS)
        q = (p - TREE_CENTRE) @ TREE_AXES.T
        r2 = (q[:, 1] / TREE_RADII[1]) ** 2 + (q[:, 2] / TREE_RADII[2]) ** 2
        inside = (r2 < 1) & (np.abs(q[:, 0]) < TREE_RADII[0])
        weight = np.maximum(1 - r2, 0) ** 2 * np.maximum(1 - (q[:, 0] / TREE_RADII[0]) ** 2, 0) ** 2
        weight[~inside | pins] = 0
        offset = np.clip(TREE_GAIN * q[:, 0] * weight, -.0025, .0025)
        result = p + offset[:, None] * TREE_AXES[0]
        protected = p[:, 1] < .5
    else:
        pins = boundary_pins(mesh, (JOINT_VIEW,))
        q = (p - JOINT_CENTRE) / JOINT_RADII
        inside = np.all(np.abs(q) < 1, axis=1)
        weight = np.prod(np.maximum(1 - q ** 2, 0) ** 2, axis=1)
        weight[~inside | pins] = 0
        result = p.copy()
        result[:, 2] += JOINT_DEPTH * weight
        protected = (p[:, 1] < .81) | (p[:, 1] > .847)
    result = np.rint(result * 32767) / 32767
    moved = np.any(result != p, axis=1)
    assert not moved[protected | pins | ~inside].any(), "protected vertex moved"
    assert np.array_equal(p.min(0), result.min(0)) and np.array_equal(p.max(0), result.max(0)), "AABB changed"
    return result


def surface_frames(mesh, result):
    old, faces = mesh["p"], mesh["faces"]
    moved = np.any(result != old, axis=1)
    touched = np.any(moved[faces], axis=1)
    affected = np.zeros(len(old), bool)
    affected[faces[touched].ravel()] = True
    e0 = np.stack((old[faces[:, 1]] - old[faces[:, 0]], old[faces[:, 2]] - old[faces[:, 0]]), -1)
    e1 = np.stack((result[faces[:, 1]] - result[faces[:, 0]], result[faces[:, 2]] - result[faces[:, 0]]), -1)
    cross0, cross1 = np.cross(e0[:, :, 0], e0[:, :, 1]), np.cross(e1[:, :, 0], e1[:, :, 1])
    area0, area1 = np.linalg.norm(cross0, axis=1), np.linalg.norm(cross1, axis=1)
    valid = area0 > 1e-12
    assert not touched[~valid].any(), "pre-existing degenerate face touched"
    cosine = np.sum(unit(cross0[valid]) * unit(cross1[valid]), axis=1)
    ratio = area1[valid] / area0[valid]
    assert cosine.min() > np.cos(np.deg2rad(45)), "face turned more than 45 degrees"
    assert ratio.min() > .5, "face inverted or lost more than half its area"
    jacobian = np.tile(np.eye(3), (len(faces), 1, 1))
    b0 = np.concatenate((e0[valid], unit(cross0[valid])[:, :, None]), axis=2)
    b1 = np.concatenate((e1[valid], unit(cross1[valid])[:, :, None]), axis=2)
    jacobian[valid] = b1 @ np.linalg.inv(b0)
    residual = np.max(np.abs(jacobian[valid] @ e0[valid] - e1[valid]))
    sums, weights = np.zeros((len(old), 3, 3)), np.zeros(len(old))
    for k in range(3):
        np.add.at(sums, faces[:, k], jacobian * area0[:, None, None])
        np.add.at(weights, faces[:, k], area0)
    jv = sums[affected] / np.maximum(weights[affected, None, None], 1e-15)
    determinants = np.linalg.det(jv)
    assert determinants.min() > .25, "singular or mirrored normal frame"
    normal = mesh["n"].copy()
    n = unit(np.einsum("nij,nj->ni", np.linalg.inv(jv).transpose(0, 2, 1), normal[affected]))
    normal[affected] = np.rint(n * 127) / 127
    tangent, orthogonality = None, 0
    if mesh["t"] is not None:
        tangent = mesh["t"].copy()
        t = np.einsum("nij,nj->ni", jv, tangent[affected, :3])
        t = unit(t - n * np.sum(t * n, axis=1)[:, None])
        tangent[affected, :3] = np.rint(t * 127) / 127
        assert np.array_equal(tangent[:, 3], mesh["t"][:, 3]), "tangent handedness changed"
        orthogonality = float(np.abs(np.sum(unit(normal[affected]) * unit(tangent[affected, :3]), axis=1)).max())
        assert orthogonality < .012
    assert np.isfinite(normal).all() and (tangent is None or np.isfinite(tangent).all())
    proof = {"movedVertices": int(moved.sum()), "frameVertices": int(affected.sum()),
             "maxDisplacement": float(np.linalg.norm(result - old, axis=1).max()),
             "maxFaceRotationDegrees": float(np.degrees(np.arccos(np.clip(cosine, -1, 1))).max()),
             "minPositiveAreaRatio": float(ratio.min()), "minFrameDeterminant": float(determinants.min()),
             "maxSurfaceDerivativeResidual": float(residual), "maxQuantizedNormalTangentDot": orthogonality,
             "AABB": [old.min(0).tolist(), old.max(0).tolist()], "triangles": len(faces)}
    return normal, tangent, moved, affected, proof


def write_bytes(mesh, points, normals, tangents, moved, affected):
    data, allowed = bytearray(mesh["data"]), set()
    arrays = [("POSITION", np.rint(points * 32767).astype("<i2"), moved),
              ("NORMAL", np.rint(normals * 127).astype("i1"), affected)]
    if tangents is not None:
        arrays.append(("TANGENT", np.rint(tangents * 127).astype("i1"), affected))
    for key, array, selected in arrays:
        accessor = mesh["json"]["accessors"][mesh["primitive"]["attributes"][key]]
        view = mesh["json"]["bufferViews"][accessor["bufferView"]]
        offset = mesh["start"] + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        width = array.shape[1] * array.dtype.itemsize
        stride = view.get("byteStride", width)
        for i in np.where(selected)[0]:
            start = offset + i * stride
            data[start:start + width] = array[i].tobytes()
            allowed.update(range(start, start + width))
    difference = {i for i, (a, b) in enumerate(zip(data, mesh["data"])) if a != b}
    assert difference <= allowed and len(data) == len(mesh["data"]), "non-frame model bytes changed"
    reread = read_glb(data)
    assert np.array_equal(reread["p"], points)
    assert np.array_equal(reread["uv"], mesh["uv"]) and np.array_equal(reread["faces"], mesh["faces"])
    return bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    results, report = {}, {"numpy": np.__version__, "models": {}}
    # Read and validate every original before touching output, including when
    # input/output directories happen to be the same.
    originals = {name: (args.source_dir / f"{name}.glb").read_bytes() for name in ORIGINAL}
    for name, data in originals.items():
        if sha(data) != ORIGINAL[name]:
            raise ValueError(f"{name}: expected original SHA256 {ORIGINAL[name]}")
    for name, data in originals.items():
        mesh = read_glb(data)
        points = positions(mesh, name.split("-")[0])
        normals, tangents, moved, affected, proof = surface_frames(mesh, points)
        result = write_bytes(mesh, points, normals, tangents, moved, affected)
        if sha(result) != APPROVED[name]:
            raise ValueError(f"{name}: differs from visually approved result")
        results[name] = result
        report["models"][name] = {**proof, "sourceSHA256": ORIGINAL[name], "sha256": APPROVED[name], "bytes": len(result)}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, result in results.items():
        (args.output_dir / f"{name}.glb").write_bytes(result)
        print(name, json.dumps(report["models"][name]), flush=True)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
