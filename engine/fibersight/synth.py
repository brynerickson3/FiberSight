"""Synthetic muscle sections with known answers, for tests and demos.

Each image is built from a warped Voronoi tiling (fibers), a membrane channel,
nuclei (peripheral, central, Pax7+), fiber-type channels, or a brightfield
DAB + hematoxylin rendering. The ground truth (every fiber's area and type,
every marker cell) is saved next to the images so accuracy can be measured.
"""
import json
from pathlib import Path

import numpy as np
import tifffile
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import io as skio

from .stains import OD

TYPES = ["I", "IIa", "IIx", "IIb"]
FLUOR_CHANNELS = ["dapi", "laminin", "pax7", "mhc1", "mhc2a", "mhc2b"]


def _seeds(rng, n, H, W, min_d):
    pts = []
    tries = 0
    while len(pts) < n and tries < 40000:
        tries += 1
        p = np.array([rng.uniform(0, H), rng.uniform(0, W)])
        if not pts or np.min(np.sum((np.array(pts) - p) ** 2, axis=1)) > min_d ** 2:
            pts.append(p)
    return np.array(pts)


def _blobs(shape, centers, radius_px, amp=1.0):
    img = np.zeros(shape, np.float32)
    r = int(radius_px * 3)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    for (cy, cx), a in zip(centers, np.broadcast_to(amp, len(centers))):
        ang = (cy * 7 + cx) % np.pi
        u = xx * np.cos(ang) + yy * np.sin(ang)
        v = -xx * np.sin(ang) + yy * np.cos(ang)
        k = a * np.exp(-((u / (radius_px * 1.3)) ** 2 + (v / (radius_px * 0.8)) ** 2))
        y0, x0 = int(round(cy)) - r, int(round(cx)) - r
        ys, xs = slice(max(0, y0), min(shape[0], y0 + 2 * r + 1)), slice(max(0, x0), min(shape[1], x0 + 2 * r + 1))
        if ys.stop <= ys.start or xs.stop <= xs.start:
            continue
        img[ys, xs] = np.maximum(img[ys, xs], k[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0])
    return img


def make_section(seed, H=768, W=1024, px=0.65, mean_area_um2=2200, type_probs=(0.1, 0.3, 0.25, 0.35),
                 pax7_rate=0.06, central_rate=0.03, mode="fluor"):
    rng = np.random.default_rng(seed)
    n = int(H * W * px ** 2 * 0.8 / mean_area_um2)
    seeds = _seeds(rng, n, H, W, 0.75 * np.sqrt(H * W / n))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    wy = yy + 4 * np.sin(xx / 23) + 3 * np.sin(xx / 9 + yy / 31)
    wx = xx + 4 * np.sin(yy / 19) + 3 * np.sin(yy / 11 - xx / 27)
    d, idx = cKDTree(seeds).query(np.c_[wy.ravel(), wx.ravel()], k=3)
    d = d.reshape(H, W, 3)
    i1 = idx[:, 0].reshape(H, W)
    gap = np.minimum(d[..., 1] - d[..., 0], 0.42 * (d[..., 2] - d[..., 0]) - 1.0)
    mem_px = 2.2 / px                       # ~2 µm membrane + interstitium
    interior = gap >= mem_px
    truth = np.where(interior, i1 + 1, 0)

    nf = len(seeds)
    area = np.bincount(truth.ravel(), minlength=nf + 1)[1:]
    cy, cx = np.array(ndi.center_of_mass(interior, truth, np.arange(1, nf + 1))).T
    edge = np.zeros(nf, bool)
    for border in (truth[0], truth[-1], truth[:, 0], truth[:, -1]):
        edge[np.unique(border[border > 0]) - 1] = True
    ftype = rng.choice(4, size=nf, p=np.array(type_probs) / np.sum(type_probs))
    central = rng.random(nf) < central_rate
    fint = np.clip(rng.normal(0.65, 0.08, nf), 0.3, 1)

    nuclei, pax7 = [], []
    for k in range(nf):
        if area[k] < 50:
            continue
        r = np.sqrt(area[k] / np.pi)
        for _ in range(rng.integers(1, 4)):
            a = rng.uniform(0, 2 * np.pi)
            nuclei.append((cy[k] + np.sin(a) * r * 0.97, cx[k] + np.cos(a) * r * 0.97))
        if central[k]:
            nuclei.append((cy[k] + rng.normal(0, 1.5), cx[k] + rng.normal(0, 1.5)))
        if rng.random() < pax7_rate:
            a = rng.uniform(0, 2 * np.pi)
            p = (cy[k] + np.sin(a) * (r + mem_px * 0.5), cx[k] + np.cos(a) * (r + mem_px * 0.5))
            nuclei.append(p)
            pax7.append((p, k))
    nuc_r = 3.0 / px
    noise = lambda s=0.03: rng.normal(0, s, (H, W)).astype(np.float32)  # noqa: E731

    gt = dict(px=px, fibers=[dict(fiber=k + 1, area_um2=float(area[k] * px ** 2), type=TYPES[ftype[k]],
                                  edge=bool(edge[k]), central=bool(central[k]), y=float(cy[k]), x=float(cx[k]))
                             for k in range(nf) if area[k] > 0],
              pax7=[dict(y=float(p[0]), x=float(p[1]), fiber=int(k + 1), edge=bool(edge[k])) for p, k in pax7])

    if mode == "fluor":
        lam = np.exp(-(np.maximum(gap, 0) / (mem_px * 0.6)) ** 2) * 0.9
        lam = ndi.gaussian_filter(lam, 1.0) + 0.05 + noise()
        dapi = _blobs((H, W), nuclei, nuc_r) * 0.9 + 0.03 + noise()
        pax = _blobs((H, W), [p for p, _ in pax7], nuc_r) * 0.8 + 0.03 + noise(0.04)
        chans = []
        for t in (0, 1, 3):   # MyHC I, IIa, IIb (IIx is unstained)
            on = np.zeros(nf + 1, np.float32)
            on[1:] = np.where(ftype == t, fint, 0.04)
            chans.append(ndi.gaussian_filter(on[truth], 1.0) + 0.04 + noise())
        stack = np.stack([dapi, lam, pax] + chans)
        return (np.clip(stack, 0, 1) * 65535).astype(np.uint16), gt

    # brightfield DAB (fibers) + hematoxylin (nuclei)
    dab = np.zeros(nf + 1, np.float32)
    dab[1:] = fint * 0.55
    dab_map = ndi.gaussian_filter(dab[truth], 1.0) + 0.03
    hem_map = _blobs((H, W), nuclei, nuc_r) * 0.9
    od = dab_map[..., None] * np.array(OD["dab"]) + hem_map[..., None] * np.array(OD["hematoxylin"])
    od = od / 1.0 + rng.normal(0, 0.01, (H, W, 1))
    rgb = np.clip(10 ** (-od), 0, 1)
    return (rgb * 255).astype(np.uint8), gt


def make_experiment(out_dir, n_per_group=6, mode="fluor", seed=0):
    """Two groups: wild-type, and a 'mutant' with smaller fibers, fewer Pax7+ cells,
    more slow fibers and more central nuclei."""
    out = Path(out_dir)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "truth").mkdir(exist_ok=True)
    groups = {"WT": dict(), "MUT": dict(mean_area_um2=1650, pax7_rate=0.03, type_probs=(0.2, 0.32, 0.25, 0.23), central_rate=0.09)}
    for gi, (g, kw) in enumerate(groups.items()):
        for i in range(n_per_group):
            name = f"{g}_M{i % 3 + 1}_s{i // 3 + 1:02d}"
            img, gt = make_section(seed + 1000 * gi + i, mode=mode, **kw)
            if mode == "fluor":
                tifffile.imwrite(out / "images" / f"{name}.tif", img)
            else:
                skio.imsave(out / "images" / f"{name}.png", img, check_contrast=False)
            (out / "truth" / f"{name}.json").write_text(json.dumps(gt))
    if mode == "fluor":
        cfg = ("name: Synthetic demo (fluorescence)\npixel_size_um: 0.65\nmode: fluor\nchannels:\n"
               + "".join(f"  {i}: {c}\n" for i, c in enumerate(FLUOR_CHANNELS)))
    else:
        cfg = "name: Synthetic demo (brightfield DAB)\npixel_size_um: 0.65\nmode: bright\nstains: [hema, dab]\n"
    cfg += 'groups:\n  Wild-type: "WT_*"\n  Mutant: "MUT_*"\nanimal_regex: "_M(\\\\d+)_"\n'
    (out / "experiment.yaml").write_text(cfg)
    return out
