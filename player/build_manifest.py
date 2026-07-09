#!/usr/bin/env python3
"""
Build manifest.json for the Eureka Express Open Player.

Scans a folder of Express simulation JSONs and emits a lightweight catalog
(id, name, truncated description, category, level, rounds, relative path,
optional SVG thumbnail). The player fetches each full JSON lazily on demand.

Usage (from the player/ folder):
    python build_manifest.py                          # uses ../jsons and ../svgs
    python build_manifest.py --jsons ../jsons --svgs ../svgs --out manifest.json
"""
import argparse
import collections
import json
import os
import re
import sys
import time

DESC_LEN = 200


def relhref(target, outdir):
    return os.path.relpath(target, outdir).replace(os.sep, "/")


def find_svg(svgs, svg_dir, outdir, stem, eid):
    cands = []
    if eid:
        cands.append(eid + ".svg")
    m = re.match(r"^(\d+)", stem)
    if m:
        cands += [m.group(1) + ".svg", m.group(1).zfill(3) + ".svg"]
    cands.append(stem + ".svg")
    for c in cands:
        if c in svgs:
            return relhref(os.path.join(svg_dir, c), outdir)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsons", default="../jsons", help="folder with {externalid}.json files")
    ap.add_argument("--svgs", default="../svgs", help="folder with SVG thumbnails (optional)")
    ap.add_argument("--out", default="manifest.json")
    a = ap.parse_args()

    outdir = os.path.dirname(os.path.abspath(a.out)) or "."
    svgs = set(os.listdir(a.svgs)) if os.path.isdir(a.svgs) else set()

    sims, skipped = [], []
    cats = collections.Counter()

    for fn in sorted(os.listdir(a.jsons)):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(a.jsons, fn)
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception as e:
            skipped.append((fn, f"parse error: {e}"))
            continue
        if not isinstance(d, dict) or "view" not in d or "js" not in d:
            skipped.append((fn, "not a simulation payload"))
            continue
        stem = fn[:-5]
        eid = str(d.get("externalid") or "").strip() or stem
        desc = (d.get("description") or "").strip()
        if len(desc) > DESC_LEN:
            desc = desc[: DESC_LEN - 1].rsplit(" ", 1)[0] + "…"
        cat = (d.get("category") or "other").strip().lower()
        cats[cat] += 1
        sims.append({
            "id": eid,
            "file": fn,
            "path": relhref(path, outdir),
            "name": (d.get("name") or "").strip() or stem,
            "desc": desc,
            "cat": cat,
            "level": (d.get("level") or "").strip().lower(),
            "periods": d.get("max_periods"),
            "svg": find_svg(svgs, a.svgs, outdir, stem, eid),
            "usf": "USF.SimulationAdapter" in (d.get("js") or ""),
        })

    def sortkey(s):
        m = re.match(r"^(\d+)", s["id"])
        return (int(m.group(1)) if m else 10 ** 9, s["id"])

    sims.sort(key=sortkey)

    manifest = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "count": len(sims),
        "categories": dict(cats),
        "sims": sims,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    non_usf = [s["id"] for s in sims if not s["usf"]]
    print(f"Wrote {a.out}: {len(sims)} sims, {len(skipped)} skipped, "
          f"{sum(1 for s in sims if s['svg'])} with thumbnails, "
          f"size {os.path.getsize(a.out) // 1024} KB")
    if non_usf:
        print(f"  note — {len(non_usf)} sims don't use the USF adapter and may not run: {non_usf}")
    for fn, why in skipped:
        print(f"  skipped {fn}: {why}", file=sys.stderr)


if __name__ == "__main__":
    main()
