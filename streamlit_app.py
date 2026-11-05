"""FiberSight web app.

Run locally:   streamlit run streamlit_app.py
Deploy:        Streamlit Community Cloud (see README) - it installs ./engine from requirements.txt
"""
import io
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

from fibersight import config, pipeline, report, synth
from fibersight import stains as S

st.set_page_config(page_title="FiberSight", page_icon="🔬", layout="wide")

NAVY = "#0F2A4A"
GROUP_COLORS = ["#2563eb", "#e4572e", "#1ea872", "#e8b01c"]
st.markdown(f"""
<style>
  .block-container {{padding-top: 2rem; max-width: 1300px;}}
  h1, h2, h3 {{color: {NAVY};}}
  .fs-tag {{font-size: 0.85rem; color: #5b677a;}}
  div[data-testid="stMetricValue"] {{color: {NAVY};}}
</style>""", unsafe_allow_html=True)

FLUOR = {s.id: s for s in S.LIBRARY.values() if s.mode == "fluor"}
BRIGHT = {s.id: s for s in S.LIBRARY.values() if s.mode == "bright"}
label = lambda lib: (lambda k: f"{lib[k].name}  ·  {lib[k].target}")  # noqa: E731

# ---------------------------------------------------------------- header
st.title("FiberSight")
st.markdown("**Automated skeletal muscle histology.** Choose the stains you used, upload a whole experiment, "
            "and get fiber size, fiber type, stem-cell counts and stain coverage, measured the same way on every image.")
st.markdown('<span class="fs-tag">Research use only, not for diagnosis. Images are processed for this session and deleted afterwards.</span>',
            unsafe_allow_html=True)

# ---------------------------------------------------------------- sidebar: experiment setup
with st.sidebar:
    st.header("1 · Experiment")
    name = st.text_input("Name", "My experiment")
    mode = st.radio("Image type", ["Immunofluorescence", "Brightfield / IHC"], horizontal=True)
    fluor = mode == "Immunofluorescence"
    px = st.number_input("Pixel size (µm per pixel)", 0.05, 10.0, 0.65, 0.01,
                         help="From your microscope or objective, e.g. 0.65 for a 10x objective on many cameras.")

    st.header("2 · Stains")
    if fluor:
        n_ch = st.number_input("Channels per image", 1, 8, 4)
        defaults = ["dapi", "laminin", "pax7", "myod", "mhc1", "mhc2a", "mhc2b", "col1"]
        keys = list(FLUOR)
        channels = {}
        for i in range(int(n_ch)):
            d = defaults[i] if defaults[i] in keys else keys[0]
            channels[i] = st.selectbox(f"Channel {i}", keys, index=keys.index(d), format_func=label(FLUOR), key=f"ch{i}")
        chosen = [FLUOR[c] for c in channels.values()]
    else:
        bstains = st.multiselect("Stains in the image (up to 3)", list(BRIGHT), default=["hema", "dab"],
                                 format_func=label(BRIGHT), max_selections=3)
        chosen = [BRIGHT[b] for b in bstains]

    st.header("3 · Groups")
    st.caption("Images are assigned to a group by text in the file name. The first group is the reference.")
    groups = {}
    for i, (gn, gp) in enumerate([("Wild-type", "WT"), ("Mutant", "MUT")]):
        c1, c2 = st.columns(2)
        g = c1.text_input(f"Group {i + 1}", gn, key=f"g{i}")
        p = c2.text_input("File name contains", gp, key=f"p{i}")
        if g and p:
            groups[g] = f"*{p}*"
    with st.expander("Advanced"):
        animal_regex = st.text_input("Animal ID pattern (regex)", r"_M(\d+)_",
                                     help="Pulls an animal ID from file names like WT_M3_s02.tif so stats use animals, not images. Leave blank to use images.")
        engines = ["classical"]
        try:
            import cellpose  # noqa: F401
            engines.append("cellpose")
        except ImportError:
            pass
        seg = st.selectbox("Segmentation engine", engines, help="cellpose appears when the optional Cellpose package is installed.")
        min_um2 = st.number_input("Smallest fiber (µm²)", 10, 5000, 100)
        max_um2 = st.number_input("Largest fiber (µm²)", 1000, 100000, 20000)

# what will be measured
kinds = {s.kind for s in chosen}
measures = []
if "membrane" in kinds or (not fluor and chosen):
    measures += ["Fiber size (CSA, min Feret), size variability"]
if "nuclear" in kinds:
    measures += ["Nuclei per fiber, centrally nucleated fibers"]
measures += [f"{s.name}+ fibers (%)" for s in chosen if s.kind == "fibertype"]
measures += [f"{s.name}+ cells per 100 fibers" for s in chosen if s.kind == "marker"]
measures += [f"{s.name} area (% of tissue)" for s in chosen if s.kind == "area"]
measures += [f"{s.name} intensity per fiber" for s in chosen if s.kind == "intensity"]

# ---------------------------------------------------------------- main: inputs
left, right = st.columns([3, 2], gap="large")
with left:
    st.subheader("Upload images")
    files = st.file_uploader("Drop a whole experiment: TIFF (multi-channel) for fluorescence, or RGB TIFF/PNG/JPG for brightfield",
                             type=["tif", "tiff", "png", "jpg", "jpeg"], accept_multiple_files=True)
    c1, c2 = st.columns(2)
    run_upload = c1.button(f"Analyze {len(files)} images" if files else "Analyze", type="primary", disabled=not files, width="stretch")
    run_sample = c2.button("Try sample data (synthetic)", width="stretch",
                           help="Generates a small synthetic wild-type vs. mutant experiment with known answers and analyzes it.")
with right:
    st.subheader("FiberSight will measure")
    if measures:
        st.markdown("\n".join(f"- {m}" for m in measures))
    else:
        st.info("Pick at least one stain.")
    if fluor and "membrane" not in kinds:
        st.warning("Add a membrane stain (laminin, dystrophin or WGA) so fibers can be outlined.")


def build_exp():
    raw = dict(name=name, pixel_size_um=px, mode="fluor" if fluor else "bright", groups=groups,
               animal_regex=animal_regex, segmentation=seg, min_fiber_um2=min_um2, max_fiber_um2=max_um2)
    if fluor:
        raw["channels"] = channels
    else:
        raw["stains"] = [s.id for s in chosen]
    return config.from_dict(raw)


def analyze(folder, exp):
    bar = st.progress(0.0, text="Starting…")
    t0 = time.time()

    def prog(i, n, fname):
        bar.progress(i / n, text=f"Analyzed {i} of {n} · {fname}")
    data, th = pipeline.run(folder, exp, prog)
    out = Path(tempfile.mkdtemp(prefix="fs_out_"))
    fib, img, grp = report.write_all(data, exp, th, out, overlays=True)
    bar.empty()
    overlays = {p.name: p.read_bytes() for p in sorted((out / "overlays").glob("*.png"))}
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in out.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(out))
    res = dict(exp_name=exp.name, fib=fib, img=img, grp=grp, th=th, summary=(out / "summary.md").read_text(),
               overlays=overlays, zip=zbuf.getvalue(), seconds=time.time() - t0, groups=list(grp.filter(like=" mean").columns))
    shutil.rmtree(out, ignore_errors=True)
    return res


if run_upload or run_sample:
    work = Path(tempfile.mkdtemp(prefix="fs_in_"))
    try:
        if run_sample:
            root = synth.make_experiment(work, n_per_group=4, mode="fluor" if fluor else "bright")
            exp = config.load(root / "experiment.yaml")
            st.info("Sample data uses its own synthetic setup: " + ", ".join(s.name for s in exp.all_stains) + ". Your sidebar settings apply to your uploads.")
            st.session_state["res"] = analyze(root / "images", exp)
        else:
            exp = build_exp()
            for f in files:
                (work / Path(f.name).name).write_bytes(f.getbuffer())
            st.session_state["res"] = analyze(work, exp)
    except Exception as e:  # show a readable error instead of a stack trace
        st.error(f"Analysis stopped: {e}")
    finally:
        shutil.rmtree(work, ignore_errors=True)

# ---------------------------------------------------------------- results
res = st.session_state.get("res")
if res:
    fib, img, grp = res["fib"], res["img"], res["grp"]
    st.divider()
    st.header(f"Results · {res['exp_name']}")
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Images", len(img))
    m2.metric("Fibers measured", f"{int(img['n_fibers'].sum()):,}")
    m3.metric("Analysis time", f"{res['seconds']:.0f} s")
    m4.metric("Images flagged for review", int((img["qc_flags"].fillna("").astype(str).str.len() > 0).sum()))

    t1, t2, t3, t4 = st.tabs(["Summary", "Charts", "Review images", "Download"])
    with t1:
        st.markdown(res["summary"].split("\n", 1)[1])
        st.subheader("Group comparison")
        g = grp.copy()
        g.insert(0, "Measure", g.pop("measure").map(report.nice))
        st.dataframe(g, hide_index=True, width="stretch")
    with t2:
        names = [g[:-5] for g in res["groups"]]
        scale = alt.Scale(domain=names, range=GROUP_COLORS[:len(names)])
        if len(fib) and "area_um2" in fib:
            st.subheader("Fiber size distribution")
            fi = fib[fib["included"]]
            hist = alt.Chart(fi).transform_density("area_um2", groupby=["group"], as_=["area_um2", "density"], extent=[0, float(fi["area_um2"].quantile(0.995))]) \
                .mark_area(opacity=0.35, line=True).encode(x=alt.X("area_um2:Q", title="Fiber CSA (µm²)"), y=alt.Y("density:Q", title="Density"),
                                                          color=alt.Color("group:N", scale=scale, title=None)).properties(height=260)
            st.altair_chart(hist, width="stretch")
        st.subheader("Per-image values")
        cols = [c for c in img.columns if c not in ("image", "group", "animal", "qc_flags")]
        pick = st.selectbox("Measure", cols, format_func=report.nice, index=cols.index("mean_csa_um2") if "mean_csa_um2" in cols else 0)
        base = alt.Chart(img).encode(x=alt.X("group:N", title=None, sort=names), color=alt.Color("group:N", scale=scale, legend=None))
        dots = base.mark_circle(size=70, opacity=0.6).encode(y=alt.Y(f"{pick}:Q", title=report.nice(pick)), tooltip=["image", "animal", alt.Tooltip(pick, format=".3~f")],
                                                             xOffset="jitter:Q").transform_calculate(jitter="random()")
        mean = base.mark_tick(thickness=3, size=60, color="#111").encode(y=f"mean({pick}):Q")
        st.altair_chart((dots + mean).properties(height=320), width="stretch")
        row = grp[grp["measure"] == pick]
        if len(row) and "p_value" in row and pd.notna(row["p_value"].iloc[0]):
            st.caption(f"Welch's t-test ({row['unit of n'].iloc[0]}): p = {row['p_value'].iloc[0]:.3g}")
    with t3:
        flagged = img[img["qc_flags"].fillna("").astype(str).str.len() > 0]["image"].tolist()
        only = st.toggle("Show only flagged images", value=bool(flagged))
        choices = [Path(n).stem + ".png" for n in (flagged if only and flagged else img["image"])]
        sel = st.selectbox("Image", choices)
        c1, c2 = st.columns([3, 1])
        c1.image(res["overlays"][sel], width="stretch")
        r = img[img["image"].map(lambda n: Path(n).stem + ".png") == sel].T
        r.columns = ["value"]
        c2.dataframe(r.rename(index=report.nice).astype(str), width="stretch")
        st.caption("Yellow outlines = measured fibers · gray = excluded (touching the edge) · dots = fiber type "
                   "(green I, red IIa, gray IIx, yellow IIb) · pink circles = marker+ cells · cyan squares = central nuclei")
    with t4:
        st.download_button("Everything (.zip: CSVs, summary, overlays)", res["zip"], f"{res['exp_name']}_FiberSight.zip", "application/zip", type="primary")
        c1, c2, c3 = st.columns(3)
        c1.download_button("per_fiber.csv", fib.to_csv(index=False), "per_fiber.csv", "text/csv")
        c2.download_button("per_image.csv", img.to_csv(index=False), "per_image.csv", "text/csv")
        c3.download_button("per_group.csv", grp.to_csv(index=False), "per_group.csv", "text/csv")
        st.caption("Thresholds used (same for every image): " + ", ".join(f"{k} {v:.3f}" for k, v in res["th"].items()) if res["th"] else "")
