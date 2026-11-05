"""Glue for running FiberSight inside a web browser (Pyodide, called from a Web Worker).

Everything is plain JSON / bytes in and out, so the JavaScript side stays simple.
The same functions run under normal Python, which is how they are tested.
"""
import io as _io
import json
import shutil
import time
import zipfile
from pathlib import Path

from . import config, pipeline, report, synth
from . import stains as S


def library_json() -> str:
    return json.dumps([dict(id=s.id, name=s.name, kind=s.kind, mode=s.mode, target=s.target) for s in S.LIBRARY.values()])


def make_sample(mode: str, root: str, n_per_group: int = 3) -> str:
    """Write a synthetic experiment to `root`; returns its config as JSON (dict form)."""
    shutil.rmtree(root, ignore_errors=True)
    r = synth.make_experiment(root, n_per_group=n_per_group, mode=mode)
    import yaml
    return json.dumps(yaml.safe_load((r / "experiment.yaml").read_text()))


def run(cfg_json: str, in_dir: str, out_dir: str, progress=None) -> dict:
    """Analyze every image in in_dir. Returns a dict the browser can render and download."""
    t0 = time.time()
    exp = config.from_dict(json.loads(cfg_json))
    data, th = pipeline.run(in_dir, exp, progress)
    shutil.rmtree(out_dir, ignore_errors=True)
    fib, img, grp = report.write_all(data, exp, th, out_dir, overlays=True)
    out = Path(out_dir)

    zbuf = _io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(out))

    g = grp.copy()
    g.insert(0, "label", g["measure"].map(report.nice))
    groups = [c[:-5] for c in grp.columns if c.endswith(" mean")]
    return dict(
        name=exp.name,
        seconds=round(time.time() - t0, 1),
        n_images=len(img),
        n_fibers=int(img["n_fibers"].sum()),
        groups=groups,
        thresholds={k: round(float(v), 4) for k, v in th.items()},
        summary=(out / "summary.md").read_text(),
        per_group=json.loads(g.to_json(orient="records")),
        per_image=json.loads(img.to_json(orient="records")),
        per_image_cols=list(img.columns),
        labels={c: report.nice(c) for c in img.columns},
        csv=dict(per_fiber=fib.to_csv(index=False), per_image=img.to_csv(index=False), per_group=grp.to_csv(index=False)),
        overlays={p.name: p.read_bytes() for p in sorted((out / "overlays").glob("*.png"))},
        zip=zbuf.getvalue(),
    )
