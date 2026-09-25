import math, struct, sys, zlib
def load(path):
    data = open(path, 'rb').read()
    pos, idat = 8, b''
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR': w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
        elif kind == b'IDAT': idat += body
        pos += 12 + n
    bpp = {2: 3, 6: 4}[ctype]
    raw, stride, rows, prev = zlib.decompress(idat), w * bpp, [], bytearray(w * bpp)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows
def lum(img, x, y):
    w, h, bpp, rows = img
    x, y = min(max(int(x), 0), w - 1), min(max(int(y), 0), h - 1)
    r, g, b = rows[y][x * bpp:x * bpp + 3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def patch(img, x, y, r):
    return [lum(img, x + dx, y + dy) for dx in range(-r, r + 1, 2) for dy in range(-r, r + 1, 2)]
cmd, path, *a = sys.argv[1:]
img = load(path)
s = float(a[0]) if a else 1
if cmd == 'limb':  # scale cx cy radius limb-ccw-from-up → lit and dark side brightness, centre
    cx, cy, r, th = [float(v) for v in a[1:5]]
    cx, cy, r = cx * s, cy * s, r * s
    dx, dy = -math.sin(math.radians(th)), -math.cos(math.radians(th))
    k = max(2, int(r * 0.04))
    lit = max(patch(img, cx + dx * r * 0.95, cy + dy * r * 0.95, k))
    dark = max(patch(img, cx - dx * r * 0.95, cy - dy * r * 0.95, k))
    mid = sum(patch(img, cx, cy, k)) / len(patch(img, cx, cy, k))
    print(f'{lit:.0f} {dark:.0f} {mid:.0f}')
elif cmd == 'spread':  # scale x0 y0 x1 y1 → standard deviation of brightness on a grid
    x0, y0, x1, y1 = [float(v) * s for v in a[1:5]]
    v = [lum(img, x0 + (x1 - x0) * i / 40, y0 + (y1 - y0) * j / 40) for i in range(41) for j in range(41)]
    m = sum(v) / len(v)
    print(f'{math.sqrt(sum((q - m) ** 2 for q in v) / len(v)):.1f}')
elif cmd == 'seam':  # scale axis(x|y) edge lo hi → step across the edge line over the median step of nearby lines
    axis, e, lo, hi = a[1], float(a[2]) * s, int(float(a[3]) * s), int(float(a[4]) * s)
    at = (lambda u, v: lum(img, u, v)) if axis == 'x' else (lambda u, v: lum(img, v, u))
    step = lambda u: sum(abs(at(u, v) - at(u - 1, v)) for v in range(lo, hi)) / (hi - lo)
    c = round(e)
    edge = max(step(u) for u in range(c - 1, c + 2))
    near = sorted(step(c + d) for d in list(range(-24, -3)) + list(range(4, 25)))
    ref = near[len(near) // 2]
    print(f'{edge / max(ref, 0.5):.2f} {edge:.1f} {ref:.1f}')
