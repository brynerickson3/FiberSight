"""Fiber segmentation: turn an image into a label image (0 = background, 1..N = fibers).

Two engines:
  classical  membrane / tissue threshold + distance-transform watershed. No downloads,
             runs anywhere, works well on clean laminin/dystrophin and on brightfield.
  cellpose   Cellpose-SAM deep-learning model. Better on fixed, patchy or diseased
             tissue. Needs: pip install "fibersight[cellpose]" (downloads model weights
             on first use).
"""
import numpy as np
from scipy import ndimage as ndi
from skimage import filters, measure, morphology, segmentation


def _split_watershed(interior: np.ndarray, min_area_px: int) -> np.ndarray:
    """Split touching regions of a binary interior mask into separate fibers."""
    dist = ndi.distance_transform_edt(interior)
    dist = filters.gaussian(dist, sigma=1.5, preserve_range=True)
    # h-maxima: one seed per fiber, robust to irregular shapes
    h = max(1.5, 0.12 * np.sqrt(min_area_px))
    seeds = measure.label(morphology.h_maxima(dist, h))
    labels = segmentation.watershed(-dist, seeds, mask=interior)
    return labels


def _clean(labels, min_area_px, max_area_px):
    """Drop debris, background and badly merged blobs; relabel 1..N."""
    lut = np.zeros(labels.max() + 1, dtype=np.int32)
    k = 0
    for r in measure.regionprops(labels):
        if min_area_px <= r.area <= max_area_px and r.solidity > 0.75:
            k += 1
            lut[r.label] = k
    return lut[labels]


def classical_fluor(membrane: np.ndarray, min_area_px: int, max_area_px: int) -> np.ndarray:
    m = filters.gaussian(membrane, sigma=1.0)
    # ridge filter makes thin, faint membrane segments continuous
    ridge = filters.sato(m, sigmas=[1, 2], black_ridges=False)
    ridge = ridge / (ridge.max() + 1e-9)
    combo = np.maximum(m, ridge)
    mem = combo > filters.threshold_otsu(combo)
    mem = ndi.binary_closing(mem, morphology.disk(1), border_value=0) | mem
    interior = ~mem
    interior = ndi.binary_opening(interior, morphology.disk(2))
    labels = _split_watershed(interior, min_area_px)
    return _clean(labels, min_area_px, max_area_px)


def classical_bright(rgb: np.ndarray, min_area_px: int, max_area_px: int) -> np.ndarray:
    darkness = 1.0 - filters.gaussian(rgb.mean(axis=-1), sigma=1.0)
    stained = darkness > filters.threshold_otsu(darkness)
    # nuclei are dark too; fill small holes so they don't split fibers
    holes = ndi.binary_fill_holes(stained) & ~stained
    hl = measure.label(holes)
    small = np.bincount(hl.ravel()) < max(64, min_area_px // 4)
    small[0] = False
    stained = stained | small[hl]
    stained = ndi.binary_opening(stained, morphology.disk(2))
    labels = _split_watershed(stained, min_area_px)
    return _clean(labels, min_area_px, max_area_px)


def cellpose(image2d: np.ndarray, min_area_px: int, max_area_px: int) -> np.ndarray:
    try:
        from cellpose import models
    except ImportError as e:
        raise ImportError("The cellpose engine needs: pip install 'fibersight[cellpose]'") from e
    model = models.CellposeModel(gpu=False)
    masks = model.eval(image2d)[0]
    return _clean(masks.astype(np.int32), min_area_px, max_area_px)
