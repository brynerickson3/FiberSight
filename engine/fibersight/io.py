"""Reading images.

Fluorescence: returns float32 array (C, H, W), each channel scaled 0-1 by robust
percentiles. Brightfield: returns float32 RGB (H, W, 3) in 0-1.

TIFF, PNG and JPEG work out of the box. Microscope formats (.czi, .nd2, .lif) work
when the optional `bioio` readers are installed: pip install "fibersight[formats]".
"""
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

IMAGE_EXT = {".tif", ".tiff", ".png", ".jpg", ".jpeg", ".czi", ".nd2", ".lif"}


def list_images(folder):
    folder = Path(folder)
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXT and not p.name.startswith("."))


def _read_raw(path: Path) -> np.ndarray:
    ext = path.suffix.lower()
    if ext in {".tif", ".tiff"}:
        return tifffile.imread(path)
    if ext in {".png", ".jpg", ".jpeg"}:
        return np.asarray(Image.open(path))
    try:
        from bioio import BioImage  # optional dependency
    except ImportError as e:
        raise ImportError(f"Reading {ext} files needs: pip install 'fibersight[formats]'") from e
    img = BioImage(path)
    return np.asarray(img.get_image_data("CYX", T=0, Z=0))


def _scale(ch: np.ndarray) -> np.ndarray:
    ch = ch.astype(np.float32)
    lo, hi = np.percentile(ch, (0.5, 99.8))
    if hi <= lo:
        hi = lo + 1
    return np.clip((ch - lo) / (hi - lo), 0, 1)


def read_fluor(path, n_channels_expected=None) -> np.ndarray:
    a = np.squeeze(_read_raw(Path(path)))
    if a.ndim == 2:
        a = a[None]
    elif a.ndim == 3 and a.shape[-1] <= 8 and a.shape[0] > 8:   # H, W, C  ->  C, H, W
        a = np.moveaxis(a, -1, 0)
    if a.ndim != 3:
        raise ValueError(f"{Path(path).name}: expected a 2D multi-channel image, got shape {a.shape}")
    if n_channels_expected and a.shape[0] < n_channels_expected:
        raise ValueError(f"{Path(path).name} has {a.shape[0]} channels but the experiment lists {n_channels_expected}")
    return np.stack([_scale(c) for c in a])


def read_bright(path) -> np.ndarray:
    a = np.squeeze(_read_raw(Path(path)))
    if a.ndim == 3 and a.shape[0] in (3, 4) and a.shape[-1] not in (3, 4):
        a = np.moveaxis(a, 0, -1)
    if a.ndim != 3 or a.shape[-1] < 3:
        raise ValueError(f"{Path(path).name}: brightfield images must be RGB")
    a = a[..., :3].astype(np.float32)
    return a / (65535.0 if a.max() > 255 else 255.0)
