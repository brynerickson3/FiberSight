"""The analysis pipeline.

Pass 1 (per image): segment fibers, measure every fiber and nucleus, record raw
stain intensities.
Pass 2 (whole experiment): pick thresholds from ALL images at once, so every image
is judged by the same rule, then classify fiber types and marker+ cells and build
the summaries.
"""
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull, QhullError
from skimage import feature, filters, measure, morphology, segmentation

from . import io, segment
from .config import Experiment

AREA_BINS = np.linspace(0, 1, 513)


# ---------------------------------------------------------------- helpers
def unmix(rgb: np.ndarray, vectors) -> np.ndarray:
    """Colour deconvolution (Ruifrok & Johnston). Returns (k, H, W) stain amounts in OD units."""
    od = -np.log10(np.clip(rgb, 1 / 255, 1.0))
    M = np.array([np.asarray(v, float) / np.linalg.norm(v) for v in vectors])
    if len(M) == 1:
        M = np.vstack([M, np.cross(M[0], [1, 0, 0]), np.cross(M[0], [0, 1, 0])])
    if len(M) == 2:
        M = np.vstack([M, np.cross(M[0], M[1])])
    M = np.array([m / (np.linalg.norm(m) + 1e-9) for m in M])
    conc = od.reshape(-1, 3) @ np.linalg.pinv(M)
    k = len(vectors)
    return np.clip(conc[:, :k].T.reshape(k, *rgb.shape[:2]), 0, None).astype(np.float32)


def min_feret(coords: np.ndarray) -> float:
    pts = coords.astype(float)
    try:
        pts = pts[ConvexHull(pts).vertices]
    except (QhullError, ValueError):
        pass
    best = np.inf
    for a in np.deg2rad(np.arange(0, 180, 3)):
        proj = pts @ np.array([np.cos(a), np.sin(a)])
        best = min(best, proj.max() - proj.min() + 1)
    return float(best)


def detect_nuclei(img: np.ndarray, px_um: float) -> np.ndarray:
    sm = filters.gaussian(img, sigma=1.0)
    if sm.max() <= sm.min():
        return np.zeros(img.shape, np.int32)
    mask = sm > filters.threshold_otsu(sm)
    lab = measure.label(mask)
    sizes = np.bincount(lab.ravel())
    mask = (sizes >= max(4, int(6 / px_um ** 2)))[lab] & mask
    dist = ndi.distance_transform_edt(mask)
    peaks = feature.peak_local_max(dist, min_distance=max(2, int(2.5 / px_um)), labels=measure.label(mask), exclude_border=False)
    seeds = np.zeros(mask.shape, np.int32)
    seeds[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    return segmentation.watershed(-dist, seeds, mask=mask)


def robust_threshold(values: np.ndarray, manual=None) -> float:
    """Two-class (ISODATA) threshold across the whole experiment, guarded so a mostly-negative stain isn't split in the noise."""
    if manual is not None:
        return float(manual)
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    if len(v) < 10 or v.max() - v.min() < 1e-6:
        return float("inf")
    t = filters.threshold_isodata(v)   # halfway between the two class means: stable on tight clusters
    med = np.median(v)
    mad = np.median(np.abs(v - med)) * 1.4826
    return float(max(t, med + 3 * mad)) if np.mean(v > t) < 0.15 else float(t)


# ---------------------------------------------------------------- pass 1
@dataclass
class ImageData:
    name: str
    group: str
    animal: str
    labels: np.ndarray
    fibers: pd.DataFrame
    nuclei: pd.DataFrame
    area_hist: dict = field(default_factory=dict)   # stain id -> histogram of stain values in tissue
    tissue_px: int = 0
    sharpness: float = 0.0
    display: np.ndarray = None                     # RGB preview for overlays


def analyze_image(path: Path, exp: Experiment) -> ImageData:
    px = exp.pixel_size_um
    min_px, max_px = int(exp.min_fiber_um2 / px ** 2), int(exp.max_fiber_um2 / px ** 2)

    # ---- channels by stain id
    maps = {}
    if exp.mode == "fluor":
        img = io.read_fluor(path, max(exp.channels) + 1 if exp.channels else None)
        for ci, st in exp.channels.items():
            maps[st.id] = img[ci]
        seg_input = np.max([maps[s.id] for s in exp.stains_of("membrane")], axis=0)
        display = _fluor_display(img, exp)
    else:
        rgb = io.read_bright(path)
        conc = unmix(rgb, [s.od_vector for s in exp.bright_stains])
        for k, st in enumerate(exp.bright_stains):
            c = conc[k]
            maps[st.id] = np.clip(c / (np.percentile(c, 99.8) + 1e-6), 0, 1)
        seg_input = rgb
        display = rgb

    # ---- fibers
    if exp.segmentation == "cellpose":
        labels = segment.cellpose(seg_input if seg_input.ndim == 2 else seg_input.mean(-1), min_px, max_px)
    elif exp.mode == "fluor":
        labels = segment.classical_fluor(seg_input, min_px, max_px)
    else:
        labels = segment.classical_bright(seg_input, min_px, max_px)

    core = labels * ndi.binary_erosion(labels > 0, morphology.disk(2))   # ignore the membrane rim
    ids = np.arange(1, labels.max() + 1)
    H, W = labels.shape
    rows = []
    for r in measure.regionprops(labels):
        y0, x0, y1, x1 = r.bbox
        rows.append(dict(
            fiber_id=r.label,
            x_um=r.centroid[1] * px, y_um=r.centroid[0] * px,
            area_um2=r.area * px ** 2,
            min_feret_um=min_feret(r.coords) * px,
            eq_radius_um=np.sqrt(r.area / np.pi) * px,
            edge=bool(y0 == 0 or x0 == 0 or y1 == H or x1 == W),
        ))
    fibers = pd.DataFrame(rows)
    for st in exp.stains_of("fibertype") + exp.stains_of("intensity"):
        fibers[f"int_{st.id}"] = ndi.mean(maps[st.id], core, ids) if len(ids) else []
    if len(fibers):
        fibers["included"] = ~fibers["edge"] if exp.exclude_edge_fibers else True

    # ---- nuclei and markers
    nuc_stains = exp.stains_of("nuclear")
    nuclei = pd.DataFrame(columns=["fiber_id", "x_um", "y_um", "central"])
    if nuc_stains:
        nl = detect_nuclei(maps[nuc_stains[0].id], px)
        nids = np.arange(1, nl.max() + 1)
        if len(nids):
            cy, cx = np.array(ndi.center_of_mass(nl > 0, nl, nids)).T
            cyi, cxi = np.round(cy).astype(int), np.round(cx).astype(int)
            depth = ndi.distance_transform_edt(labels > 0)
            dist_out, (iy, ix) = ndi.distance_transform_edt(labels == 0, return_indices=True)
            fid = labels[cyi, cxi]
            near = labels[iy[cyi, cxi], ix[cyi, cxi]]
            fid = np.where((fid == 0) & (dist_out[cyi, cxi] * px <= 6.0), near, fid)
            radius = fibers.set_index("fiber_id")["eq_radius_um"] if len(fibers) else pd.Series(dtype=float)
            inside = labels[cyi, cxi] > 0
            d_um = depth[cyi, cxi] * px
            rad = np.array([radius.get(f, np.inf) for f in fid])
            nuclei = pd.DataFrame(dict(fiber_id=fid, x_um=cx * px, y_um=cy * px,
                                       central=inside & (d_um > np.maximum(3.0, 0.35 * rad))))
            for st in exp.stains_of("marker"):
                nuclei[f"int_{st.marker}"] = ndi.mean(maps[st.id], nl, nids)

    # ---- tissue area + area stains (histograms, thresholded later)
    tissue = ndi.binary_dilation(labels > 0, morphology.disk(4))
    area_hist = {}
    for st in exp.stains_of("area"):
        sig = maps[st.id]
        tissue |= sig > filters.threshold_otsu(sig) if sig.max() > sig.min() else False
    tissue = ndi.binary_closing(tissue, morphology.disk(3), border_value=1)
    for st in exp.stains_of("area"):
        area_hist[st.id] = np.histogram(maps[st.id][tissue], bins=AREA_BINS)[0]

    gray = seg_input if seg_input.ndim == 2 else seg_input.mean(-1)
    sharp = float(filters.laplace(filters.gaussian(gray, 1.0)).var())
    return ImageData(path.name, exp.group_of(path.name), exp.animal_of(path.name), labels.astype(np.int32),
                     fibers, nuclei, area_hist, int(tissue.sum()), sharp, display)


def _fluor_display(img, exp):
    colors = {"membrane": (0.85, 0.85, 0.85), "nuclear": (0.25, 0.45, 1.0), "marker": (1.0, 0.25, 0.4),
              "fibertype": (0.2, 0.85, 0.5), "area": (0.3, 0.8, 0.95), "intensity": (0.9, 0.6, 0.2)}
    palette_ft = [(0.2, 0.85, 0.5), (1.0, 0.35, 0.35), (1.0, 0.82, 0.25), (0.75, 0.5, 1.0)]
    out = np.zeros(img.shape[1:] + (3,), np.float32)
    k_ft = 0
    for ci, st in exp.channels.items():
        col = colors[st.kind]
        if st.kind == "fibertype":
            col = palette_ft[k_ft % 4]
            k_ft += 1
        out += img[ci][..., None] * np.array(col) * (0.6 if st.kind == "fibertype" else 1.0)
    return np.clip(out, 0, 1)


# ---------------------------------------------------------------- pass 2
def classify(data: list, exp: Experiment):
    """Experiment-wide thresholds, then fiber types and marker+ calls."""
    th = {}
    all_f = pd.concat([d.fibers for d in data if len(d.fibers)], ignore_index=True) if data else pd.DataFrame()
    inc = all_f[all_f.get("included", True) == True] if len(all_f) else all_f  # noqa: E712
    for st in exp.stains_of("fibertype"):
        th[st.id] = robust_threshold(inc[f"int_{st.id}"], exp.thresholds.get(st.id))
    all_n = pd.concat([d.nuclei for d in data if len(d.nuclei)], ignore_index=True) if data else pd.DataFrame()
    for st in exp.stains_of("marker"):
        col = f"int_{st.marker}"
        th[st.id] = robust_threshold(all_n[col] if col in all_n else [], exp.thresholds.get(st.id))
    for st in exp.stains_of("area"):
        if st.id in exp.thresholds:
            th[st.id] = float(exp.thresholds[st.id])
        else:  # Otsu on the pooled histogram
            h = np.sum([d.area_hist[st.id] for d in data], axis=0)
            centers = (AREA_BINS[:-1] + AREA_BINS[1:]) / 2
            th[st.id] = float(filters.threshold_otsu(hist=(h, centers))) if h.sum() else 0.5

    typing = [s for s in exp.stains_of("fibertype") if s.fibertype != "regenerating"]
    regen = [s for s in exp.stains_of("fibertype") if s.fibertype == "regenerating"]
    for d in data:
        f = d.fibers
        if len(f):
            pos = {s.fibertype: f[f"int_{s.id}"] > th[s.id] for s in typing}
            if typing:
                def ftype(i):
                    hits = [t for t, p in pos.items() if p.iloc[i]]
                    if not hits:
                        return "IIx" if len(typing) >= 3 else "negative"
                    return "/".join(hits) if len(hits) > 1 else hits[0]
                f["fiber_type"] = [ftype(i) for i in range(len(f))]
            for s in regen:
                f["regenerating"] = f[f"int_{s.id}"] > th[s.id]
        n = d.nuclei
        for st in exp.stains_of("marker"):
            col = f"int_{st.marker}"
            if col in n:
                n[f"{st.marker}_pos"] = n[col] > th[st.id]
        if len(f):
            g = n[n["fiber_id"] > 0].groupby("fiber_id") if len(n) else None
            f["n_nuclei"] = f["fiber_id"].map(g.size()).fillna(0).astype(int) if g is not None else 0
            f["central_nucleus"] = f["fiber_id"].map(g["central"].any()).fillna(False).astype(bool) if g is not None else False
            for st in exp.stains_of("marker"):
                c = f"{st.marker}_pos"
                f[f"{st.marker}_cells"] = f["fiber_id"].map(g[c].sum()).fillna(0).astype(int) if g is not None and c in n else 0
    return th


def run(folder, exp: Experiment, progress=None):
    paths = io.list_images(folder)
    if not paths:
        raise FileNotFoundError(f"No images found in {folder}")
    data = []
    for i, p in enumerate(paths):
        data.append(analyze_image(p, exp))
        if progress:
            progress(i + 1, len(paths), p.name)
    thresholds = classify(data, exp)
    return data, thresholds
