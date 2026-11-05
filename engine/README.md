# FiberSight engine

The analysis engine behind FiberSight. Point it at a folder of muscle section images and an experiment file that lists the stains you used. You get back:
- every fiber measured
- three CSV files
- a plain-English summary
- an overlay image for each section, so you can check the results

**Status: v0.1, research prototype.** It is tested against synthetic sections with known answers (below). It has not yet been validated on real lab images. That validation is Specific Aim 1.

## Install

```bash
cd engine
pip install -e .                 # core: TIFF / PNG / JPEG, classical segmentation
pip install -e ".[cellpose]"     # optional: Cellpose-SAM deep-learning segmentation
pip install -e ".[formats]"      # optional: .czi / .nd2 / .lif microscope files
```

## Try it in one command

```bash
fibersight demo -o demo                   # 12 synthetic fluorescence sections, wild-type vs. mutant
fibersight demo -o demo_ihc --mode bright # brightfield DAB + hematoxylin
```

## Analyze your own images

1. Put one experiment's images in a folder. Name the files so the group and animal can be read from them, for example `WT_M3_s02.tif`.
2. Copy an example from `examples/` and edit it:
   - the channel order
   - the pixel size (µm per pixel)
   - the patterns that match file names to groups
3. Run:

```bash
fibersight analyze path/to/images -c my_experiment.yaml -o results
```

| Output | What's in it |
|---|---|
| `per_fiber.csv` | One row per fiber: area (CSA, µm²), min Feret diameter, position, fiber type, nuclei, central nucleus, marker+ cells, stain intensities, and whether it was excluded (touching the image edge) |
| `per_image.csv` | One row per image: mean/median CSA, size variability (CV), % of each fiber type, % central nuclei, marker+ cells per 100 fibers, % area stained, mean intensity, and quality flags |
| `per_group.csv` | One row per measure: group mean, SD and n (animals when `animal_regex` is set, otherwise images), Welch's t-test, % difference from the reference group |
| `summary.md` | Significant differences in plain English, images to review, thresholds used |
| `overlays/` | Each image with fiber outlines (yellow, or gray if excluded), fiber-type dots, Pax7/marker cells circled, central nuclei boxed |

`fibersight stains` lists every stain it knows.

## How it works

Every stain is one of six measurement types. Adding a stain is a one-line entry in `fibersight/stains.py` or a `custom_stains` block in your experiment file.

| Type | Examples | What gets measured |
|---|---|---|
| membrane | laminin, dystrophin, WGA | outlines the fibers (segmentation) |
| nuclear | DAPI, Hoechst, hematoxylin | nuclei per fiber, central nuclei |
| marker | Pax7, MyoD, myogenin, Ki67 | positive cells per 100 fibers |
| fibertype | MyHC I / IIa / IIb, eMyHC | % of each fiber type (IIx = negative for all), hybrids |
| area | collagen, picrosirius red, trichrome, Oil Red O | % of tissue area stained |
| intensity | DAB, PAS, SDH/NADH-TR, eosin | mean stain per fiber |

The pipeline runs in two passes:
1. **Each image:** fibers are outlined, then each fiber and each nucleus is measured.
   - Fluorescence: membrane ridge filter plus watershed.
   - Brightfield: tissue threshold plus watershed, after color deconvolution splits the image into separate stains.
2. **The whole experiment:** thresholds for positive/negative calls are chosen from all images together, so every image follows the same rule. They are listed in `summary.md` and can be fixed by hand under `thresholds:`.

## Accuracy on synthetic sections (`pytest tests -q`)

| Check | Result |
|---|---|
| Fibers found | 100% |
| Fiber area error (median) | about 1% (fluorescence and brightfield) |
| Fiber type accuracy (I / IIa / IIb / IIx) | 100% |
| Central nucleus calls | about 99% agreement |
| Pax7+ cell counts | within about 10% of true totals |

Synthetic images are cleaner than real tissue. Real-image accuracy has to be measured against hand counts, which is the Aim 1 validation.

## Known limits (v0.1)

- **Classical segmentation needs a fairly continuous membrane stain.** For fixed, patchy or badly damaged tissue, use `segmentation: cellpose`.
- **Brightfield stain colors use standard values.** Unusual dyes may need a custom `od_vector`.
- **Fibers touching the image edge are excluded from fiber sizes.** Their nuclei still count toward nucleus totals.
- **Not yet supported:** serial-section analysis (myosin ATPase at different pH) and pattern recognition (ragged-red, target fibers).
- **Research use only. Not for diagnosis.**
