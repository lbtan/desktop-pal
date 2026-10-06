# Rebuilds public/*.png from the pictures in art/. Run from the project root:
#   python3 art/faces.py <folder for previews>
import sys
from PIL import Image, ImageDraw, ImageFilter

def face(src, cx, cy, rx, ry):
    """Feathered oval cut-out of the face from the photo."""
    im = Image.open(src).convert("RGBA")
    box = (int(cx - rx), int(cy - ry), int(cx + rx), int(cy + ry))
    crop = im.crop(box)
    w, h = crop.size
    mask = Image.new("L", (w, h), 0)
    pad = int(w * 0.06)
    ImageDraw.Draw(mask).ellipse((pad, pad, w - pad, h - pad), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.03))
    from PIL import ImageChops
    crop.putalpha(ImageChops.multiply(mask, crop.getchannel("A")))
    return crop

def blank(b, box):
    """White out the pal's own drawn eyes and brows: ink blobs wholly inside box."""
    import numpy as np
    from collections import deque
    A = np.array(b); x0, y0, x1, y1 = box
    dark = (A[..., :3].max(2) < 110) & (A[..., 3] > 128)
    seen = np.zeros(dark.shape, bool)
    for sy in range(y0, y1):
        for sx in range(x0, x1):
            if not dark[sy, sx] or seen[sy, sx]: continue
            q = deque([(sy, sx)]); seen[sy, sx] = True; pix = []; inside = True
            while q:
                y, x = q.popleft(); pix.append((y, x))
                if not (x0 <= x < x1 and y0 <= y < y1): inside = False
                if len(pix) > 4000: inside = False; break
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < dark.shape[0] and 0 <= nx < dark.shape[1] and dark[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
            if inside:
                for y, x in pix:
                    A[y-3:y+4, x-3:x+4] = (255, 255, 255, 255)
    return Image.fromarray(A, "RGBA")

def paste(base, f, cx, cy, width, angle, out, box):
    b = blank(Image.open(base).convert("RGBA"), box)
    h = round(width * f.height / f.width)
    g = f.resize((width, h), Image.LANCZOS)
    g = g.rotate(angle, expand=True, resample=Image.BICUBIC)
    r = b.copy()
    r.alpha_composite(g, (round(cx - g.width / 2), round(cy - g.height / 2)))
    r.save(out)
    bg = Image.new("RGBA", r.size, (90, 140, 200, 255)); bg.alpha_composite(r)
    bg.convert("RGB").save(sys.argv[1] + "/" + out.split("/")[-1].replace(".png", "-preview.png"))

normal = face("art/normal.png", 1270, 1400, 640, 900)
sleep = face("art/sleep.png", 1130, 1440, 720, 1040)

SIT, WALK = (125, 48, 206, 120), (285, 125, 425, 200)
paste("art/sit-base.png", normal, 182, 116, 120, 14, "public/sit.png", SIT)
paste("art/sit-base.png", sleep, 182, 116, 120, 14, "public/sit-sleep.png", SIT)
paste("art/walk-base.png", normal, 392, 202, 208, 8, "public/walk.png", WALK)
