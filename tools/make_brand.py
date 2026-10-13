# EYRIVO marka varlıkları: SVG kaynakları (brand/) + PWA PNG'leri (icons/) + iOS açılış görselleri.
# Kullanım: python3 tools/make_brand.py        Gerekenler: playwright (Chromium), Pillow, fontTools, Inter-SemiBold.otf (OFL-1.1)
# Sembol kendi çizimimizdir (3 eğik bant, düz çokgenler). EYRIVO yazısı Inter SemiBold (SIL OFL 1.1) konturlarından çıkarılmış
# yazı yolu olarak gömülür; çalışma zamanında yazı tipi gerekmez. Lisans notu: licenses/Inter-OFL-NOTICE.md
import os, io, glob, sys
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BRAND = os.path.join(ROOT, 'brand'); ICONS = os.path.join(ROOT, 'icons'); SPLASH = os.path.join(ICONS, 'splash')
for d in (BRAND, ICONS, SPLASH): os.makedirs(d, exist_ok=True)
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'

# ---------- Renkler ----------
CYAN = ('#00E5FF', '#00B8D4', '#0088A8')      # koyu zemin için sembol (elektrik cyan → turkuaz)
DARK = ('#131A21', '#1B5A70', '#0E87A0')      # açık zemin için koyu sembol
BG_TOP, BG_BOT = '#222A32', '#12171D'         # koyu antrasit zemin (app icon / splash)
WHITE_T, DARK_T = '#FFFFFF', '#15191E'

# ---------- Sembol: 3 eğik bant (100x100 kutuda ortalı) ----------
def mark_polys():
    s = 13; dx, dy = -0.5, 0.5
    def bar(y1, y2, xl, xr): return [(xl+s+dx, y1+dy), (xr+s+dx, y1+dy), (xr+dx, y2+dy), (xl+dx, y2+dy)]
    return [bar(10, 31, 4, 84), bar(39, 60, 26, 80), bar(68, 89, 50, 76)]
def d_of(p): return 'M' + 'L'.join(f'{x:g} {y:g}' for x, y in p) + 'Z'
def mark_paths(fills, var=True, transform=''):
    names = ('--eyrivo-1', '--eyrivo-2', '--eyrivo-3')
    out = ''
    for i, p in enumerate(mark_polys()):
        f = f'var({names[i]},{fills[i]})' if var else fills[i]
        out += f'<path fill="{f}" d="{d_of(p)}"/>'
    return f'<g{(" transform=" + chr(34) + transform + chr(34)) if transform else ""}>{out}</g>' if transform else out

# ---------- Yazı: EYRIVO yolu ----------
def wordmark(cap_h=34.0, tracking=0.16):
    f = TTFont(FONT); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
    cap = f['OS/2'].sCapHeight; sc = cap_h / cap; trk = tracking * upm * sc
    x = 0; segs = []; x0 = None; x1 = 0
    for i, ch in enumerate('EYRIVO'):
        g = gs[cmap[ord(ch)]]; bp = BoundsPen(gs); g.draw(bp); xmin, _, xmax, _ = bp.bounds
        if x0 is None: x0 = x + xmin * sc
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.1f}')
        g.draw(TransformPen(pen, (sc, 0, 0, -sc, x, cap_h)))
        segs.append(pen.getCommands()); x1 = x + xmax * sc
        x += g.width * sc + trk
    d = ''.join(segs)
    return d, x0, x1 - x0     # yol (0..cap_h yüksekliğinde), sol kenar, ink genişliği
WD, WX0, WW = wordmark()

def word_group(fill, tx, ty): return f'<path fill="{fill}" transform="translate({tx - WX0:.1f} {ty:.1f})" d="{WD}"/>'

# ---------- SVG parçaları ----------
def svg(w, h, body, vb=None): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb or f"0 0 {w} {h}"}">{body}</svg>\n'
def lockup(fills, text_fill, var=True):
    gap = 24; tx = 100 + gap; cap = 34.0
    W = tx + WW
    t = f'var(--eyrivo-text,{text_fill})' if var else text_fill
    return svg(W, 100, mark_paths(fills, var) + word_group(t, tx, 50 - cap / 2), vb=f'0 0 {W:.0f} 100')
def tile(size, rx_pct, scale, fills, grad=True, flat=None):
    r = size * rx_pct; k = size / 100 * scale
    bg = f'<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG_TOP}"/><stop offset="1" stop-color="{BG_BOT}"/></linearGradient></defs>'
    fillbg = 'url(#b)' if grad else flat
    rect = f'<rect width="{size}" height="{size}" rx="{r:g}" fill="{fillbg}"/>'
    tr = f'translate({size/2 - 50*k:.2f} {size/2 - 50*k:.2f}) scale({k:.4f})'
    return svg(size, size, (bg if grad else '') + rect + f'<g transform="{tr}">{mark_paths(fills)}</g>')

FILES = {
 'logo-mark.svg':        svg(100, 100, mark_paths(CYAN)),
 'logo-mark-light.svg':  svg(100, 100, mark_paths(DARK)),
 'logo-mark-white.svg':  svg(100, 100, mark_paths(('#FFFFFF',) * 3, var=False)),
 'logo-mark-dark.svg':   svg(100, 100, mark_paths((DARK_T,) * 3, var=False)),
 'logo.svg':             lockup(CYAN, WHITE_T),
 'logo-light.svg':       lockup(DARK, DARK_T),
 'logo-white.svg':       lockup(('#FFFFFF',) * 3, '#FFFFFF', var=False),
 'logo-dark.svg':        lockup((DARK_T,) * 3, DARK_T, var=False),
 # favicon: küçük boyutta okunsun diye sembol karede daha büyük, düz koyu zemin
 'favicon.svg':          tile(100, 0.22, 0.84, CYAN, grad=False, flat=BG_TOP),
 'app-icon.svg':         tile(512, 0.2237, 0.60, CYAN),
 # maskable: tam kenara kadar; sembol merkezdeki güvenli dairenin (yarıçap %40) içinde
 'maskable-icon.svg':    tile(512, 0, 0.56, CYAN),
}
# splash: dikey (sembol üstte, yazı altta), antrasit zemin
def splash_svg(W=390, H=844):
    k = 1.0; mark = 96
    cap = 17.0; wd, x0, ww = wordmark(cap_h=cap, tracking=0.2)
    cx = W / 2; top = H / 2 - 72
    body = f'<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG_TOP}"/><stop offset="1" stop-color="#10141A"/></linearGradient></defs><rect width="{W}" height="{H}" fill="url(#b)"/>'
    body += f'<g transform="translate({cx - mark/2:.1f} {top:.1f}) scale({mark/100})">{mark_paths(CYAN)}</g>'
    body += f'<path fill="var(--eyrivo-text,#fff)" transform="translate({cx - ww/2 - x0:.1f} {top + mark + 22:.1f})" d="{wd}"/>'
    return svg(W, H, body)
# iOS açılış görselleri uygulama içi açılış ekranıyla aynı olmalı (gökyüzü mavisi + beyaz sembol/yazı): ilk kareden uygulamaya renk sıçraması olmaz
def splash_sky_svg(W, H):
    mark = 92; cap = 15.3; wd, x0, ww = wordmark(cap_h=cap, tracking=0.2); top = H / 2 - (mark + 14 + cap) / 2
    body = '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1668c9"/><stop offset="1" stop-color="#6bb8ee"/></linearGradient></defs>' + f'<rect width="{W}" height="{H}" fill="url(#b)"/>'
    body += f'<g transform="translate({W/2 - mark/2:.1f} {top:.1f}) scale({mark/100})">{mark_paths(("#FFFFFF",) * 3, var=False)}</g>'
    body += f'<path fill="#fff" transform="translate({W/2 - ww/2 - x0:.1f} {top + mark + 14:.1f})" d="{wd}"/>'
    return svg(W, H, body)
FILES['splash-logo.svg'] = splash_svg()
for n, s in FILES.items(): open(os.path.join(BRAND, n), 'w').write(s)

# ---------- PNG ----------
def render(pw_page, svg_text, w, h, path, transparent=True, scale=1):
    pw_page.set_viewport_size({'width': w, 'height': h})
    pw_page.set_content(f'<html><body style="margin:0;background:transparent">{svg_text.replace("<svg ", f"<svg width=\"{w}\" height=\"{h}\" ", 1)}</body></html>')
    png = pw_page.screenshot(omit_background=transparent, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
    Image.open(io.BytesIO(png)).save(path, optimize=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=glob.glob('/opt/pw-browsers/chromium*/chrome-linux*/chrome')[0]); pg = b.new_page()
    any_svg, mask_svg, fav_svg = FILES['app-icon.svg'], FILES['maskable-icon.svg'], FILES['favicon.svg']
    opaque = tile(512, 0, 0.60, CYAN)                      # apple-touch: opak kare, iOS kendi köşesini keser
    for s in (192, 512, 1024): render(pg, any_svg, s, s, os.path.join(ICONS, f'icon-{s}.png'))
    for s in (192, 512): render(pg, mask_svg, s, s, os.path.join(ICONS, f'icon-maskable-{s}.png'), transparent=False)
    render(pg, opaque, 180, 180, os.path.join(ICONS, 'apple-touch-icon.png'), transparent=False)
    for s in (32, 64): render(pg, fav_svg, s, s, os.path.join(ICONS, f'favicon-{s}.png'))
    # bildirim rozeti: Android yalnızca alfa kanalını kullanır → şeffaf zeminde tek renk (beyaz) sembol
    render(pg, svg(100, 100, f'<g transform="translate(8 8) scale(.84)">{mark_paths(("#FFFFFF",) * 3, var=False)}</g>'), 96, 96, os.path.join(ICONS, 'badge-96.png'))
    # iOS açılış görselleri
    DEV = [(440,956,3),(402,874,3),(430,932,3),(393,852,3),(428,926,3),(390,844,3),(375,812,3),(414,896,3),(414,896,2),(375,667,2),(414,736,3)]
    index = []
    for w, h, r in DEV:
        W, H = w * r, h * r
        sp = splash_sky_svg(w, h)
        pg.set_viewport_size({'width': w, 'height': h})
        pg.set_content(f'<html><body style="margin:0">{sp.replace("<svg ", f"<svg width=\"{w}\" height=\"{h}\" ", 1)}</body></html>')
        pg2 = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=r); pg2.set_content(f'<html><body style="margin:0">{sp.replace("<svg ", f"<svg width=\"{w}\" height=\"{h}\" ", 1)}</body></html>')
        name = f'splash-{W}x{H}.png'
        Image.open(io.BytesIO(pg2.screenshot())).convert('RGB').save(os.path.join(SPLASH, name), optimize=True); pg2.close()
        index.append((w, h, r, name))
    b.close()
with open(os.path.join(SPLASH, 'index.txt'), 'w') as f:
    for w, h, r, n in index: f.write(f'{w} {h} {r} {n}\n')
print('tamam:', len(FILES), 'SVG,', 'PNG ikonlar + ', len(index), 'açılış görseli')
