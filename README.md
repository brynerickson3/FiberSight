# FiberSight

**Transforming Skeletal Muscle Histology Through Automated Image Analysis**

FiberSight measures muscle stain images automatically. A biologist chooses the stains they used and uploads a whole experiment. They get fiber size, fiber type, stem-cell counts, % area stained and stain intensity, with the same settings applied to every image. Results come out as per-fiber, per-image and per-group CSVs, plus review overlays.

## Deploy the web app (free, about 3 minutes)

[![Open in Streamlit](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://share.streamlit.io/deploy?repository=brynerickson3/FiberSight&branch=main&mainModule=streamlit_app.py)

1. Click the button above, or go to **share.streamlit.io** and sign in with GitHub.
2. Choose **Create app → Deploy a public app from GitHub**:
   - Repository: `brynerickson3/FiberSight`
   - Branch: `main`
   - Main file: `streamlit_app.py`
3. Optional: choose a custom URL such as `fibersight.streamlit.app`, then click **Deploy**.

The first build takes a few minutes while it installs the engine from `requirements.txt`. After that, every push to `main` updates the app.

<details><summary>Alternative: Render</summary>

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/brynerickson3/FiberSight)

Uses `render.yaml`, on the free web-service plan.
</details>

## Run it on your own computer

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

## What's in this repo

| Path | What it is |
|---|---|
| `streamlit_app.py` | The web app. Set up the experiment (stains, channels, groups), upload images or try sample data, then view the summary, charts, review overlays and downloads. |
| [`engine/`](engine/) | The Python analysis engine: segmentation, measurements, statistics, CSVs and overlays. It has a command line (`fibersight analyze …`) and tests against synthetic sections with known answers. |
| [`prototype/`](prototype/) | Clickable React demo of the user experience, used in the class pitch. Synthetic data only. It deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions). |

**Status:** v0.1 research prototype, accurate on synthetic test images (see `engine/README.md`). Validation on real lab images against hand counts is Specific Aim 1. Research use only. Not for diagnosis.

BENG 4080 project. Leads into our Specific Aims on ATP synthase c-subunit leak and skeletal muscle development.
