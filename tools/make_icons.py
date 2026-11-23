"""アプリアイコン(PNG)を生成する。外部ライブラリ不要。
使い方: python tools/make_icons.py
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

BG = (79, 124, 255)       # 青
WHITE = (255, 255, 255)
HEAD = (229, 72, 77)      # 赤（カレンダー上部）
GRID = (79, 124, 255)
CHECK = (34, 197, 94)     # 緑


def render(size):
    s = size / 512.0
    px = [[BG] * size for _ in range(size)]

    def rect(x0, y0, x1, y1, color, r=0):
        x0, y0, x1, y1, r = [int(v * s) for v in (x0, y0, x1, y1, r)]
        for y in range(max(0, y0), min(size, y1)):
            for x in range(max(0, x0), min(size, x1)):
                if r:
                    cx = x0 + r if x < x0 + r else (x1 - r - 1 if x >= x1 - r else x)
                    cy = y0 + r if y < y0 + r else (y1 - r - 1 if y >= y1 - r else y)
                    if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                        continue
                px[y][x] = color

    # カレンダー本体
    rect(96, 120, 416, 420, WHITE, 36)
    rect(96, 120, 416, 196, HEAD, 36)
    rect(96, 170, 416, 196, HEAD)
    # リング
    rect(170, 92, 196, 150, WHITE, 12)
    rect(316, 92, 342, 150, WHITE, 12)
    # マス目
    for row in range(3):
        for col in range(4):
            x = 132 + col * 66
            y = 222 + row * 62
            color = CHECK if (row, col) in {(0, 1), (1, 2), (2, 0), (1, 0)} else (225, 231, 255)
            rect(x, y, x + 46, y + 42, color, 8)
    return px


def write_png(path, px):
    h = len(px)
    w = len(px[0])
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
        write_png(os.path.join(OUT, name), render(size))
        print("wrote", name)
