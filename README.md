# FiberSight

**Transforming Skeletal Muscle Histology Through Automated Image Analysis**

FiberSight measures muscle stain images automatically. A biologist chooses the stains they used, points FiberSight at a whole experiment, and gets fiber size, fiber type, stem-cell counts, % area stained and stain intensity, with the same settings applied to every image. Results come out as per-fiber, per-image and per-group CSVs.

| Folder | What it is |
|---|---|
| [`engine/`](engine/) | The Python analysis engine: segmentation, measurements, statistics, CSVs and overlays. Tested against synthetic sections with known answers. Start here. |
| [`prototype/`](prototype/) | Clickable React demo of the user experience, used in the class pitch. It runs entirely on synthetic images. |

```bash
cd engine && pip install -e . && fibersight demo -o demo
```

BENG 4080 project. Leads into our Specific Aims on ATP synthase c-subunit leak and skeletal muscle development.
