#!/usr/bin/env python3
"""바다토익 런처 아이콘 생성기.

딥 블루(#061124~#0B3A63) 배경 + 청록 파도 심볼.
- mipmap-*dpi/ic_launcher.png, ic_launcher_round.png  (레거시 아이콘)
- mipmap-*dpi/ic_launcher_foreground.png              (적응형 아이콘 전경)
- adaptive-icon XML 은 mipmap-anydpi-v26/ 에 고정 파일로 둔다.

실행:  python3 android/tools/make_icons.py
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.abspath(os.path.join(HERE, "..", "app", "src", "main", "res"))

DEEP = (6, 17, 36)          # #061124
DEEP2 = (11, 35, 64)        # #0B2340
BLUE = (42, 127, 212)       # #2A7FD4
SKY = (56, 182, 255)        # #38B6FF
TEAL = (57, 230, 208)       # #39E6D0
TEAL_SOFT = (126, 240, 226) # #7EF0E2

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def gradient(size: int) -> Image.Image:
    """대각선 딥 블루 그라디언트."""
    img = Image.new("RGB", (size, size), DEEP)
    px = img.load()
    for y in range(size):
        for x in range(0, size, 4):
            t = (x / size * 0.55 + y / size * 0.45)
            r = int(DEEP[0] + (DEEP2[0] - DEEP[0]) * t)
            g = int(DEEP[1] + (DEEP2[1] - DEEP[1]) * t)
            b = int(DEEP[2] + (DEEP2[2] - DEEP[2]) * t)
            for dx in range(4):
                if x + dx < size:
                    px[x + dx, y] = (r, g, b)
    return img


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def wave_points(size: int, base_y: float, amp: float, phase: float, steps: int = 240):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = t * size
        y = base_y * size + math.sin(t * math.pi * 2.0 + phase) * amp * size
        pts.append((x, y))
    pts.append((size, size))
    pts.append((0, size))
    return pts


def crest_points(size: int, base_y: float, amp: float, phase: float, steps: int = 240):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = t * size
        y = base_y * size + math.sin(t * math.pi * 2.0 + phase) * amp * size
        pts.append((x, y))
    return pts


def draw_waves(size: int, top: float, height: float) -> Image.Image:
    """top(0~1)·height(0~1) 영역에 파도 3겹을 그린 투명 레이어."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    bands = [
        (top + height * 0.02, height * 0.16, BLUE + (255,), 0.0),
        (top + height * 0.20, height * 0.15, SKY + (240,), 2.1),
        (top + height * 0.40, height * 0.14, TEAL + (255,), 4.2),
        (top + height * 0.58, height * 0.13, TEAL_SOFT + (235,), 1.1),
    ]
    for base_y, amp, color, phase in bands:
        draw.polygon(wave_points(size, base_y, amp, phase), fill=color)

    # 파도 마루 하이라이트
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.line(
        crest_points(size, top + height * 0.40, height * 0.14, 4.2),
        fill=(234, 246, 255, 210),
        width=max(2, int(size * 0.012)),
        joint="curve",
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(size * 0.002))
    layer = Image.alpha_composite(layer, highlight)
    return layer


def make_legacy(size: int, round_icon: bool) -> Image.Image:
    s = size * 4
    bg = gradient(s).convert("RGBA")
    mask = circle_mask(s) if round_icon else rounded_mask(s, s * 0.215)

    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    waves = draw_waves(s, top=0.50, height=0.46)
    waves_alpha = ImageChops.multiply(waves.getchannel("A"), mask)
    waves.putalpha(waves_alpha)
    img = Image.alpha_composite(img, waves)

    return img.resize((size, size), Image.LANCZOS)


def make_foreground(size: int) -> Image.Image:
    """적응형 아이콘 전경(108dp 캔버스) — 안전 영역 안쪽에 파도만."""
    s = size * 4
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inner = int(s * 0.78)
    off = (s - inner) // 2
    waves = draw_waves(inner, top=0.42, height=0.52)
    layer.alpha_composite(waves, (off, off))
    return layer.resize((size, size), Image.LANCZOS)


def main() -> None:
    for dens, scale in DENSITIES.items():
        out = os.path.join(RES, f"mipmap-{dens}")
        os.makedirs(out, exist_ok=True)

        legacy = int(48 * scale)
        make_legacy(legacy, round_icon=False).save(os.path.join(out, "ic_launcher.png"))
        make_legacy(legacy, round_icon=True).save(
            os.path.join(out, "ic_launcher_round.png")
        )

        fg = int(108 * scale)
        make_foreground(fg).save(os.path.join(out, "ic_launcher_foreground.png"))
        print(f"{dens}: launcher {legacy}px, foreground {fg}px")


if __name__ == "__main__":
    main()
