"""Build a tiny self-hosted Material Symbols Outlined font.

The full icon font is ~4 MB, so this keeps only the icons the site actually
uses (scanned from templates/ and content/), pinned at the axis values set in
assets/css/tailwind.input.css (FILL 0, wght 400, GRAD 0, opsz 24).

Re-run after adding a new icon name anywhere in the markup:
    pip install fonttools brotli
    npm install
    npm run build:icons
"""
import re
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "node_modules/material-symbols/material-symbols-outlined.woff2"
OUT = ROOT / "assets/fonts/material-symbols-outlined-subset.woff2"

ICON_RE = re.compile(r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<')


def used_icons():
    names = set()
    for folder in ("templates", "content"):
        for path in (ROOT / folder).rglob("*.html"):
            names.update(ICON_RE.findall(path.read_text(encoding="utf-8")))
    return sorted(names)


def ligature_glyphs(font, names):
    """Map each icon name to the glyph its ligature produces."""
    cmap = font.getBestCmap()
    wanted = {tuple(cmap[ord(c)] for c in name): name for name in names}
    found = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if sub.LookupType == 7:
                sub = sub.ExtSubTable
            if sub.LookupType != 4:
                continue
            for first, ligs in sub.ligatures.items():
                for lig in ligs:
                    seq = (first, *lig.Component)
                    if seq in wanted:
                        found[wanted[seq]] = lig.LigGlyph
    return found


def main():
    names = used_icons()
    font = TTFont(SRC)
    font = instancer.instantiateVariableFont(
        font, {"FILL": 0, "wght": 400, "GRAD": 0, "opsz": 24}
    )
    ligs = ligature_glyphs(font, names)
    missing = sorted(set(names) - set(ligs))
    if missing:
        raise SystemExit(f"Unknown Material Symbols icon(s): {', '.join(missing)}")

    cmap = font.getBestCmap()
    letters = {cmap[ord(c)] for name in names for c in name}

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["liga", "rlig", "calt", "ccmp"]
    options.layout_closure = False
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(glyphs=sorted(letters | set(ligs.values()) | {".notdef"}))
    subsetter.subset(font)
    font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"{len(names)} icons -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
