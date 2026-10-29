#!/usr/bin/env python3
"""
Build manifest.json for the Eureka Express Open Player.

Scans a folder of Express simulation JSONs and emits a lightweight catalog
(id, name, truncated description, category, level, rounds, languages, relative
path, optional SVG thumbnail). The player fetches each full JSON lazily on
demand.

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
BS = "\\"
LANG_RE = re.compile(r"^[a-z]{2}(-[A-Za-z]{2})?$")


def relhref(target, outdir):
    return os.path.relpath(target, outdir).replace(os.sep, "/")


def _skip_string(src, i):
    """src[i] is a quote; return the index just past the closing quote."""
    q = src[i]
    i += 1
    n = len(src)
    while i < n:
        if src[i] == BS:
            i += 2
            continue
        if src[i] == q:
            return i + 1
        i += 1
    return n


def translation_tables(js):
    """{lang: source text of its table} from a sim's getTranslations().

    Sims declare their i18n tables as `getTranslations() { return { en: {…},
    es: {…} } }` (sometimes via a local const). Parsed with a small brace
    walker rather than a regex so that strings, template literals and comments
    inside the tables can't produce phantom languages.
    """
    m = re.search(r"getTranslations\s*\([^)]*\)\s*\{", js or "")
    if not m:
        return {}
    body = js[m.end():]
    r = re.search(r"return\s*(\{|[A-Za-z_$][\w$]*)", body)
    if not r:
        return {}
    if r.group(1) == "{":
        start = r.start(1)
    else:
        var = re.search(r"(?:const|let|var)\s+%s\s*=\s*\{" % re.escape(r.group(1)), body)
        if not var:
            return {}
        start = var.end() - 1

    tables, open_lang, depth, i, n = {}, None, 1, start + 1, len(body)
    while i < n and depth >= 1:
        ch = body[i]
        if ch in "\"'`":
            i = _skip_string(body, i)
            continue
        if ch == "/" and i + 1 < n and body[i + 1] == "/":
            i = body.find("\n", i)
            if i < 0:
                break
            continue
        if ch == "/" and i + 1 < n and body[i + 1] == "*":
            j = body.find("*/", i)
            i = (j + 2) if j >= 0 else n
            continue
        if ch in "{[(":
            depth += 1
            i += 1
            continue
        if ch in "}])":
            depth -= 1
            if depth == 0:
                break
            if depth == 1 and open_lang:
                tables[open_lang[0]] = body[open_lang[1]:i + 1]
                open_lang = None
            i += 1
            continue
        if depth == 1 and (body[i - 1] in "{," or body[i - 1].isspace()):
            k = re.match(r"\s*(?:([A-Za-z_$][\w$-]*)|['\"]([\w$-]+)['\"])\s*:\s*\{", body[i:])
            if k:
                name = k.group(1) or k.group(2)
                i += k.end() - 1
                if LANG_RE.match(name) and name not in tables:
                    open_lang = (name, i)
                continue
        i += 1
    return tables


def sim_langs(js):
    """Language codes a sim's getTranslations() returns, e.g. ['en', 'es']."""
    return list(translation_tables(js))


def _js_unescape(s):
    simple = {"n": "\n", "t": "\t", "r": "", "b": "", "f": "", "v": "", "0": ""}

    def rep(m):
        e = m.group(1)
        if e[0] == "u":
            return chr(int(e[1:].strip("{}"), 16))
        if e[0] == "x":
            return chr(int(e[1:], 16))
        return simple.get(e, e)
    out = re.sub(r"\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", rep, s)
    # emoji written as \uD83C\uDFxx pairs come out as lone surrogates — join them
    return out.encode("utf-16", "surrogatepass").decode("utf-16", "replace")


def sim_names(d, tables):
    """{lang: the sim's own title in that language}, read from the i18n key on
    the view's first <h1> — the title the sim itself shows once it runs. Lets
    the catalog and the preview name a sim in the page language; the JSON's
    `name` field ships in one language only."""
    h1 = re.search(r"<h1\b[^>]*\bdata-i18n=\"([^\"]+)\"", d.get("view") or "")
    if not h1:
        return {}
    key, names = re.escape(h1.group(1)), {}
    for lg, src in tables.items():
        v = re.search(r"(?:^|[{,\s])(?:%s|['\"]%s['\"])\s*:\s*(['\"`])((?:\\.|(?!\1).)*)\1" % (key, key), src, re.S)
        if not v or (v.group(1) == "`" and "${" in v.group(2)):
            continue
        text = re.sub(r"<[^>]+>", "", _js_unescape(v.group(2)))
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            names[lg] = text
    return names


CASE_STOPWORDS = {
    "en": ("the", "and", "of", "to", "was", "had", "with"),
    "es": ("el", "la", "los", "las", "del", "que", "con"),
    "pt": ("o", "os", "as", "do", "da", "não", "com"),
}


def case_lang(text):
    """Language of a case study, by stopword count (cases ship in one language)."""
    words = re.findall(r"[a-záéíóúãõçñ]+", text.lower())
    counts = {lg: sum(1 for w in words if w in sw) for lg, sw in CASE_STOPWORDS.items()}
    return max(counts, key=counts.get)


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
    ap.add_argument("--covers", default="../covers", help="folder with {externalid}.webp cover images (optional, preferred over SVGs)")
    ap.add_argument("--cases", default="../cases", help="folder with {externalid}.md case studies (optional)")
    ap.add_argument("--out", default="manifest.json")
    a = ap.parse_args()

    outdir = os.path.dirname(os.path.abspath(a.out)) or "."
    svgs = set(os.listdir(a.svgs)) if os.path.isdir(a.svgs) else set()
    cases = set(os.listdir(a.cases)) if os.path.isdir(a.cases) else set()
    covers = set(os.listdir(a.covers)) if os.path.isdir(a.covers) else set()

    sims, skipped = [], []
    cats = collections.Counter()
    langcount = collections.Counter()

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
        # declaration order in getTranslations() carries no meaning — normalise
        # it (English first, then alphabetical) so badges render consistently
        tables = translation_tables(d.get("js") or "")
        langs = sorted(list(tables) or ["en"], key=lambda l: (l != "en", l))
        for lg in langs:
            langcount[lg] += 1
        name = (d.get("name") or "").strip() or stem
        entry = {
            "id": eid,
            "file": fn,
            "path": relhref(path, outdir),
            "name": name,
            "desc": desc,
            "cat": cat,
            "level": (d.get("level") or "").strip().lower(),
            "periods": d.get("max_periods"),
            "langs": langs,
            "svg": find_svg(svgs, a.svgs, outdir, stem, eid),
            "usf": "USF.SimulationAdapter" in (d.get("js") or ""),
        }
        # the sim's own title in other languages; English keeps the catalog `name`
        names = {lg: v for lg, v in sim_names(d, tables).items() if lg != "en" and v != name}
        if names:
            entry["names"] = names
        # optional raster cover, covers/{externalid}.webp — shown instead of the SVG
        if eid + ".webp" in covers:
            entry["cover"] = relhref(os.path.join(a.covers, eid + ".webp"), outdir)
        # optional case study, cases/{externalid}.md — all rights reserved, see LICENSE.md
        if eid + ".md" in cases:
            case_path = os.path.join(a.cases, eid + ".md")
            with open(case_path, encoding="utf-8") as f:
                entry["case"] = relhref(case_path, outdir)
                entry["caseLang"] = case_lang(f.read())
        sims.append(entry)

    def sortkey(s):
        m = re.match(r"^(\d+)", s["id"])
        return (int(m.group(1)) if m else 10 ** 9, s["id"])

    sims.sort(key=sortkey)

    manifest = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "count": len(sims),
        "categories": dict(cats),
        "languages": dict(langcount),
        "cases": sum(1 for s in sims if s.get("case")),
        "sims": sims,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    non_usf = [s["id"] for s in sims if not s["usf"]]
    monolingual = [s["id"] for s in sims if len(s["langs"]) < 2]
    print(f"Wrote {a.out}: {len(sims)} sims, {len(skipped)} skipped, "
          f"{sum(1 for s in sims if s['svg'])} with thumbnails, "
          f"{sum(1 for s in sims if s.get('cover'))} with covers, "
          f"{manifest['cases']} with a case study, "
          f"{sum(1 for s in sims if s.get('names'))} with translated titles, "
          f"languages {dict(langcount)}, "
          f"size {os.path.getsize(a.out) // 1024} KB")
    if monolingual:
        print(f"  note — {len(monolingual)} sims ship a single language: {monolingual[:20]}")
    if non_usf:
        print(f"  note — {len(non_usf)} sims don't use the USF adapter and may not run: {non_usf}")
    for fn, why in skipped:
        print(f"  skipped {fn}: {why}", file=sys.stderr)


if __name__ == "__main__":
    main()
