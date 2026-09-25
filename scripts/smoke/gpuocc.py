# Marks drawn by the picture pass against the exact CPU occluder: shots with marks on and off, and the probe the controller wrote.
# Usage: python3 gpuocc.py stars|paths on.bmp off.bmp probe.json dpr 'ox oy fx fy fw fh' → key=value stats (canvas page offset, frame in canvas css px)
#        python3 gpuocc.py same a.bmp b.bmp → share of pixels that differ visibly
# BMPs come from `sips -s format bmp`: uncompressed, so no decoder is needed.
import json, struct, sys


def load(path):
    d = open(path, 'rb').read()
    off, w, h, bpp = struct.unpack_from('<I', d, 10)[0], *struct.unpack_from('<iiHH', d, 18)[:2], struct.unpack_from('<H', d, 28)[0]
    bottom_up, h = h > 0, abs(h)
    step = bpp // 8
    stride = (w * step + 3) & ~3
    rows = [d[off + (h - 1 - y if bottom_up else y) * stride: off + (h - 1 - y if bottom_up else y) * stride + w * step] for y in range(h)]
    return w, h, step, rows


def lum(img, x, y):
    w, h, step, rows = img
    if x < 0 or y < 0 or x >= w or y >= h: return 0.0
    b, g, r = rows[y][x * step:x * step + 3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rgb(img, x, y):
    w, h, step, rows = img
    if x < 0 or y < 0 or x >= w or y >= h: return (0, 0, 0)
    return rows[y][x * step:x * step + 3]


# Largest channel change: an orange path on blue sky barely changes luminance.
def diff(a, b, x, y, k):
    x, y = int(round(x)), int(round(y))
    return max(max(abs(p - q) for p, q in zip(rgb(a, x + i, y + j), rgb(b, x + i, y + j))) for i in range(-k, k + 1) for j in range(-k, k + 1))


cmd = sys.argv[1]
on, off = load(sys.argv[2]), load(sys.argv[3])
if cmd == 'same':
    w, h = min(on[0], off[0]), min(on[1], off[1])
    n = bad = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            n += 1
            bad += abs(lum(on, x, y) - lum(off, x, y)) > 32
    print(f'differ={100 * bad / n:.3f}')
    sys.exit()

probe = json.load(open(sys.argv[4]))
dpr = float(sys.argv[5])
ox, oy, fx, fy, fw, fh = map(float, sys.argv[6].split())
inside = lambda x, y, m: fx + m <= x < fx + fw - m and fy + m <= y < fy + fh - m
LIT = 4
if cmd == 'stars':
    shown = [0, 0]  # bright stars in open sky: lit, total
    leak = [0, 0]  # stars behind a building: lit, total
    for kind, x, y, r, hid, _ in (probe[i:i + 6] for i in range(0, len(probe), 6)):
        if kind != 0 or not inside(x, y, 4): continue
        lit = diff(on, off, (ox + x) * dpr, (oy + y) * dpr, 1) > LIT
        if hid: leak[0] += lit; leak[1] += 1
        elif r >= 1.1: shown[0] += lit; shown[1] += 1
    print(f'shown={shown[0]} open={shown[1]} leaked={leak[0]} behind={leak[1]}')
else:
    hours = [(x, y) for kind, x, y, *_ in (probe[i:i + 6] for i in range(0, len(probe), 6)) if kind == 2]
    lit = {0: [0, 0], 1: [0, 0]}  # solid, ghost: lit samples, samples
    for kind, x0, y0, x1, y1, cls in (probe[i:i + 6] for i in range(0, len(probe), 6)):
        if kind != 1 or cls == 3: continue
        dx, dy = x1 - x0, y1 - y0
        n = int((dx * dx + dy * dy) ** 0.5 * 2)
        for s in range(1, n):
            x, y = x0 + dx * s / n, y0 + dy * s / n
            # Hour dots and labels come and go with the paths too.
            if not inside(x, y, 4) or any(abs(x - hx) < 16 and abs(y - hy) < 16 for hx, hy in hours): continue
            c = lit[0 if cls == 0 else 1]
            c[0] += diff(on, off, (ox + x) * dpr, (oy + y) * dpr, 0) > LIT
            c[1] += 1
    f = lambda c: c[0] / c[1] if c[1] else -1
    print(f'solid={f(lit[0]):.2f} solidN={lit[0][1]} ghost={f(lit[1]):.2f} ghostN={lit[1][1]}')
