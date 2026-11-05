# FiberSight prototype

Clickable demo for the pitch **Transforming Skeletal Muscle Histology Through Automated Image Analysis**.

All images are synthetic and generated in the browser. Nothing is real lab data, and dropped files are never uploaded or read.

## What it shows
- **Any stain panel:** pick from fluorescence (DAPI, laminin, dystrophin, Pax7, MyoD, Ki67, MyHC I/IIa/IIb, eMyHC, collagen) or brightfield (hematoxylin, DAB, AP Red, picrosirius red), or add your own antibody. FiberSight works out which measurements apply.
- **Whole experiments at once:** three sample experiments of 104–128 images each, analyzed with identical settings.
- **Time saved:** a manual estimate (minutes per image, editable) compared with analysis time plus review of flagged images.
- **QC flags:** tissue folds and out-of-focus images are flagged. Fibers on edges or under folds are excluded automatically.
- **Review:** toggle channels and the segmentation overlay, then click a fiber to exclude it. Results update instantly.
- **Results:** dot + bar charts per measure, a fiber size histogram, Welch's t-test, and CSV export.

## Run it
```
npm install
npm run dev
```
