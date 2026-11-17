#!/usr/bin/env python3
"""
Build ../sitemap.xml for open.eurekasimulations.com from manifest.json.

Lists the landing page, the player's catalog and one URL per simulation and
page language (player/index.html?sim=NNN&lang=xx), each with its hreflang
alternates. The case study of a sim opens inside that sim's page, so it has no
URL of its own; the sim's URL covers it.

The URLs and their alternates must match what index.html's eurekaHead() writes
as canonical and hreflang, or search engines will ignore them.

lastmod is the date of the last commit that touched the sim's JSON (or case),
so a sitemap rebuilt without content changes stays byte-identical.

Usage (from the player/ folder, after build_manifest.py):
    python build_sitemap.py
    python build_sitemap.py --manifest manifest.json --out ../sitemap.xml
"""
import argparse
import json
import os
import subprocess
import sys
from xml.sax.saxutils import escape

SITE = "https://open.eurekasimulations.com"
PLAYER = SITE + "/player/index.html"
PAGE_LANGS = ("en", "es")  # the languages the site's chrome speaks


def last_commit_dates(repo, paths):
    """{repo-relative path: YYYY-MM-DD of its last commit}, in one git call."""
    out = subprocess.run(
        ["git", "-C", repo, "log", "--format=@%cs", "--name-only", "--"] + list(paths),
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    dates, day = {}, None
    for line in out.splitlines():
        if line.startswith("@"):
            day = line[1:]
        elif line and day:
            dates.setdefault(line.strip(), day)
    return dates


def url_entry(loc, alternates, lastmod):
    lines = ["  <url>", "    <loc>%s</loc>" % escape(loc)]
    if lastmod:
        lines.append("    <lastmod>%s</lastmod>" % lastmod)
    for hreflang, href in alternates:
        lines.append('    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (hreflang, escape(href)))
    lines.append("  </url>")
    return "\n".join(lines)


def page_group(urls, lastmod):
    """One <url> per language of a page, each listing every alternate."""
    alts = [(l, urls[l]) for l in PAGE_LANGS] + [("x-default", urls["x-default"])]
    return [url_entry(urls[l], alts, lastmod) for l in PAGE_LANGS]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", default=os.path.join(here, "manifest.json"))
    ap.add_argument("--out", default=os.path.join(here, "..", "sitemap.xml"))
    args = ap.parse_args()

    repo = os.path.abspath(os.path.join(here, ".."))
    with open(args.manifest, encoding="utf-8") as fh:
        manifest = json.load(fh)
    sims = manifest["sims"]

    def repo_path(rel):  # manifest paths are relative to player/
        return os.path.relpath(os.path.normpath(os.path.join(here, rel)), repo).replace(os.sep, "/")

    tracked = {}
    for s in sims:
        tracked[s["id"]] = [repo_path(s["path"])] + ([repo_path(s["case"])] if s.get("case") else [])
    dates = last_commit_dates(repo, ["jsons", "cases", "index.html", "player/index.html", "player/js"])
    site_date = max([d for d in dates.values()] or [""])

    def newest(paths):
        return max([dates.get(p, "") for p in paths] or [""]) or None

    entries = []
    # the landing page keeps a static canonical of "/" for every ?lang=, so only "/" is listed
    entries.append(url_entry(SITE + "/", [("en", SITE + "/?lang=en"), ("es", SITE + "/?lang=es"),
                                          ("x-default", SITE + "/")], newest(["index.html"]) or site_date))
    entries += page_group({"en": PLAYER + "?lang=en", "es": PLAYER + "?lang=es", "x-default": PLAYER},
                          newest(["player/index.html"]) or site_date)

    skipped = []
    for s in sorted(sims, key=lambda s: (len(s["id"]), s["id"])):
        if not set(PAGE_LANGS) <= set(s.get("langs") or []):
            skipped.append(s["id"])
            continue
        sim_url = PLAYER + "?sim=" + s["id"]
        urls = {l: sim_url + "&lang=" + l for l in PAGE_LANGS}
        urls["x-default"] = urls["en"]
        entries += page_group(urls, newest(tracked[s["id"]]))

    xml = "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ] + entries + ["</urlset>", ""])
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(xml)

    print("Wrote %s: %d URLs (%d sims x %d languages, plus landing and catalog)"
          % (os.path.relpath(args.out), len(entries), len(sims) - len(skipped), len(PAGE_LANGS)))
    if skipped:
        # eurekaHead() advertises en and es for every sim; one without both would
        # point an hreflang at a page that cannot show it
        print("  note — %d sims left out, they lack en or es: %s" % (len(skipped), skipped[:20]), file=sys.stderr)


if __name__ == "__main__":
    main()
