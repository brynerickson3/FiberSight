"""Experiment configuration (YAML).

Example (fluorescence, one multi-channel TIFF per section):

    name: c-subunit leak satellite cells
    pixel_size_um: 0.65
    mode: fluor
    channels:            # channel index -> stain id
      0: dapi
      1: laminin
      2: pax7
      3: myod
    groups:              # first matching pattern wins (glob, case-insensitive)
      Wild-type: "*WT*"
      c-sub mutant: "*MUT*"
    animal_regex: "_M(\\d+)_"   # optional: pulls an animal ID from the file name

Brightfield (RGB images, stains separated by color):

    mode: bright
    stains: [hema, dab, apred]
"""
import fnmatch
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import stains as S


@dataclass
class Experiment:
    name: str = "experiment"
    pixel_size_um: float = 0.65
    mode: str = "fluor"
    channels: dict = field(default_factory=dict)       # fluor: {index: Stain}
    bright_stains: list = field(default_factory=list)  # bright: [Stain]
    groups: dict = field(default_factory=dict)         # {group name: glob}
    animal_regex: str = ""
    segmentation: str = "classical"                    # classical | cellpose
    min_fiber_um2: float = 100.0
    max_fiber_um2: float = 20000.0
    exclude_edge_fibers: bool = True
    thresholds: dict = field(default_factory=dict)     # optional manual thresholds {stain id: value 0-1}

    # ------------------------------------------------------------------
    @property
    def all_stains(self):
        return list(self.channels.values()) if self.mode == "fluor" else list(self.bright_stains)

    def stains_of(self, kind):
        return [s for s in self.all_stains if s.kind == kind]

    def group_of(self, filename: str) -> str:
        for g, pat in self.groups.items():
            if fnmatch.fnmatch(filename.lower(), pat.lower()):
                return g
        return "ungrouped"

    def animal_of(self, filename: str) -> str:
        if not self.animal_regex:
            return ""
        m = re.search(self.animal_regex, filename)
        return m.group(1) if m else ""


def load(path) -> Experiment:
    raw = yaml.safe_load(Path(path).read_text())
    return from_dict(raw)


def from_dict(raw: dict) -> Experiment:
    for c in raw.get("custom_stains", []) or []:
        S.LIBRARY[c["id"]] = S.Stain(
            id=c["id"], name=c.get("name", c["id"]), kind=c["kind"], mode=c.get("mode", "fluor"),
            target=c.get("target", "Custom"), marker=c.get("marker", c["id"] if c["kind"] == "marker" else ""),
            fibertype=c.get("fibertype", c.get("name", c["id"]) if c["kind"] == "fibertype" else ""),
            od_vector=tuple(c.get("od_vector", ())),
        )
    exp = Experiment(
        name=raw.get("name", "experiment"),
        pixel_size_um=float(raw.get("pixel_size_um", 0.65)),
        mode=raw.get("mode", "fluor"),
        groups=raw.get("groups", {}) or {},
        animal_regex=raw.get("animal_regex", ""),
        segmentation=raw.get("segmentation", "classical"),
        min_fiber_um2=float(raw.get("min_fiber_um2", 100)),
        max_fiber_um2=float(raw.get("max_fiber_um2", 20000)),
        exclude_edge_fibers=bool(raw.get("exclude_edge_fibers", True)),
        thresholds=raw.get("thresholds", {}) or {},
    )
    if exp.mode == "fluor":
        exp.channels = {int(k): S.get(v) for k, v in (raw.get("channels") or {}).items()}
        if not exp.stains_of("membrane"):
            raise ValueError("Fluorescence experiments need a membrane stain (laminin, dystrophin or WGA) to outline fibers.")
    elif exp.mode == "bright":
        exp.bright_stains = [S.get(s) for s in raw.get("stains", [])]
        for s in exp.bright_stains:
            if not s.od_vector:
                raise ValueError(f"Stain '{s.id}' has no od_vector, so it can't be separated from a brightfield image.")
    else:
        raise ValueError("mode must be 'fluor' or 'bright'")
    return exp
