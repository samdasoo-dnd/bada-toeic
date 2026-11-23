/* ============================================================
   🌊 바다토익 — 초경량 QR 코드 생성기 (순수 JS, 외부 CDN 없음)
   - 바이트 모드 / 오류정정 M / 버전 1~6
   - 8가지 마스크 중 표준 페널티가 가장 낮은 것을 선택
   - SVG 문자열로 반환 → 공유 모달에서 바로 사용
   파이썬(qr.py) 구현과 모듈 단위로 동일하게 동작하도록 작성했으며
   빌드 검증에서 두 구현을 대조합니다.
   ============================================================ */
(function (global) {
  "use strict";

  var VERSIONS = {
    1: { total: 26, data: 16, ecc: 10, blocks: [[1, 16]] },
    2: { total: 44, data: 28, ecc: 16, blocks: [[1, 28]] },
    3: { total: 70, data: 44, ecc: 26, blocks: [[1, 44]] },
    4: { total: 100, data: 64, ecc: 36, blocks: [[2, 32]] },
    5: { total: 134, data: 86, ecc: 48, blocks: [[2, 43]] },
    6: { total: 172, data: 108, ecc: 64, blocks: [[4, 27]] }
  };
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
  var G15 = 0x537;
  var G15_MASK = 0x5412;

  var EXP = new Array(512);
  var LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) { x ^= 0x11d; }
    }
    for (var j = 255; j < 512; j++) { EXP[j] = EXP[j - 255]; }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) { return 0; }
    return EXP[LOG[a] + LOG[b]];
  }

  function polyMul(a, b) {
    var out = new Array(a.length + b.length - 1).fill(0);
    for (var i = 0; i < a.length; i++) {
      if (a[i] === 0) { continue; }
      for (var j = 0; j < b.length; j++) {
        out[i + j] ^= gfMul(a[i], b[j]);
      }
    }
    return out;
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) { poly = polyMul(poly, [1, EXP[i]]); }
    return poly;
  }

  function rsEcc(data, degree) {
    var gen = rsGenerator(degree);
    var res = data.concat(new Array(degree).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef === 0) { continue; }
      for (var j = 0; j < gen.length; j++) { res[i + j] ^= gfMul(gen[j], coef); }
    }
    return res.slice(data.length);
  }

  function utf8Bytes(text) {
    if (global.TextEncoder) { return Array.prototype.slice.call(new TextEncoder().encode(text)); }
    var out = [];
    var s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); }
    return out;
  }

  function pickVersion(n) {
    for (var v = 1; v <= 6; v++) {
      if (n <= VERSIONS[v].data - 2) { return v; }
    }
    throw new Error("QR 데이터가 너무 큽니다: " + n + "바이트");
  }

  function encodeData(bytes, version) {
    var bits = [];
    function put(value, length) {
      var s = value.toString(2);
      while (s.length < length) { s = "0" + s; }
      bits.push(s);
    }
    put(0x4, 4);
    put(bytes.length, 8);
    for (var i = 0; i < bytes.length; i++) { put(bytes[i], 8); }
    var capacity = VERSIONS[version].data * 8;
    var joined = bits.join("");
    var term = Math.min(4, capacity - joined.length);
    joined += new Array(term + 1).join("0");
    if (joined.length % 8 !== 0) { joined += new Array(8 - (joined.length % 8) + 1).join("0"); }
    var words = [];
    for (var k = 0; k < joined.length; k += 8) { words.push(parseInt(joined.slice(k, k + 8), 2)); }
    var pads = [0xec, 0x11];
    var p = 0;
    while (words.length < VERSIONS[version].data) { words.push(pads[p % 2]); p++; }
    return words;
  }

  function interleave(words, version) {
    var info = VERSIONS[version];
    var nblocks = 0;
    info.blocks.forEach(function (b) { nblocks += b[0]; });
    var eccLen = info.ecc / nblocks;
    var blocks = [];
    var pos = 0;
    info.blocks.forEach(function (spec) {
      for (var k = 0; k < spec[0]; k++) {
        var size = spec[1];
        var chunk = words.slice(pos, pos + size);
        pos += size;
        blocks.push({ data: chunk, ecc: rsEcc(chunk, eccLen) });
      }
    });
    var out = [];
    var maxData = 0;
    blocks.forEach(function (bl) { maxData = Math.max(maxData, bl.data.length); });
    for (var i = 0; i < maxData; i++) {
      blocks.forEach(function (bl) { if (i < bl.data.length) { out.push(bl.data[i]); } });
    }
    for (var j = 0; j < eccLen; j++) {
      blocks.forEach(function (bl) { out.push(bl.ecc[j]); });
    }
    return out;
  }

  function newMatrix(size) {
    var m = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(null));
    }
    return m;
  }

  function placeFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) { continue; }
        var inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        var dark = ((r === 0 || r === 6) && c >= 0 && c <= 6) ||
                   ((c === 0 || c === 6) && r >= 0 && r <= 6) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = (inside && dark) ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, version) {
    var size = m.length;
    var centers = ALIGN[version];
    for (var i = 0; i < centers.length; i++) {
      for (var j = 0; j < centers.length; j++) {
        var r = centers[i], c = centers[j];
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) { continue; }
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            m[r + dr][c + dc] = dark ? 1 : 0;
          }
        }
      }
    }
  }

  function placeTiming(m) {
    var size = m.length;
    for (var i = 8; i < size - 8; i++) {
      var bit = i % 2 === 0 ? 1 : 0;
      if (m[6][i] === null) { m[6][i] = bit; }
      if (m[i][6] === null) { m[i][6] = bit; }
    }
  }

  function formatBits(mask) {
    var data = (0 << 3) | mask;
    var d = data << 10;
    while (d.toString(2).length - G15.toString(2).length >= 0) {
      d ^= G15 << (d.toString(2).length - G15.toString(2).length);
    }
    return ((data << 10) | d) ^ G15_MASK;
  }

  function versionOf(size) { return (size - 17) / 4; }

  function placeFormat(m, mask) {
    var size = m.length;
    var bits = formatBits(mask);
    for (var i = 0; i < 15; i++) {
      var mod = (bits >> i) & 1;
      if (i < 6) { m[i][8] = mod; }
      else if (i < 8) { m[i + 1][8] = mod; }
      else { m[size - 15 + i][8] = mod; }

      if (i < 8) { m[8][size - i - 1] = mod; }
      else if (i < 9) { m[8][15 - i - 1 + 1] = mod; }
      else { m[8][15 - i - 1] = mod; }
    }
    m[4 * versionOf(size) + 9][8] = 1;
  }

  function reserveFormat(m) {
    var size = m.length;
    for (var i = 0; i < 9; i++) {
      if (m[8][i] === null) { m[8][i] = 0; }
      if (m[i][8] === null) { m[i][8] = 0; }
    }
    for (var j = 0; j < 8; j++) {
      if (m[8][size - 1 - j] === null) { m[8][size - 1 - j] = 0; }
      if (m[size - 1 - j][8] === null) { m[size - 1 - j][8] = 0; }
    }
  }

  function placeData(m, words) {
    var size = m.length;
    var bits = [];
    for (var w = 0; w < words.length; w++) {
      for (var b = 7; b >= 0; b--) { bits.push((words[w] >> b) & 1); }
    }
    var idx = 0;
    var col = size - 1;
    var upward = true;
    while (col > 0) {
      if (col === 6) { col -= 1; }
      var rows = [];
      var k;
      if (upward) { for (k = size - 1; k >= 0; k--) { rows.push(k); } }
      else { for (k = 0; k < size; k++) { rows.push(k); } }
      for (var r = 0; r < rows.length; r++) {
        for (var cc = 0; cc < 2; cc++) {
          var c = cc === 0 ? col : col - 1;
          if (m[rows[r]][c] === null) {
            m[rows[r]][c] = idx < bits.length ? bits[idx] : 0;
            idx++;
          }
        }
      }
      upward = !upward;
      col -= 2;
    }
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function isFunctionModule(size, r, c) {
    var version = versionOf(size);
    if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) { return true; }
    if (r === 6 || c === 6) { return true; }
    var centers = ALIGN[version];
    for (var i = 0; i < centers.length; i++) {
      for (var j = 0; j < centers.length; j++) {
        var cr = centers[i], cc = centers[j];
        if ((cr === 6 && cc === 6) || (cr === 6 && cc === size - 7) || (cr === size - 7 && cc === 6)) { continue; }
        if (Math.abs(r - cr) <= 2 && Math.abs(c - cc) <= 2) { return true; }
      }
    }
    return false;
  }

  function applyMask(base, mask) {
    var size = base.length;
    var out = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) {
        var val = base[r][c] === null ? 0 : base[r][c];
        if (!isFunctionModule(size, r, c) && maskFn(mask, r, c)) { val ^= 1; }
        row.push(val);
      }
      out.push(row);
    }
    return out;
  }

  function penalty(m) {
    var size = m.length;
    var score = 0;

    function runScore(line) {
      var total = 0, run = 1;
      for (var i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) { run++; }
        else { if (run >= 5) { total += 3 + (run - 5); } run = 1; }
      }
      if (run >= 5) { total += 3 + (run - 5); }
      return total;
    }
    for (var r = 0; r < size; r++) { score += runScore(m[r]); }
    for (var c = 0; c < size; c++) {
      var col = [];
      for (var rr = 0; rr < size; rr++) { col.push(m[rr][c]); }
      score += runScore(col);
    }
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) { score += 3; }
      }
    }
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = pat1.slice().reverse();
    function eq(seg, pat) {
      for (var i = 0; i < pat.length; i++) { if (seg[i] !== pat[i]) { return false; } }
      return true;
    }
    function findPat(line) {
      var cnt = 0, n = pat1.length;
      for (var i = 0; i + n <= line.length; i++) {
        var seg = line.slice(i, i + n);
        if (eq(seg, pat1) || eq(seg, pat2)) { cnt++; }
      }
      return cnt;
    }
    for (var row2 = 0; row2 < size; row2++) { score += 40 * findPat(m[row2]); }
    for (var col2 = 0; col2 < size; col2++) {
      var colv = [];
      for (var rr2 = 0; rr2 < size; rr2++) { colv.push(m[rr2][col2]); }
      score += 40 * findPat(colv);
    }
    var dark = 0;
    for (var a = 0; a < size; a++) { for (var b2 = 0; b2 < size; b2++) { dark += m[a][b2]; } }
    var ratio = Math.floor((dark * 100) / (size * size));
    score += 10 * Math.floor(Math.abs(ratio - 50) / 5);
    return score;
  }

  function buildMatrix(text, mask) {
    var bytes = utf8Bytes(String(text));
    var version = pickVersion(bytes.length);
    var size = 17 + version * 4;
    var words = interleave(encodeData(bytes, version), version);

    var base = newMatrix(size);
    placeFinder(base, 0, 0);
    placeFinder(base, 0, size - 7);
    placeFinder(base, size - 7, 0);
    placeAlignment(base, version);
    placeTiming(base);
    reserveFormat(base);
    placeData(base, words);

    if (mask !== undefined && mask !== null) {
      var chosen = ((mask % 8) + 8) % 8;
      var matrix = applyMask(base, chosen);
      placeFormat(matrix, chosen);
      return { matrix: matrix, mask: chosen, version: version };
    }
    var best = null;
    for (var mk = 0; mk < 8; mk++) {
      var cand = applyMask(base, mk);
      placeFormat(cand, mk);
      var sc = penalty(cand);
      if (!best || sc < best.score) { best = { score: sc, matrix: cand, mask: mk }; }
    }
    return { matrix: best.matrix, mask: best.mask, version: version };
  }

  function svg(text, options) {
    var opt = options || {};
    var scale = opt.scale || 6;
    var border = opt.border === undefined ? 4 : opt.border;
    var dark = opt.dark || "#0b2540";
    var light = opt.light || "#ffffff";
    var res = buildMatrix(text);
    var m = res.matrix;
    var size = m.length;
    var dim = (size + border * 2) * scale;
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" role="img" aria-label="공유 QR 코드">'];
    parts.push('<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>');
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!m[r][c]) { continue; }
        parts.push('<rect x="' + ((c + border) * scale) + '" y="' + ((r + border) * scale) +
          '" width="' + scale + '" height="' + scale + '" fill="' + dark + '"/>');
      }
    }
    parts.push("</svg>");
    return parts.join("");
  }

  global.BadaQR = {
    buildMatrix: buildMatrix, svg: svg, version: "1.0",
    _internal: { encodeData: encodeData, interleave: interleave, utf8Bytes: utf8Bytes, pickVersion: pickVersion }
  };
})(window);
