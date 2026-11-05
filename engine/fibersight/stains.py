"""Stain library.

Every stain is one of six measurement kinds. A recipe for a new stain is just a
new entry here: no new analysis code is needed unless it introduces a new kind.

kind:
  membrane   outlines fibers (laminin, dystrophin, WGA). Used for segmentation.
  nuclear    marks all nuclei (DAPI, Hoechst, hematoxylin).
  marker     marks a subset of nuclei that we count (Pax7, MyoD, Ki67, myogenin).
  fibertype  fills whole fibers of one type (MyHC I/IIa/IIb, eMyHC, or SDH/NADH high).
  area       % of tissue area covered (collagen, picrosirius red, Oil Red O, trichrome blue).
  intensity  mean stain intensity per fiber (DAB, PAS, SDH, COX, phosphorylase).

mode:
  fluor   one image channel per stain
  bright  RGB brightfield image; the stain is pulled out by color deconvolution
"""
from dataclasses import dataclass, field


@dataclass
class Stain:
    id: str
    name: str
    kind: str
    mode: str = "fluor"
    target: str = ""
    marker: str = ""        # for kind == marker: column name used in outputs
    fibertype: str = ""     # for kind == fibertype: label written to fiber_type
    od_vector: tuple = ()   # for brightfield: RGB optical-density vector of the dye
    extra: dict = field(default_factory=dict)


# Optical density vectors (R, G, B) for brightfield dyes. Hematoxylin, eosin and
# DAB are the standard Ruifrok & Johnston values used by scikit-image / ImageJ.
OD = {
    "hematoxylin": (0.65, 0.70, 0.29),
    "eosin": (0.07, 0.99, 0.11),
    "dab": (0.27, 0.57, 0.78),
    "red": (0.21, 0.85, 0.48),          # fast red / AP red / picrosirius red (approx.)
    "blue": (0.83, 0.42, 0.37),         # aniline / light green collagen in trichrome (approx.)
    "pas": (0.18, 0.89, 0.42),          # PAS magenta (approx.)
    "oilred": (0.10, 0.80, 0.60),       # Oil Red O (approx.)
    "nbt": (0.70, 0.62, 0.36),          # NADH-TR / SDH formazan, blue-purple (approx.)
}

LIBRARY = {s.id: s for s in [
    # ---- immunofluorescence
    Stain("dapi", "DAPI", "nuclear", target="All nuclei"),
    Stain("hoechst", "Hoechst", "nuclear", target="All nuclei"),
    Stain("laminin", "Laminin", "membrane", target="Fiber membrane"),
    Stain("dystrophin", "Dystrophin", "membrane", target="Fiber membrane"),
    Stain("wga", "WGA", "membrane", target="Fiber membrane"),
    Stain("pax7", "Pax7", "marker", marker="pax7", target="Satellite (stem) cells"),
    Stain("myod", "MyoD", "marker", marker="myod", target="Activated myoblasts"),
    Stain("myog", "Myogenin", "marker", marker="myogenin", target="Differentiating myoblasts"),
    Stain("ki67", "Ki67", "marker", marker="ki67", target="Proliferating cells"),
    Stain("mhc1", "MyHC I", "fibertype", fibertype="I", target="Slow fibers"),
    Stain("mhc2a", "MyHC IIa", "fibertype", fibertype="IIa", target="Fast oxidative fibers"),
    Stain("mhc2b", "MyHC IIb", "fibertype", fibertype="IIb", target="Fast glycolytic fibers"),
    Stain("emhc", "eMyHC", "fibertype", fibertype="regenerating", target="Regenerating fibers"),
    Stain("col1", "Collagen I", "area", target="Fibrosis / ECM"),
    Stain("desmin_if", "Desmin", "intensity", target="Desmin content"),
    # ---- brightfield (RGB, color deconvolution)
    Stain("hema", "Hematoxylin", "nuclear", "bright", "Nuclei", od_vector=OD["hematoxylin"]),
    Stain("eosin", "Eosin", "intensity", "bright", "Cytoplasm", od_vector=OD["eosin"]),
    Stain("dab", "DAB", "intensity", "bright", "IHC target (e.g. myosin)", od_vector=OD["dab"]),
    Stain("apred", "AP Red", "area", "bright", "IHC target (e.g. actin)", od_vector=OD["red"]),
    Stain("sirius", "Picrosirius red", "area", "bright", "Collagen", od_vector=OD["red"]),
    Stain("trichrome_blue", "Masson's trichrome (collagen)", "area", "bright", "Collagen", od_vector=OD["blue"]),
    Stain("oilred", "Oil Red O", "area", "bright", "Neutral lipid", od_vector=OD["oilred"]),
    Stain("pas", "PAS", "intensity", "bright", "Glycogen", od_vector=OD["pas"]),
    Stain("sdh", "SDH / NADH-TR", "intensity", "bright", "Oxidative capacity", od_vector=OD["nbt"]),
]}


def get(stain_id: str) -> Stain:
    if stain_id not in LIBRARY:
        raise KeyError(f"Unknown stain '{stain_id}'. Known: {', '.join(sorted(LIBRARY))}. "
                       "Add a custom stain in your experiment file under custom_stains.")
    return LIBRARY[stain_id]
