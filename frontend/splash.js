/* ============================================================
   🌊 바다토익 — WebGL 바다 윤슬 스플래시 (Canvas 2D 폴백 포함)
   ------------------------------------------------------------
   · GLSL 프래그먼트 셰이더로 실제 바다 사진 같은 수면을 그립니다.
     - 가로로 길게 겹치는 잔물결(anisotropic ripple) + 원근(위는 촘촘, 아래는 넓게)
     - 화면 중앙 세로축을 따라 쏟아지는 태양 윤슬 빛기둥
     - 물결 법선 기반의 날카로운 스페큘러 + 십자 별모양 글린트
   · 인트로 내내 화면 전체(100%)가 바다로 가득 차 있고,
     약 1.25초 뒤 0.75초 동안 깔끔한 크로스디졸브로 사라집니다.
   · devicePixelRatio 는 최대 2로 제한하고, 내부 버퍼는 82만 픽셀로 캡.
   · 디졸브가 끝나면 cancelAnimationFrame 으로 루프를 완전히 멈춥니다(GPU/배터리 0).
   · WebGL 을 못 쓰는 기기에서는 Canvas 2D 로 같은 분위기를 그립니다.
   사용법:
     const ctrl = BadaSplash.mount(canvas, { duration: 2000 });
     ctrl.stop();     // 즉시 정지(탭 스킵·디졸브 종료)
     ctrl.restart();  // 다시 보기
   ============================================================ */
(function (global) {
  "use strict";

  var VERT = [
    "attribute vec2 a_pos;",
    "void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2 u_res;",
    "uniform float u_time;",
    "",
    "float hash(vec2 p){",
    "  p = fract(p * vec2(123.34, 456.21));",
    "  p += dot(p, p + 45.32);",
    "  return fract(p.x * p.y);",
    "}",
    "float noise(vec2 p){",
    "  vec2 i = floor(p), f = fract(p);",
    "  vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),",
    "             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);",
    "}",
    "float fbm2(vec2 p){",
    "  float v = 0.0, a = 0.58;",
    "  for (int i = 0; i < 2; i++) { v += a * noise(p); p = p * 2.07 + 5.3; a *= 0.48; }",
    "  return v;",
    "}",
    "// 가로로 길게 늘어진 잔물결 높이 (x는 느리게, y는 촘촘하게)",
    "float ripple(vec2 p){",
    "  return 0.58 * noise(p)",
    "       + 0.28 * noise(p * vec2(2.1, 2.6) + 7.3)",
    "       + 0.14 * noise(p * vec2(3.9, 5.4) + 2.1);",
    "}",
    "",
    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / u_res;",
    "  float aspect = u_res.x / u_res.y;",
    "  float t = u_time;",
    "  float px = uv.x * aspect;",
    "",
    "  // ---- 원근: 위(먼 곳)는 촘촘하고, 아래(가까운 곳)는 넓게 ----",
    "  float py = pow(clamp(uv.y, 0.0, 1.0) + 0.012, 0.60);",
    "  float flow = t * 0.85;",
    "  vec2 p = vec2(px * 1.5 + sin(uv.y * 3.0 + t * 0.18) * 0.07, py * 38.0 + flow);",
    "",
    "  // ---- 잔물결 높이장 + 가로 능선 ----",
    "  float h = ripple(p);",
    "  float band = sin((p.y + flow * 0.9) * 2.9 + h * 2.6);",
    "  float hn = clamp(h * 0.98 + 0.055 * band, 0.0, 1.0);",
    "  float crest = smoothstep(0.60, 0.90, hn);",
    "",
    "  // ---- 바닷물 색: #072b4d ~ #0e5a8a ~ #1d85b8 ----",
    "  vec3 cDeep = vec3(0.024, 0.165, 0.290);",
    "  vec3 cMid  = vec3(0.055, 0.353, 0.541);",
    "  vec3 cLite = vec3(0.114, 0.522, 0.722);",
    "  vec3 col = mix(cMid, cDeep, smoothstep(0.10, 0.98, uv.y));",
    "  col += cLite * 0.20 * smoothstep(0.34, 0.0, uv.y);",   // 위쪽 하늘 반사
    "  col = mix(col, cLite * 1.22, crest * 0.38);",           // 능선 밝게
    "  col *= 0.82 + 0.34 * hn;",                              // 골은 어둡게
    "  float lineHi = pow(0.5 + 0.5 * band, 11.0);",
    "  col += cLite * lineHi * 0.18;",
    "  col *= 1.0 - 0.20 * pow(0.5 - 0.5 * band, 3.0);",   // 골에 생기는 어두운 잔물결 선                          // 가로 물빛 선
    "",
    "  // ---- 중앙 윤슬 빛기둥 ----",
    "  float cx = uv.x - 0.5 + 0.016 * sin(uv.y * 11.0 + t * 0.9 + h * 3.0);",
    "  float cw = mix(0.062, 0.155, smoothstep(0.05, 0.9, uv.y));",
    "  float column = exp(-(cx * cx) / (2.0 * cw * cw));",
    "  column *= smoothstep(0.02, 0.10, uv.y) * (1.0 - 0.45 * smoothstep(0.80, 1.0, uv.y));",
    "",
    "  // ---- 물결 법선 → 날카로운 스페큘러 ----",
    "  float e = 0.045;",
    "  vec2 pn = vec2(px * 6.5, py * 60.0 + flow * 1.3);",
    "  float sy = noise(pn + vec2(0.0, e)) - noise(pn - vec2(0.0, e));",
    "  float sx = noise(pn + vec2(e * 2.0, 0.0)) - noise(pn - vec2(e * 2.0, 0.0));",
    "  vec3 n = normalize(vec3(-sx * 9.0, -sy * 14.0, 1.0));",
    "  vec3 Ld = normalize(vec3(0.0, 0.80, 0.60));",
    "  vec3 H = normalize(Ld + vec3(0.0, 0.0, 1.0));",
    "  float spec = pow(max(dot(n, H), 0.0), 60.0);",
    "  vec3 sun = vec3(1.0, 0.995, 0.97);",
    "  col += sun * spec * (0.10 + 2.4 * column) * (0.55 + 0.45 * crest);",
    "",
    "  // 더 잔물결의 미세 스페큘러 (촘촘한 작은 글린트)",
    "  vec2 pm = vec2(px * 8.0, py * 150.0 + flow * 2.4);",
    "  float my = noise(pm + vec2(0.0, e)) - noise(pm - vec2(0.0, e));",
    "  float mx = noise(pm + vec2(e * 2.0, 0.0)) - noise(pm - vec2(e * 2.0, 0.0));",
    "  vec3 n2 = normalize(vec3(-mx * 10.0, -my * 18.0, 1.0));",
    "  float spec2 = pow(max(dot(n2, H), 0.0), 120.0);",
    "  col += sun * spec2 * (0.05 + 1.0 * column);",
    "",
    "  // ---- 빛기둥 안의 부서지는 글리터 ----",
    "  float glit = smoothstep(0.52, 0.90, fbm2(vec2(px * 22.0, py * 60.0 - t * 1.6)));",
    "  col += sun * glit * column * (0.18 + 0.62 * glit);",
    "",
    "  // 빛기둥을 따라 흐르는 가로 대시 글린트",
    "  float dash = smoothstep(0.72, 0.985, noise(vec2(px * 24.0, py * 160.0 + flow * 3.0)));",
    "  col += sun * dash * column * 0.45;",
    "",
    "  // 기둥 전체의 은은한 물빛 번짐",
    "  col += vec3(0.10, 0.30, 0.40) * column * 0.26;",
    "",
    "  // ---- 기둥 밖으로 흩뿌려진 작은 반짝임 ----",
    "  float scat = smoothstep(0.82, 0.985, noise(vec2(px * 52.0, py * 104.0 - t * 2.4)));",
    "  col += sun * scat * 0.50 * (0.22 + 0.78 * smoothstep(0.0, 0.75, 1.0 - uv.y));",
    "  float scat2 = smoothstep(0.86, 0.995, noise(vec2(px * 108.0, py * 210.0 - t * 3.2)));",
    "  col += sun * scat2 * 0.45 * (0.20 + 0.80 * column);",
    "",
    "  // ---- 십자 별모양 스타버스트 글린트 ----",
    "  vec2 g = vec2(px * 28.0, py * 84.0);",
    "  vec2 id = floor(g);",
    "  vec2 f = fract(g) - 0.5;",
    "  float rnd = hash(id * 1.31 + 7.7);",
    "  vec2 off = vec2(hash(id + 13.1), hash(id + 5.7)) - 0.5;",
    "  vec2 d = f - off * 0.7;",
    "  float star = exp(-abs(d.x) * 24.0) * exp(-abs(d.y) * 7.0)",
    "             + exp(-abs(d.y) * 24.0) * exp(-abs(d.x) * 7.0);",
    "  float core = exp(-dot(d, d) * 110.0);",
    "  float mask = step(0.70, rnd) * (0.30 + 1.5 * column)",
    "             * (0.45 + 0.55 * smoothstep(0.0, 0.6, 1.0 - uv.y));",
    "  float tw = 0.55 + 0.45 * sin(t * 2.4 + rnd * 6.28);",
    "  col += sun * (star * 0.50 + core * 1.60) * mask * tw;",
    "",
    "  // 기둥 중심의 눈부신 코어 (순백색 윤슬 길)",
    "  col += sun * pow(column, 2.5) * 0.16;",
    "",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("shader: " + log);
    }
    return sh;
  }

  function mount(canvas, options) {
    var opts = options || {};
    var duration = opts.duration || 2000;
    var startedAt = 0;
    var raf = 0;
    var running = false;
    var stopped = false;
    var gl = null;
    var program = null;
    var uniforms = {};
    var ctx2d = null;
    var w = 0, h = 0, dpr = 1;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth));
      var cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight));
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      var maxPixels = 820000;
      var scale = dpr;
      if (cssW * cssH * dpr * dpr > maxPixels) {
        scale = Math.max(1, Math.sqrt(maxPixels / (cssW * cssH)));
      }
      w = Math.round(cssW * scale);
      h = Math.round(cssH * scale);
      canvas.width = w;
      canvas.height = h;
      if (gl) { gl.viewport(0, 0, w, h); }
    }

    function initGL() {
      var attrs = { alpha: true, antialias: false, depth: false, stencil: false,
                    premultipliedAlpha: false, powerPreference: "low-power" };
      gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
      if (!gl) { return false; }
      try {
        var vs = compile(gl, gl.VERTEX_SHADER, VERT);
        var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error("link: " + gl.getProgramInfoLog(program));
        }
        gl.useProgram(program);
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(program, "a_pos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        uniforms = {
          res: gl.getUniformLocation(program, "u_res"),
          time: gl.getUniformLocation(program, "u_time")
        };
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        return true;
      } catch (err) {
        console.warn("바다토익: WebGL 셰이더를 쓸 수 없어 Canvas 2D로 대체합니다.", err);
        gl = null;
        return false;
      }
    }

    /* ---------- Canvas 2D 폴백 (가로 잔물결 + 중앙 윤슬 기둥) ---------- */
    var sparkSeed = [];
    for (var i = 0; i < 140; i++) {
      var centered = Math.random() < 0.62;
      sparkSeed.push({
        x: centered ? 0.5 + (Math.random() - 0.5) * 0.30 : Math.random(),
        y: Math.random(),
        p: Math.random() * 6.28,
        s: 0.5 + Math.random(),
        v: 0.002 + Math.random() * 0.004,
        star: Math.random() < 0.35
      });
    }

    function draw2d(p, elapsed) {
      var g = ctx2d;
      if (!g) { return; }
      var t = elapsed / 1000;
      g.clearRect(0, 0, w, h);

      // 바닷물 전체 그라데이션 (#1d85b8 → #0e5a8a → #072b4d)
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#1d85b8");
      grad.addColorStop(0.34, "#0e5a8a");
      grad.addColorStop(1, "#072b4d");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      // 가로 잔물결 (위는 촘촘, 아래는 넓게)
      for (var i = 0; i < 54; i++) {
        var fy = (i + 0.5) / 54;
        var y0 = Math.pow(fy, 0.62) * h;
        var amp = h * (0.004 + 0.012 * fy);
        var speed = 0.35 + fy * 0.5;
        g.beginPath();
        for (var x = 0; x <= w; x += Math.max(6, Math.round(w / 64))) {
          var u = x / w;
          var y = y0
            + Math.sin(u * 6.283 * (1.4 + fy) + t * speed + i) * amp
            + Math.sin(u * 6.283 * (3.1 + fy * 2.0) - t * speed * 1.6 + i * 0.7) * amp * 0.4;
          if (x === 0) { g.moveTo(x, y); } else { g.lineTo(x, y); }
        }
        var nearCenter = 1.0 - Math.min(1, Math.abs(0.5 - 0.5) * 2);
        g.strokeStyle = "rgba(168, 232, 250, " + (0.05 + 0.10 * (1 - fy) + 0.05 * nearCenter).toFixed(3) + ")";
        g.lineWidth = Math.max(1, (1.0 + fy * 1.6) * dpr * 0.7);
        g.stroke();
      }

      g.save();
      g.globalCompositeOperation = "lighter";

      // 중앙 윤슬 빛기둥
      var cw = w * (0.10 + 0.09 * Math.min(1, 1));
      var cg = g.createLinearGradient(w * 0.5 - cw, 0, w * 0.5 + cw, 0);
      cg.addColorStop(0, "rgba(255,255,255,0)");
      cg.addColorStop(0.5, "rgba(210,245,255,0.16)");
      cg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = cg;
      g.fillRect(0, 0, w, h);

      // 글린트
      for (var k = 0; k < sparkSeed.length; k++) {
        var sp = sparkSeed[k];
        var sx = sp.x * w;
        var sy = sp.y * h;
        var tw = 0.35 + 0.65 * Math.abs(Math.sin(elapsed / 620 * sp.s + sp.p));
        var inCol = Math.max(0, 1 - Math.abs(sp.x - 0.5) / 0.26);
        var near = 1.0 - sp.y * 0.45;
        var r = (0.8 + 1.2 * sp.s) * dpr;
        g.fillStyle = "rgba(255,255,255," + (0.75 * tw * near * (0.35 + 0.65 * inCol)).toFixed(3) + ")";
        if (sp.star) {
          g.beginPath();
          g.ellipse(sx, sy, r * 2.4, r * 0.6, 0, 0, 6.283);
          g.fill();
          g.beginPath();
          g.ellipse(sx, sy, r * 0.6, r * 2.4, 0, 0, 6.283);
          g.fill();
        } else {
          g.beginPath();
          g.ellipse(sx, sy, r * 1.5, r * 0.8, -0.2, 0, 6.283);
          g.fill();
        }
      }
      g.restore();
    }

    function frame(now) {
      if (!running) { return; }
      if (!startedAt) { startedAt = now; }
      var elapsed = now - startedAt;
      var p = Math.max(0, Math.min(1, elapsed / duration));
      if (gl && program) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uniforms.res, w, h);
        gl.uniform1f(uniforms.time, Math.min(12, elapsed / 1000));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        draw2d(p, Math.min(12000, elapsed));
      }
      if (p >= 1) {
        running = false;
        raf = 0;
        return;
      }
      raf = global.requestAnimationFrame(frame);
    }

    function start() {
      resize();
      if (!gl && !ctx2d) {
        if (!initGL()) {
          ctx2d = canvas.getContext("2d");
        }
      }
      if (gl) { gl.viewport(0, 0, w, h); }
      stopped = false;
      running = true;
      startedAt = 0;
      if (!raf) { raf = global.requestAnimationFrame(frame); }
    }

    function stop() {
      running = false;
      stopped = true;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      if (gl) { gl.clear(gl.COLOR_BUFFER_BIT); }
      if (ctx2d) { ctx2d.clearRect(0, 0, w, h); }
    }

    function restart() {
      stop();
      start();
    }

    var onResize = function () {
      if (stopped) { return; }
      resize();
      if (gl) { gl.viewport(0, 0, w, h); }
    };
    global.addEventListener("resize", onResize);

    start();

    function setDuration(ms) {
      duration = Math.max(200, Number(ms) || 2000);
    }

    function destroy() {
      stop();
      global.removeEventListener("resize", onResize);
    }

    var api = {
      start: start,
      stop: stop,
      restart: restart,
      destroy: destroy,
      setDuration: setDuration,
      isWebGL: function () { return !!gl; },
      isRunning: function () { return running; },
      dpr: function () { return dpr; },
      progress: function () {
        return startedAt ? Math.min(1, (performance.now() - startedAt) / duration) : 0;
      }
    };
    global.BadaSplash.last = api;
    return api;
  }

  global.BadaSplash = { mount: mount };
})(window);
