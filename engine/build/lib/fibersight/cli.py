"""Command line.

  fibersight analyze IMAGES_FOLDER -c experiment.yaml -o results/
  fibersight demo -o demo/            (synthetic experiment with known answers)
  fibersight stains                   (list every stain FiberSight knows)
"""
import argparse
import sys
import time
from pathlib import Path

from . import config, pipeline, report, stains, synth


def _progress(i, n, name):
    sys.stdout.write(f"\r  analyzed {i}/{n}  {name[:50]:<50}")
    sys.stdout.flush()
    if i == n:
        sys.stdout.write("\n")


def analyze(folder, cfg_path, out_dir, overlays=True):
    exp = config.load(cfg_path)
    t0 = time.time()
    print(f"FiberSight: {exp.name}")
    data, th = pipeline.run(folder, exp, _progress)
    fib, img, grp = report.write_all(data, exp, th, out_dir, overlays)
    print(f"  {len(img)} images, {int(img['n_fibers'].sum()):,} fibers in {time.time() - t0:.1f} s")
    print(f"  results written to {Path(out_dir).resolve()}")
    print((Path(out_dir) / "summary.md").read_text())
    return fib, img, grp


def main(argv=None):
    ap = argparse.ArgumentParser(prog="fibersight", description="Automated skeletal muscle histology analysis")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="analyze a folder of images")
    a.add_argument("folder")
    a.add_argument("-c", "--config", required=True, help="experiment YAML")
    a.add_argument("-o", "--out", default="fibersight_results")
    a.add_argument("--no-overlays", action="store_true")
    d = sub.add_parser("demo", help="generate a synthetic experiment and analyze it")
    d.add_argument("-o", "--out", default="fibersight_demo")
    d.add_argument("--mode", choices=["fluor", "bright"], default="fluor")
    d.add_argument("-n", type=int, default=6, help="images per group")
    sub.add_parser("stains", help="list known stains")
    args = ap.parse_args(argv)

    if args.cmd == "analyze":
        analyze(args.folder, args.config, args.out, not args.no_overlays)
    elif args.cmd == "demo":
        root = synth.make_experiment(args.out, n_per_group=args.n, mode=args.mode)
        analyze(root / "images", root / "experiment.yaml", root / "results")
    elif args.cmd == "stains":
        for s in sorted(stains.LIBRARY.values(), key=lambda s: (s.mode, s.kind, s.id)):
            print(f"{s.id:<16} {s.name:<30} {s.kind:<10} {s.mode:<7} {s.target}")


if __name__ == "__main__":
    main()
