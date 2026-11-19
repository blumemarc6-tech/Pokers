# TikTok-Videos für den POKETA Store (9:16, 1080x1920, ohne Ton)
import os, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
C = BASE + '/cards/'
OUT = BASE + '/videos/'; os.makedirs(OUT, exist_ok=True)
TMP = BASE + '/tmp/'; os.makedirs(TMP, exist_ok=True)
W, H = 1080, 1920
FB = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
FS = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
GOLD, RED, CYAN = (255, 201, 74), (255, 92, 122), (61, 217, 245)

def bg():
    im = Image.new('RGB', (W, H), (7, 11, 20)); d = ImageDraw.Draw(im)
    for r in range(900, 0, -12):   # violetter Schein
        a = int(70 * (1 - r / 900)); d.ellipse([W/2 - r, 760 - r, W/2 + r, 760 + r], fill=(7 + a, 11 + a // 2, 20 + int(a * 1.6)))
    return im.filter(ImageFilter.GaussianBlur(40))

def card(name, w):
    im = Image.open(C + name).convert('RGBA'); h = int(im.height * w / im.width)
    return im.resize((w, h), Image.LANCZOS)

def paste_card(can, name, w, cx, cy, rot=0, glow=(139, 111, 255)):
    c = card(name, w)
    if rot: c = c.rotate(rot, expand=True, resample=Image.BICUBIC)
    g = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
    gd.rounded_rectangle([cx - c.width/2 - 10, cy - c.height/2 + 20, cx + c.width/2 + 10, cy + c.height/2 + 40], radius=40, fill=glow + (120,))
    can.alpha_composite(g.filter(ImageFilter.GaussianBlur(45)))
    can.alpha_composite(c, (int(cx - c.width / 2), int(cy - c.height / 2)))

def lines(d, text, size, font, maxw=W - 140):
    f = ImageFont.truetype(font, size); out = []
    for para in text.split('\n'):
        cur = ''
        for w in para.split(' '):
            t = (cur + ' ' + w).strip()
            if d.textlength(t, font=f) <= maxw: cur = t
            else: out.append(cur); cur = w
        out.append(cur)
    return f, out

def text(d, s, y, size=76, color='white', font=FB, stroke=7):
    f, ls = lines(d, s, size, font); lh = int(size * 1.16)
    for i, l in enumerate(ls):
        d.text(((W - d.textlength(l, font=f)) / 2, y + i * lh), l, font=f, fill=color, stroke_width=stroke, stroke_fill='black')
    return y + len(ls) * lh

def scene(path, fn):
    can = bg().convert('RGBA'); fn(can, ImageDraw.Draw(can)); can.convert('RGB').save(path, quality=94)

def build(name, scenes):
    parts = []
    for i, (dur, fn) in enumerate(scenes):
        img = f'{TMP}{name}_{i}.jpg'; scene(img, fn)
        clip = f'{TMP}{name}_{i}.mp4'; frames = int(dur * 30)
        # leichter Zoom (Ken Burns) für Bewegung
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', img, '-t', str(dur),
            '-vf', f"scale=2160:3840,zoompan=z='1+0.035*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps=30,format=yuv420p",
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', clip], check=True)
        parts.append(clip)
    lst = f'{TMP}{name}.txt'; open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    out = f'{OUT}{name}.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out], check=True)
    return out

def outro(can, d):
    text(d, 'POKETA Store', 760, 110, color='white')
    text(d, 'Schutz & Display für deine Karten', 920, 52, color=(200, 210, 235), font=FS, stroke=4)
    f = ImageFont.truetype(FB, 64); t = 'Link im Profil'; tw = d.textlength(t, font=f)
    d.rounded_rectangle([(W - tw) / 2 - 50, 1080, (W + tw) / 2 + 50, 1200], radius=30, fill=GOLD)
    d.text(((W - tw) / 2, 1100), t, font=f, fill=(40, 22, 0))

# ── Video 1: Wert-Schock → Schutz ───────────────────────────────
v1 = [
 (2.4, lambda c, d: (paste_card(c, 'base_base1_4.png', 640, W/2, 1130), text(d, 'Diese Karte ist bis zu', 210, 70), text(d, '3.489 €', 300, 150, GOLD), text(d, 'wert', 470, 70))),
 (2.2, lambda c, d: (paste_card(c, 'base_base1_4.png', 600, W/2, 1150, rot=-8, glow=RED), text(d, '…und du lagerst sie', 230, 74), text(d, 'OHNE Hülle?!', 330, 110, RED))),
 (3.0, lambda c, d: (paste_card(c, 'base_base1_4.png', 420, W/2, 1430, glow=CYAN), text(d, 'So schützt du sie richtig:', 200, 72),
     text(d, '1. Penny Sleeve', 430, 64, CYAN), text(d, '2. Magnet-Case (35pt)', 530, 64, CYAN), text(d, '3. Ordner ohne Ringe', 630, 64, CYAN))),
 (2.6, outro),
]
# ── Video 2: Display ───────────────────────────────────────────
def fan(c, d):
    paste_card(c, 'base_base1_2.png', 470, W/2 - 250, 1180, rot=12)
    paste_card(c, 'base_base1_10.png', 470, W/2 + 250, 1180, rot=-12)
    paste_card(c, 'base_base1_4.png', 520, W/2, 1130)
v2 = [
 (2.6, lambda c, d: (fan(c, d), text(d, 'Deine besten Karten gehören nicht in den Schuhkarton', 200, 78))),
 (2.6, lambda c, d: (paste_card(c, 'me_me02_125.png', 600, W/2, 1170, glow=GOLD), text(d, 'Zeig sie richtig:', 230, 78), text(d, 'Magnet-Case + Display-Ständer', 340, 66, GOLD))),
 (2.4, lambda c, d: (paste_card(c, 'sv_sv03.5_199.png', 600, W/2, 1170), text(d, 'Sicher. Staubfrei.', 230, 82), text(d, 'Und sieht einfach besser aus.', 340, 62, CYAN))),
 (2.6, outro),
]
# ── Video 3: Kratzer-Warnung ───────────────────────────────────
v3 = [
 (2.4, lambda c, d: (paste_card(c, 'swsh_swsh7_215.png', 640, W/2, 1130), text(d, 'Nachtara VMAX:', 210, 74), text(d, '1.902 €', 310, 150, GOLD))),
 (2.4, lambda c, d: (paste_card(c, 'swsh_swsh7_215.png', 600, W/2, 1150, rot=6, glow=RED), text(d, 'Ein Kratzer kann den Wert massiv senken', 210, 74, RED))),
 (2.6, lambda c, d: (paste_card(c, 'swsh_swsh7_215.png', 600, W/2, 1170, glow=CYAN), text(d, 'Darum: wertvolle Karten', 220, 74), text(d, 'IMMER in Hülle + Case', 320, 80, CYAN))),
 (2.6, outro),
]
for n, v in [('store-video-1-schutz', v1), ('store-video-2-display', v2), ('store-video-3-kratzer', v3)]:
    print(build(n, v))
