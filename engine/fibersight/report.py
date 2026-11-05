"""Outputs: three CSV levels, a plain-English summary, and review overlays.

  per_fiber.csv   one row per fiber (reanalyze anything later in R / Prism)
  per_image.csv   one row per image, with quality flags
  per_group.csv   one row per measure: group means, SD, n, Welch's t-test
  summary.md      the headline differences in plain English
  overlays/*.png  each image with outlines, fiber types and marker cells drawn on
"""
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw
from scipy import stats
from skimage import segmentation

from .config import Experiment

TYPE_RGB = {"I": (61, 220, 151), "IIa": (255, 92, 92), "IIx": (170, 170, 170), "IIb": (255, 210, 63)}


def per_fiber(data, exp: Experiment) -> pd.DataFrame:
    frames = []
    for d in data:
        if not len(d.fibers):
            continue
        f = d.fibers.copy()
        f.insert(0, "image", d.name)
        f.insert(1, "group", d.group)
        f.insert(2, "animal", d.animal)
        frames.append(f)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return df.round(3)


def per_image(data, exp: Experiment, thresholds: dict) -> pd.DataFrame:
    rows = []
    sharp_med = np.median([d.sharpness for d in data]) if data else 0
    for d in data:
        f = d.fibers[d.fibers["included"]] if len(d.fibers) else d.fibers
        n = len(f)
        r = dict(image=d.name, group=d.group, animal=d.animal, n_fibers=n)
        if n:
            r["mean_csa_um2"] = f["area_um2"].mean()
            r["median_csa_um2"] = f["area_um2"].median()
            r["cv_csa"] = f["area_um2"].std() / f["area_um2"].mean() if n > 1 else np.nan
            r["mean_min_feret_um"] = f["min_feret_um"].mean()
            if exp.stains_of("nuclear"):
                r["pct_central_nuclei"] = 100 * f["central_nucleus"].mean()
                r["nuclei_per_fiber"] = f["n_nuclei"].mean()
            if "fiber_type" in f:
                for t, c in f["fiber_type"].value_counts().items():
                    r[f"pct_type_{t}"] = 100 * c / n
            if "regenerating" in f:
                r["pct_regenerating"] = 100 * f["regenerating"].mean()
            for st in exp.stains_of("marker"):
                r[f"{st.marker}_per_100_fibers"] = 100 * f[f"{st.marker}_cells"].sum() / n
            for st in exp.stains_of("intensity"):
                r[f"mean_{st.id}_intensity"] = f[f"int_{st.id}"].mean()
        for st in exp.stains_of("area"):
            h = d.area_hist[st.id]
            edges = np.linspace(0, 1, len(h) + 1)
            r[f"pct_area_{st.id}"] = 100 * h[edges[:-1] >= thresholds[st.id]].sum() / max(1, h.sum())
        flags = []
        if sharp_med and d.sharpness < 0.4 * sharp_med:
            flags.append("possibly out of focus")
        if n < 10:
            flags.append("few fibers found")
        r["qc_flags"] = "; ".join(flags)
        rows.append(r)
    df = pd.DataFrame(rows)
    type_cols = sorted(c for c in df.columns if c.startswith("pct_type_"))
    df[type_cols] = df[type_cols].fillna(0.0)
    return df.round(3)


def per_group(img: pd.DataFrame, exp: Experiment = None) -> pd.DataFrame:
    """Group comparison. The FIRST group in the experiment file is the reference."""
    measures = [c for c in img.columns if c not in ("image", "group", "animal", "qc_flags")]
    present = list(img["group"].unique())
    order = [g for g in (exp.groups if exp else []) if g in present]
    groups = order + [g for g in present if g not in order and g != "ungrouped"] or present
    use_animals = img["animal"].astype(str).str.len().gt(0).all()
    rows = []
    for m in measures:
        r = {"measure": m}
        vals = {}
        for g in groups:
            sub = img[img["group"] == g]
            v = (sub.groupby("animal")[m].mean() if use_animals else sub[m]).dropna()
            vals[g] = v
            r[f"{g} mean"] = v.mean()
            r[f"{g} SD"] = v.std()
            r[f"{g} n"] = len(v)
        r["unit of n"] = "animals" if use_animals else "images"
        if len(groups) == 2 and min(len(vals[g]) for g in groups) >= 2:
            a, b = vals[groups[0]], vals[groups[1]]
            t, p = stats.ttest_ind(a, b, equal_var=False)
            r["test"] = "Welch's t-test"
            r["p_value"] = p
            r["% difference"] = 100 * (b.mean() - a.mean()) / a.mean() if a.mean() else np.nan
        rows.append(r)
    return pd.DataFrame(rows)


LABELS = {
    "mean_csa_um2": "Mean fiber CSA (µm²)", "median_csa_um2": "Median fiber CSA (µm²)", "cv_csa": "Fiber size variability (CV)",
    "mean_min_feret_um": "Mean min Feret diameter (µm)", "pct_central_nuclei": "Centrally nucleated fibers (%)",
    "nuclei_per_fiber": "Nuclei per fiber", "n_fibers": "Fibers analyzed per image", "pct_regenerating": "Regenerating fibers (%)",
}


def nice(m):
    if m in LABELS:
        return LABELS[m]
    if m.startswith("pct_type_"):
        return f"Type {m[9:]} fibers (%)"
    if m.endswith("_per_100_fibers"):
        return f"{m[:-15].capitalize()}+ cells per 100 fibers"
    if m.startswith("pct_area_"):
        return f"{m[9:]} area (% of tissue)"
    if m.startswith("mean_") and m.endswith("_intensity"):
        return f"{m[5:-10]} intensity"
    return m


def fmt(v):
    return f"{v:,.0f}" if abs(v) >= 100 else f"{v:.3g}"


def summary_md(exp, img, grp, thresholds) -> str:
    groups = [c[:-5] for c in grp.columns if c.endswith(" mean")]
    lines = [f"# {exp.name}: FiberSight summary", "",
             f"{len(img)} images, {int(img['n_fibers'].sum()):,} fibers measured. "
             f"Groups: {', '.join(f'{g} ({int((img.group == g).sum())} images)' for g in groups)}. "
             f"Differences are relative to {groups[0]}." if groups else "", ""]
    if "p_value" in grp:
        sig = grp[grp["p_value"] < 0.05].sort_values("p_value")
        lines += ["## Significant differences (p < 0.05)", ""]
        if not len(sig):
            lines.append("None.")
        for _, r in sig.iterrows():
            a, b = groups[0], groups[1]
            lines.append(f"- **{nice(r.measure)}**: {b} {fmt(r[f'{b} mean'])} vs. {a} {fmt(r[f'{a} mean'])} "
                         f"({r['% difference']:+.0f}%, p = {r.p_value:.2g}, n = {int(r[f'{b} n'])} vs {int(r[f'{a} n'])} {r['unit of n']})")
        lines.append("")
    flagged = img[img["qc_flags"].astype(str).str.len() > 0]
    lines += ["## Images to review", ""]
    lines += [f"- {r.image}: {r.qc_flags}" for _, r in flagged.iterrows()] or ["None flagged."]
    lines += ["", "## Thresholds used (same for every image)", ""]
    lines += [f"- {k}: {v:.3f}" for k, v in thresholds.items()] or ["None needed."]
    lines += ["", "_Flags and thresholds are for the researcher to check. They are not diagnoses._", ""]
    return "\n".join(lines)


def overlay(d, exp, path: Path):
    rgb = (np.clip(d.display, 0, 1) * 255).astype(np.uint8)
    bound = segmentation.find_boundaries(d.labels, mode="inner")
    out = rgb.copy()
    out[bound] = (255, 230, 0)
    if len(d.fibers):
        excl = d.fibers.loc[~d.fibers["included"], "fiber_id"].to_numpy()
        out[np.isin(d.labels, excl) & bound] = (130, 130, 130)
    im = Image.fromarray(out)
    dr = ImageDraw.Draw(im)
    px = exp.pixel_size_um
    if "fiber_type" in d.fibers:
        for _, f in d.fibers[d.fibers["included"]].iterrows():
            x, y = f.x_um / px, f.y_um / px
            c = TYPE_RGB.get(f.fiber_type, (255, 255, 255))
            dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=c, outline=(0, 0, 0))
    for st in exp.stains_of("marker"):
        col = f"{st.marker}_pos"
        if col in d.nuclei:
            for _, n in d.nuclei[d.nuclei[col]].iterrows():
                x, y = n.x_um / px, n.y_um / px
                dr.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(255, 64, 110), width=2)
    for _, n in d.nuclei[d.nuclei["central"].astype(bool)].iterrows() if len(d.nuclei) else []:
        x, y = n.x_um / px, n.y_um / px
        dr.rectangle([x - 5, y - 5, x + 5, y + 5], outline=(0, 255, 255), width=2)
    im.save(path)


def write_all(data, exp, thresholds, out_dir, overlays=True):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fib = per_fiber(data, exp)
    img = per_image(data, exp, thresholds)
    grp = per_group(img, exp)
    fib.to_csv(out / "per_fiber.csv", index=False)
    img.to_csv(out / "per_image.csv", index=False)
    grp.round(4).to_csv(out / "per_group.csv", index=False)
    (out / "summary.md").write_text(summary_md(exp, img, grp, thresholds))
    if overlays:
        (out / "overlays").mkdir(exist_ok=True)
        for d in data:
            overlay(d, exp, out / "overlays" / (Path(d.name).stem + ".png"))
    return fib, img, grp
