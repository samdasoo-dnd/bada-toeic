#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
초경량 순수 파이썬 QR 코드 생성기 (외부 라이브러리·CDN 불필요)
==============================================================

바다토익의 '폰에서 풀기' QR을 오프라인에서 만들기 위한 최소 구현입니다.

- 모드   : 바이트(byte) 모드 — URL 문자열
- 오류정정: M 레벨 (약 15%)
- 버전   : 1~6 (최대 106바이트, LAN 주소에 충분)
- 마스크 : 8종 패턴을 모두 만들어 표준 페널티 점수가 가장 낮은 것을 선택
- 출력   : SVG 문자열 (quiet zone 4모듈 포함)

표준(ISO/IEC 18004) 규격대로 구현했으며, 빌드 검증 단계에서 segno 라이브러리
결과와 모듈 단위로 대조합니다.
"""

from __future__ import annotations

# 오류정정 M(15%) 기준 버전별 (전체 코드워드, 데이터 코드워드, ECC 코드워드, 블록 구성)
VERSIONS = {
    1: {"total": 26, "data": 16, "ecc": 10, "blocks": [(1, 16)]},
    2: {"total": 44, "data": 28, "ecc": 16, "blocks": [(1, 28)]},
    3: {"total": 70, "data": 44, "ecc": 26, "blocks": [(1, 44)]},
    4: {"total": 100, "data": 64, "ecc": 36, "blocks": [(2, 32)]},
    5: {"total": 134, "data": 86, "ecc": 48, "blocks": [(2, 43)]},
    6: {"total": 172, "data": 108, "ecc": 64, "blocks": [(4, 27)]},
}

ALIGN_CENTERS = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
}

G15 = 0x537
G15_MASK = 0x5412


# ---------------------------------------------------------------------------
# GF(256) / 리드-솔로몬
# ---------------------------------------------------------------------------
_EXP = [0] * 512
_LOG = [0] * 256


def _init_gf() -> None:
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]


_init_gf()


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(degree: int) -> list[int]:
    poly = [1]
    for i in range(degree):
        poly = _poly_mul(poly, [1, _EXP[i]])
    return poly


def _poly_mul(a: list[int], b: list[int]) -> list[int]:
    out = [0] * (len(a) + len(b) - 1)
    for i, av in enumerate(a):
        if av == 0:
            continue
        for j, bv in enumerate(b):
            out[i + j] ^= _gf_mul(av, bv)
    return out


def _rs_ecc(data: list[int], degree: int) -> list[int]:
    gen = _rs_generator(degree)
    res = data + [0] * degree
    for i in range(len(data)):
        coef = res[i]
        if coef == 0:
            continue
        for j, g in enumerate(gen):
            res[i + j] ^= _gf_mul(g, coef)
    return res[len(data):]


# ---------------------------------------------------------------------------
# 데이터 비트
# ---------------------------------------------------------------------------
def _pick_version(nbytes: int) -> int:
    for v in range(1, 7):
        info = VERSIONS[v]
        # 모드(4bit) + 문자수(8bit) + 데이터 + 종료(4bit) 여유
        capacity = info["data"] - 2
        if nbytes <= capacity:
            return v
    raise ValueError("QR 데이터가 너무 큽니다(최대 106바이트): %d바이트" % nbytes)


def _encode_data(text: bytes, version: int) -> list[int]:
    bits: list[str] = []

    def put(value: int, length: int) -> None:
        bits.append(format(value, "0%db" % length))

    put(0b0100, 4)                 # byte mode
    put(len(text), 8)              # v1~9: 8bit 문자 수
    for b in text:
        put(b, 8)

    data_codewords = VERSIONS[version]["data"]
    capacity_bits = data_codewords * 8
    stream = "".join(bits)
    stream += "0" * max(0, min(4, capacity_bits - len(stream)))  # 종료자
    if len(stream) % 8:
        stream += "0" * (8 - len(stream) % 8)
    stream = stream[:capacity_bits]
    codewords = [int(stream[i:i + 8], 2) for i in range(0, len(stream), 8)]
    pads = (0xEC, 0x11)
    i = 0
    while len(codewords) < data_codewords:
        codewords.append(pads[i % 2])
        i += 1
    return codewords


def _interleave(data_codewords: list[int], version: int) -> list[int]:
    info = VERSIONS[version]
    nblocks = sum(count for count, _size in info["blocks"])
    ecc_len = info["ecc"] // max(1, nblocks)
    blocks: list[tuple[list[int], list[int]]] = []
    pos = 0
    for count, size in info["blocks"]:
        for _ in range(count):
            chunk = data_codewords[pos:pos + size]
            pos += size
            blocks.append((chunk, _rs_ecc(chunk, ecc_len)))

    out: list[int] = []
    max_data = max(len(b[0]) for b in blocks)
    for i in range(max_data):
        for chunk, _ in blocks:
            if i < len(chunk):
                out.append(chunk[i])
    for i in range(ecc_len):
        for _, ecc in blocks:
            out.append(ecc[i])
    return out


# ---------------------------------------------------------------------------
# 매트릭스
# ---------------------------------------------------------------------------
def _new_matrix(size: int) -> list[list[int | None]]:
    return [[None] * size for _ in range(size)]


def _place_finder(m: list[list[int | None]], row: int, col: int) -> None:
    for r in range(-1, 8):
        for c in range(-1, 8):
            rr, cc = row + r, col + c
            if 0 <= rr < len(m) and 0 <= cc < len(m):
                inside = 0 <= r <= 6 and 0 <= c <= 6
                dark = (r in (0, 6) and 0 <= c <= 6) or (c in (0, 6) and 0 <= r <= 6) \
                    or (2 <= r <= 4 and 2 <= c <= 4)
                m[rr][cc] = 1 if (inside and dark) else 0


def _place_alignment(m: list[list[int | None]], version: int) -> None:
    size = len(m)
    centers = ALIGN_CENTERS[version]
    for r in centers:
        for c in centers:
            if (r == 6 and c == 6) or (r == 6 and c == size - 7) or (r == size - 7 and c == 6):
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    dark = max(abs(dr), abs(dc)) != 1
                    m[r + dr][c + dc] = 1 if dark else 0


def _place_timing(m: list[list[int | None]]) -> None:
    size = len(m)
    for i in range(8, size - 8):
        bit = 1 if i % 2 == 0 else 0
        if m[6][i] is None:
            m[6][i] = bit
        if m[i][6] is None:
            m[i][6] = bit


def _format_bits(mask: int) -> int:
    """오류정정 M(00) + 마스크 3비트 → 15비트 포맷 정보."""
    data = (0b00 << 3) | mask
    d = data << 10
    while d.bit_length() - G15.bit_length() >= 0:
        d ^= G15 << (d.bit_length() - G15.bit_length())
    return ((data << 10) | d) ^ G15_MASK


def _place_format(m: list[list[int | None]], mask: int) -> None:
    size = len(m)
    bits = _format_bits(mask)
    for i in range(15):
        mod = (bits >> i) & 1
        if i < 6:
            m[i][8] = mod
        elif i < 8:
            m[i + 1][8] = mod
        else:
            m[size - 15 + i][8] = mod

        if i < 8:
            m[8][size - i - 1] = mod
        elif i < 9:
            m[8][15 - i - 1 + 1] = mod
        else:
            m[8][15 - i - 1] = mod
    m[4 * _version_of(size) + 9][8] = 1  # dark module


def _version_of(size: int) -> int:
    return (size - 17) // 4


def _reserve_format(m: list[list[int | None]]) -> None:
    """포맷 정보 자리를 미리 비워 둔다(데이터 배치 방지)."""
    size = len(m)
    for i in range(9):
        if m[8][i] is None:
            m[8][i] = 0
        if m[i][8] is None:
            m[i][8] = 0
    for i in range(8):
        if m[8][size - 1 - i] is None:
            m[8][size - 1 - i] = 0
        if m[size - 1 - i][8] is None:
            m[size - 1 - i][8] = 0


def _place_data(m: list[list[int | None]], codewords: list[int]) -> None:
    size = len(m)
    bits: list[int] = []
    for cw in codewords:
        for i in range(7, -1, -1):
            bits.append((cw >> i) & 1)
    idx = 0
    col = size - 1
    upward = True
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for c in (col, col - 1):
                if m[row][c] is None:
                    bit = bits[idx] if idx < len(bits) else 0
                    m[row][c] = bit
                    idx += 1
        upward = not upward
        col -= 2


def _mask_fn(mask: int, r: int, c: int) -> bool:
    if mask == 0:
        return (r + c) % 2 == 0
    if mask == 1:
        return r % 2 == 0
    if mask == 2:
        return c % 3 == 0
    if mask == 3:
        return (r + c) % 3 == 0
    if mask == 4:
        return (r // 2 + c // 3) % 2 == 0
    if mask == 5:
        return (r * c) % 2 + (r * c) % 3 == 0
    if mask == 6:
        return ((r * c) % 2 + (r * c) % 3) % 2 == 0
    return ((r + c) % 2 + (r * c) % 3) % 2 == 0


def _apply_mask(base: list[list[int | None]], mask: int) -> list[list[int]]:
    size = len(base)
    out = [[0] * size for _ in range(size)]
    for r in range(size):
        for c in range(size):
            val = base[r][c]
            if val is None:
                val = 0
            reserved = _is_function_module(size, r, c)
            if not reserved and _mask_fn(mask, r, c):
                val ^= 1
            out[r][c] = val
    return out


def _is_function_module(size: int, r: int, c: int) -> bool:
    """포맷·타이밍·파인더·정렬 패턴 등 마스크 대상이 아닌 모듈."""
    version = _version_of(size)
    # 파인더 + 분리자 영역
    if (r < 9 and c < 9) or (r < 9 and c >= size - 8) or (r >= size - 8 and c < 9):
        return True
    if r == 6 or c == 6:
        return True
    for cr in ALIGN_CENTERS[version]:
        for cc in ALIGN_CENTERS[version]:
            if (cr == 6 and cc == 6) or (cr == 6 and cc == size - 7) or (cr == size - 7 and cc == 6):
                continue
            if abs(r - cr) <= 2 and abs(c - cc) <= 2:
                return True
    return False


# ---------------------------------------------------------------------------
# 페널티 점수
# ---------------------------------------------------------------------------
def _penalty(m: list[list[int]]) -> int:
    size = len(m)
    score = 0

    def run_score(line: list[int]) -> int:
        total = 0
        run = 1
        for i in range(1, len(line)):
            if line[i] == line[i - 1]:
                run += 1
            else:
                if run >= 5:
                    total += 3 + (run - 5)
                run = 1
        if run >= 5:
            total += 3 + (run - 5)
        return total

    for r in range(size):
        score += run_score(m[r])
    for c in range(size):
        score += run_score([m[r][c] for r in range(size)])

    for r in range(size - 1):
        for c in range(size - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3

    pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    pat2 = pat1[::-1]

    def find_pat(line: list[int]) -> int:
        cnt = 0
        n = len(pat1)
        for i in range(len(line) - n + 1):
            seg = line[i:i + n]
            if seg == pat1 or seg == pat2:
                cnt += 1
        return cnt

    for r in range(size):
        score += 40 * find_pat(m[r])
    for c in range(size):
        score += 40 * find_pat([m[r][c] for r in range(size)])

    dark = sum(sum(row) for row in m)
    ratio = dark * 100 // (size * size)
    score += 10 * (abs(ratio - 50) // 5)
    return score


# ---------------------------------------------------------------------------
# 공개 API
# ---------------------------------------------------------------------------
def build_matrix(text: str, mask: int | None = None) -> tuple[list[list[int]], int]:
    data = text.encode("utf-8")
    version = _pick_version(len(data))
    size = 17 + version * 4
    codewords = _interleave(_encode_data(data, version), version)

    base = _new_matrix(size)
    _place_finder(base, 0, 0)
    _place_finder(base, 0, size - 7)
    _place_finder(base, size - 7, 0)
    _place_alignment(base, version)
    _place_timing(base)
    _reserve_format(base)
    _place_data(base, codewords)

    if mask is not None:
        chosen = int(mask) % 8
        matrix = _apply_mask(base, chosen)
        _place_format(matrix, chosen)
        return matrix, chosen

    best = None
    for m in range(8):
        matrix = _apply_mask(base, m)
        _place_format(matrix, m)
        score = _penalty(matrix)
        if best is None or score < best[0]:
            best = (score, m, matrix)
    assert best is not None
    return best[2], best[1]


def to_svg(text: str, scale: int = 6, border: int = 4, dark: str = "#0b2540",
           light: str = "#ffffff", radius: float = 0.0) -> str:
    matrix, mask = build_matrix(text)
    size = len(matrix)
    dim = (size + border * 2) * scale
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
             'viewBox="0 0 %d %d" shape-rendering="crispEdges" role="img" '
             'aria-label="바다토익 폰 접속 QR 코드">' % (dim, dim, dim, dim)]
    parts.append('<rect width="%d" height="%d" fill="%s"/>' % (dim, dim, light))
    for r in range(size):
        for c in range(size):
            if not matrix[r][c]:
                continue
            x = (c + border) * scale
            y = (r + border) * scale
            if radius:
                parts.append('<rect x="%d" y="%d" width="%d" height="%d" rx="%.1f" fill="%s"/>'
                             % (x, y, scale, scale, radius, dark))
            else:
                parts.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>'
                             % (x, y, scale, scale, dark))
    parts.append("</svg>")
    return "".join(parts)


if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.0.10:8768"
    mtx, msk = build_matrix(url)
    print("QR", len(mtx), "x", len(mtx), "mask", msk, "for", url)
