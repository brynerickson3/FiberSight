"""Accuracy against synthetic sections with known answers.

Run:  pytest engine/tests -q
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from fibersight import config, pipeline, report, synth


def _match(root, data):
    rows = []
    for d in data:
        gt = json.loads((root / "truth" / (Path(d.name).stem + ".json")).read_text())
        f = d.fibers.set_index("fiber_id")
        for t in gt["fibers"]:
            if t["edge"]:
                continue
            lab = d.labels[int(round(t["y"])), int(round(t["x"]))]
            r = dict(true_area=t["area_um2"], true_type=t["type"], true_central=t["central"], found=lab > 0)
            if lab > 0:
                r.update(area=f.loc[lab, "area_um2"], type=f.loc[lab].get("fiber_type"), central=f.loc[lab, "central_nucleus"])
            rows.append(r)
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def fluor(tmp_path_factory):
    root = synth.make_experiment(tmp_path_factory.mktemp("fluor"), n_per_group=3, mode="fluor")
    exp = config.load(root / "experiment.yaml")
    data, th = pipeline.run(root / "images", exp)
    return root, exp, data, th


@pytest.fixture(scope="module")
def bright(tmp_path_factory):
    root = synth.make_experiment(tmp_path_factory.mktemp("bright"), n_per_group=3, mode="bright")
    exp = config.load(root / "experiment.yaml")
    data, th = pipeline.run(root / "images", exp)
    return root, exp, data, th


def test_fluor_segmentation(fluor):
    root, _, data, _ = fluor
    m = _match(root, data)
    assert m["found"].mean() > 0.97
    err = ((m.area - m.true_area) / m.true_area)[m.found]
    assert err.abs().median() < 0.05


def test_fluor_fiber_typing(fluor):
    root, _, data, _ = fluor
    m = _match(root, data)
    m = m[m.found]
    assert (m.type == m.true_type).mean() > 0.95


def test_central_nuclei(fluor):
    root, _, data, _ = fluor
    m = _match(root, data)
    m = m[m.found]
    assert (m.central == m.true_central).mean() > 0.95


def test_pax7_counts(fluor):
    root, _, data, _ = fluor
    true = sum(sum(1 for p in json.loads((root / "truth" / (Path(d.name).stem + ".json")).read_text())["pax7"] if not p["edge"]) for d in data)
    found = sum(int(d.fibers.loc[d.fibers.included, "pax7_cells"].sum()) for d in data)
    assert abs(found - true) <= max(3, 0.25 * true)


def test_brightfield_segmentation(bright):
    root, _, data, _ = bright
    m = _match(root, data)
    assert m["found"].mean() > 0.97
    err = ((m.area - m.true_area) / m.true_area)[m.found]
    assert err.abs().median() < 0.05


def test_reports_and_group_difference(fluor, tmp_path):
    _, exp, data, th = fluor
    fib, img, grp = report.write_all(data, exp, th, tmp_path, overlays=True)
    for name in ["per_fiber.csv", "per_image.csv", "per_group.csv", "summary.md"]:
        assert (tmp_path / name).exists()
    assert len(list((tmp_path / "overlays").glob("*.png"))) == len(data)
    csa = grp.set_index("measure").loc["mean_csa_um2"]
    assert csa["Mutant mean"] < csa["Wild-type mean"]      # synthetic mutant has smaller fibers


def test_unmix_recovers_dab():
    rgb = np.ones((4, 4, 3)) * 10 ** (-0.5 * np.array([0.27, 0.57, 0.78]) / np.linalg.norm([0.27, 0.57, 0.78]))
    c = pipeline.unmix(rgb, [(0.65, 0.70, 0.29), (0.27, 0.57, 0.78)])
    assert c[1].mean() == pytest.approx(0.5, abs=0.02) and c[0].mean() < 0.02
