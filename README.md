# FiberSight

**Transforming Skeletal Muscle Histology Through Automated Image Analysis**

FiberSight measures muscle stain images automatically. A biologist chooses the stains they used and loads a whole experiment. They get fiber size, fiber type, stem-cell counts, % area stained and stain intensity, with the same settings applied to every image. Results come out as per-fiber, per-image and per-group CSVs, plus review overlays.

**Live site:** https://brynerickson3.github.io/FiberSight/

## Everything runs on GitHub

The site is hosted on GitHub Pages and the analysis engine runs inside your web browser using [Pyodide](https://pyodide.org) (Python compiled to WebAssembly). There's no server and no account, and **images never leave the user's computer**.

To turn the site on (one time): **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that, every push to `main` rebuilds the site automatically. Check progress under the **Actions** tab.

## Using it

- **Analyze real images:** set the image type, pixel size, the stain on each channel, and the group names in your file names. Drop in a folder of images, or try the sample data. The first visit takes about 30 seconds to load Python and its science libraries. Results include a summary, a group comparison with Welch's t-test, per-image values, review overlays, and CSV/zip downloads.
- **Experiments / New experiment:** the clickable demo of the full product experience, which uses synthetic images.

## What's in this repo

| Path | What it is |
|---|---|
| [`engine/`](engine/) | The Python analysis engine: segmentation, measurements, statistics, CSVs and overlays. Also has a command line (`fibersight analyze …`) and tests against synthetic sections with known answers. |
| [`prototype/`](prototype/) | The website (React + Vite). `public/pyworker.js` loads Pyodide and the engine in a Web Worker, and `src/Analyze.jsx` is the real-analysis page. The engine is copied in automatically at build time. |

### Run the site on your own computer

```bash
cd prototype && npm install && npm run dev
```

### Run the engine from the command line

```bash
cd engine && pip install -e . && fibersight demo -o demo
```

**Status:** v0.1 research prototype, accurate on synthetic test images (see `engine/README.md`). Validation on real lab images against hand counts is Specific Aim 1. Research use only. Not for diagnosis.

BENG 4080 project. Leads into our Specific Aims on ATP synthase c-subunit leak and skeletal muscle development.
