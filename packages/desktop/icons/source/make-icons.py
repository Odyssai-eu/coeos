#!/usr/bin/env python3
"""Génère les jeux d'icônes Nemo (dev/beta/prod) depuis nemo-helmet.svg.

- full-bleed 1024 (le carré arrondi remplit le cadre) : icon.png, 32/64/128/128@2x, Square*Logo, StoreLogo, icon.ico
- inset macOS (carré 824 centré dans 1024 + ombre douce, comme l'icône précédente, bbox 100..924) : icon.icns, dock.png
- favicon-v3 (svg/png/ico) dans packages/app/public, splash 512 dans packages/ui/src/assets
Rasterisation SVG par QuickLook (qlmanage), aucun outil externe.
"""
import glob, os, shutil, subprocess, sys
from pathlib import Path
from PIL import Image, ImageFilter

HERE = Path(__file__).parent  # packages/desktop/icons/source
REPO = HERE.parents[3]
ICONS = REPO / "packages/desktop/icons"
PUBLIC = REPO / "packages/app/public"
SPLASH = REPO / "packages/ui/src/assets/codeos-splash.png"

BASE = (HERE / "nemo-helmet.svg").read_text(encoding="utf-8")
PROD_STOPS = ('<stop offset="0" stop-color="#16456B"/>', '<stop offset="1" stop-color="#061A2C"/>')
CHANNELS = {
    "prod": PROD_STOPS,                                    # bleu profond
    "beta": ('<stop offset="0" stop-color="#13574F"/>', '<stop offset="1" stop-color="#06231F"/>'),  # vert-bleu
    "dev":  ('<stop offset="0" stop-color="#3A3F47"/>', '<stop offset="1" stop-color="#14171B"/>'),  # graphite
}
assert all(s in BASE for s in PROD_STOPS), "gradient de fond introuvable dans le SVG"


def rasterize(svg_text: str, name: str) -> Image.Image:
    out = Path("/tmp/nemo-icons-build")
    out.mkdir(exist_ok=True)
    svg = out / f"{name}.svg"
    svg.write_text(svg_text, encoding="utf-8")
    png = out / f"{name}.svg.png"
    png.unlink(missing_ok=True)
    subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", str(out), str(svg)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    im = Image.open(png).convert("RGBA")
    assert im.size == (1024, 1024), im.size
    return im


def inset(full: Image.Image) -> Image.Image:
    """Carré 824 centré dans 1024 + ombre douce (Big Sur)."""
    art = full.resize((824, 824), Image.LANCZOS)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mask = art.split()[3]
    sh = Image.new("RGBA", (824, 824), (0, 0, 0, 90))
    shadow.paste(sh, (100, 112), mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(art, (100, 100))
    return canvas


def save(im, path, size=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    (im.resize((size, size), Image.LANCZOS) if size else im).save(path, optimize=True)


def icns(mac: Image.Image, dest: Path):
    iconset = HERE / "build" / f"{dest.stem}-{dest.parent.name}.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    for base in (16, 32, 128, 256, 512):
        save(mac, iconset / f"icon_{base}x{base}.png", base)
        save(mac, iconset / f"icon_{base}x{base}@2x.png", base * 2)
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest)], check=True)


for channel, stops in CHANNELS.items():
    svg = BASE.replace(PROD_STOPS[0], stops[0]).replace(PROD_STOPS[1], stops[1])
    full = rasterize(svg, f"nemo-{channel}")
    mac = inset(full)
    d = ICONS / channel
    # full-bleed (Windows / Linux / source)
    save(full, d / "icon.png")
    for s in (32, 64, 128):
        save(full, d / f"{s}x{s}.png", s)
    save(full, d / "128x128@2x.png", 256)
    for f in glob.glob(str(d / "Square*Logo.png")) + [str(d / "StoreLogo.png")]:
        p = Path(f)
        if p.exists():
            w, h = Image.open(p).size
            save(full, p, w)
    full.save(d / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    # macOS
    icns(mac, d / "icon.icns")
    save(mac, d / "dock.png", 256)
    print(f"{channel}: ok")

# favicon-v3 (app web + renderer desktop) = version prod, full-bleed
prod_full = rasterize(BASE, "nemo-prod")
(PUBLIC / "favicon-v3.svg").write_text(BASE, encoding="utf-8")
save(prod_full, PUBLIC / "favicon-96x96-v3.png", 96)
prod_full.save(PUBLIC / "favicon-v3.ico", sizes=[(48, 48), (32, 32)])
# splash 512 (même inset que l'ancien : bbox ~ 50..462)
save(prod_full, SPLASH, 512)  # le splash actuel est full-bleed (bbox 0..512)
print("favicon + splash: ok")
