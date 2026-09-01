#!/usr/bin/env python3
"""
The five tab-bar icons, sized for a UITabBarItem.

The founder's own artwork lives at 160x160 in `tools/nav-icons/` (built by
`tools/nav-icons/build.js`, which is the ONLY place they should ever be drawn).
This script does one thing: crop the shared padding off those masters and write
them out at the point size the tab bar should render.

WHY IT EXISTS. UIKit does not resize a tab-bar image — it draws it at the
image's own point size. The first cut shipped a 26pt canvas whose glyph filled
only 72% of it, so the mark on screen was 19pt: noticeably smaller than the SF
Symbols in any Apple tab bar, which is what the founder saw. Cropping the
padding and going to a 30pt canvas puts the visible mark at 27pt — 40% bigger —
without redrawing anything.

CROP THE FAMILY WITH ONE BOX, NEVER EACH ICON TO ITS OWN. The bell is narrower
than the four rings on purpose; normalising each glyph to the same width would
inflate it against its neighbours. One shared box keeps the relative sizes the
generator already settled.

    python3 tools/build-nav-icons.py
"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'tools', 'nav-icons')
OUT = os.path.join(ROOT, 'atwe-mobile', 'assets', 'nav')

# mobile name -> the web's name for the same world
PAIRS = [('home', 'home'), ('beam', 'chat'), ('engine', 'search'),
         ('notifs', 'notifs'), ('profile', 'profile')]

PT = 30          # the canvas the tab bar gets
INK = 0.90       # how much of it the mark fills -> 27pt on screen
SCALES = [(1, ''), (2, '@2x'), (3, '@3x')]


def main():
    # one box for the whole family, square and centred on the canvas centre
    lo, hi = 10**9, -10**9
    size = None
    for _, web in PAIRS:
        for st in ('off', 'on'):
            im = Image.open(f'{SRC}/{web}-{st}.png').convert('RGBA')
            size = im.size[0]
            x0, y0, x1, y1 = im.split()[3].getbbox()
            c = size / 2
            lo = min(lo, x0 - c, y0 - c)
            hi = max(hi, x1 - c, y1 - c)
    r = max(abs(lo), abs(hi))
    box = (size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r)
    print(f'family ink box {box} ({2 * r / size:.0%} of the master)')

    for mob, web in PAIRS:
        for st in ('off', 'on'):
            im = Image.open(f'{SRC}/{web}-{st}.png').convert('RGBA').crop(
                tuple(int(round(v)) for v in box))
            for s, suf in SCALES:
                px = PT * s
                ink = int(round(px * INK))
                g = im.resize((ink, ink), Image.LANCZOS)
                canvas = Image.new('RGBA', (px, px), (0, 0, 0, 0))
                canvas.paste(g, ((px - ink) // 2, (px - ink) // 2), g)
                canvas.save(f'{OUT}/{mob}-{st}{suf}.png')
        print(f'  {mob}: {PT}pt canvas, {PT * INK:.0f}pt mark')


if __name__ == '__main__':
    main()
