/* ============================================================
   🌊 바다토익 (BADA TOEIC) — 프론트엔드
   - 개인 학습 데이터는 오직 이 브라우저 localStorage(badaToeic.v1)에만 저장
   - 서버는 문제은행·채점·음성·단어/문법 데이터·AI 중계만 담당
   - 기능: 진단·약점 공략·파트 훈련·타임어택·오답노트·단어 암기/시험/복기·
           문법 강의·LC 받아쓰기·Part 7 근거 하이라이트·기록 내보내기
   ============================================================ */
(function () {
  "use strict";

  var KEY = "badaToeic.v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nowISO() { return new Date().toISOString(); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function dateLabel(iso) {
    try { var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate(); }
    catch (e) { return ""; }
  }
  function todayLabel() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  var PART_INFO = {
    1: { name: "사진 묘사", desc: "그림을 보고 알맞은 묘사를 고르는 파트" },
    2: { name: "질의응답", desc: "질문을 듣고 가장 알맞은 응답을 고르는 파트" },
    3: { name: "대화", desc: "짧은 대화를 듣고 세부 내용·의도를 파악" },
    4: { name: "담화", desc: "안내·광고 등의 담화를 듣고 핵심을 파악" },
    5: { name: "단문 빈칸", desc: "문법·어휘로 한 문장의 빈칸 채우기" },
    6: { name: "장문 빈칸", desc: "지문의 빈칸을 문법·어휘로 완성" },
    7: { name: "독해", desc: "이메일·공지·기사 지문을 읽고 답하기" }
  };
  var PASSAGE_LABEL = {
    email: "이메일", advertisement: "광고", notice: "안내문", article: "기사",
    chat: "채팅 대화", double: "지문 A · B", conversation: "대화", announcement: "안내 방송",
    radio: "라디오 방송", tour_guide: "안내 담화", photo_script: "사진 설명", question_response: "질문과 응답"
  };
  var STOPWORDS = ("the a an and or but if because so that this these those of to in on at for with from by as is are was were be been being have has had do does did will would can could should may might must not no yes i you he she it we they my your his her its our their there here than then when where who whom whose which what how all any some more most very just also about into over under after before during while such each other another only own same too both few many much").split(" ");

  /* ------------------------------------------------------------
     저장소
     ------------------------------------------------------------ */
  function defaultStore() {
    return {
      v: 1, createdAt: nowISO(), updatedAt: nowISO(),
      settings: { target: 800, voice: "us", geminiKey: "", aiPart: 0, timeAttack: false },
      records: [], sessions: [], history: [], wrong: {}, vocab: {}, generated: [], vocabExams: []
    };
  }
  function normalize(raw) {
    var d = defaultStore();
    if (!raw || typeof raw !== "object") { return d; }
    var s = raw.settings || {};
    d.settings.target = clamp(parseInt(s.target, 10) || 800, 400, 990);
    d.settings.voice = ["us", "uk", "au"].indexOf(s.voice) >= 0 ? s.voice : "us";
    d.settings.geminiKey = typeof s.geminiKey === "string" ? s.geminiKey : "";
    d.settings.aiPart = parseInt(s.aiPart, 10) || 0;
    d.settings.timeAttack = !!s.timeAttack;
    d.records = Array.isArray(raw.records) ? raw.records.filter(function (r) { return r && r.id; }) : [];
    d.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
    d.history = Array.isArray(raw.history) ? raw.history : [];
    d.wrong = raw.wrong && typeof raw.wrong === "object" ? raw.wrong : {};
    d.vocab = raw.vocab && typeof raw.vocab === "object" ? raw.vocab : {};
    d.generated = Array.isArray(raw.generated) ? raw.generated.filter(function (g) { return g && g.id; }) : [];
    d.vocabExams = Array.isArray(raw.vocabExams) ? raw.vocabExams : [];
    if (raw.createdAt) { d.createdAt = raw.createdAt; }
    return d;
  }
  function loadStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultStore();
    } catch (e) {
      console.warn("저장된 학습 기록을 읽지 못했습니다.", e);
      return defaultStore();
    }
  }
  var D = loadStore();
  function save() {
    D.updatedAt = nowISO();
    if (D.records.length > 5000) { D.records = D.records.slice(-5000); }
    if (D.history.length > 120) { D.history = D.history.slice(-120); }
    if (D.sessions.length > 120) { D.sessions = D.sessions.slice(0, 120); }
    if (D.vocabExams.length > 40) { D.vocabExams = D.vocabExams.slice(0, 40); }
    try { localStorage.setItem(KEY, JSON.stringify(D)); }
    catch (e) { toast("브라우저 저장 공간이 부족합니다. 기록을 내보낸 뒤 정리해 주세요."); }
  }

  /* ------------------------------------------------------------
     상태
     ------------------------------------------------------------ */
  var S = {
    bank: null, index: {}, genIndex: {}, session: null, exam: null,
    analysis: null, health: null, vocabBank: null, grammar: null,
    shareUrl: null, flashIdx: 0, busy: false, timer: null
  };
  var player = { el: null, url: null, id: null };
  var wordAudio = {};

  function api(path, body) {
    var init = { method: body === undefined ? "GET" : "POST", headers: {} };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: "서버 응답을 해석할 수 없습니다." }; })
        .then(function (data) {
          if (!res.ok || data.ok === false) {
            var err = new Error(data.error || ("요청 실패 (" + res.status + ")"));
            err.status = res.status; err.data = data;
            throw err;
          }
          return data;
        });
    });
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $("#toast");
    if (!el) { return; }
    el.textContent = msg;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-show"); }, ms || 2600);
  }

  function rebuildGenIndex() {
    S.genIndex = {};
    D.generated.forEach(function (q) { S.genIndex[q.id] = q; });
  }
  function questionById(id) { return S.index[id] || S.genIndex[id] || null; }

  /* ------------------------------------------------------------
     내비게이션
     ------------------------------------------------------------ */
  var CURRENT = "home";
  var VIEWS = ["home", "quiz", "parts", "wrong", "vocab", "grammar", "report", "settings"];
  function nav(view) {
    if (VIEWS.indexOf(view) < 0) { view = "home"; }
    CURRENT = view;
    $$(".view").forEach(function (v) { v.classList.remove("is-active"); });
    var el = $("#view-" + view);
    if (el) { el.classList.add("is-active"); }
    $$(".nav-item").forEach(function (b) {
      var target = b.getAttribute("data-nav");
      b.classList.toggle("is-active", target === view || (view === "grammar" && target === "parts"));
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "home") { renderHome(); }
    if (view === "parts") { renderParts(); }
    if (view === "wrong") { renderWrong(); }
    if (view === "vocab") { renderVocab(); }
    if (view === "grammar") { renderGrammar(); }
    if (view === "report") { renderReport(); }
    if (view === "settings") { renderSettings(); }
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-nav]");
    if (t) { nav(t.getAttribute("data-nav")); }
  });

  /* ------------------------------------------------------------
     차트
     ------------------------------------------------------------ */
  function gaugeSvg(total) {
    var r = 62, cir = 2 * Math.PI * r;
    var pct = total == null ? 0 : clamp(total / 990, 0, 1);
    var dash = (cir * pct).toFixed(1);
    return '<svg viewBox="0 0 160 160" role="img" aria-label="예상 점수 ' + (total == null ? "없음" : total) + '점">' +
      '<defs><linearGradient id="badaGauge" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#38b6ff"/><stop offset="100%" stop-color="#39e6d0"/></linearGradient></defs>' +
      '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="13"/>' +
      '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="url(#badaGauge)" stroke-width="13" ' +
      'stroke-linecap="round" stroke-dasharray="' + cir.toFixed(1) + '" stroke-dashoffset="' + (cir - dash) + '" ' +
      'transform="rotate(-90 80 80)"/>' +
      '<text x="80" y="80" text-anchor="middle" fill="#eaf6ff" font-size="34" font-weight="800">' +
      (total == null ? "-" : total) + "</text>" +
      '<text x="80" y="102" text-anchor="middle" fill="#9fb9cc" font-size="12">/ 990</text></svg>';
  }

  function lineChart(points, opts) {
    var o = opts || {};
    var w = 620, h = o.height || 200, padL = 34, padR = 12, padT = 14, padB = 24;
    if (!points.length) { return '<p class="muted">아직 기록이 없습니다. 진단 테스트나 문제 풀이를 시작해 보세요.</p>'; }
    var vals = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 40) { min -= 20; max += 20; }
    min = Math.max(0, min - 10); max = Math.min(990, max + 10);
    var iw = w - padL - padR, ih = h - padT - padB;
    function X(i) { return padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw); }
    function Y(v) { return padT + ih - ((v - min) / Math.max(1, max - min)) * ih; }
    var path = points.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.value).toFixed(1); }).join(" ");
    var area = path + " L" + X(points.length - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";
    var grid = "";
    for (var g = 0; g < 4; g++) {
      var gy = padT + (ih / 3) * g;
      var gv = Math.round(max - ((max - min) / 3) * g);
      grid += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + gy + '" y2="' + gy + '" stroke="rgba(255,255,255,0.07)"/>' +
        '<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#6f8fa6" font-size="10">' + gv + "</text>";
    }
    var dots = points.map(function (p, i) {
      return '<circle cx="' + X(i) + '" cy="' + Y(p.value) + '" r="3.4" fill="#39e6d0"/>';
    }).join("");
    var labels = "";
    if (points.length > 1) {
      labels = '<text x="' + X(0) + '" y="' + (h - 6) + '" fill="#6f8fa6" font-size="10">' + esc(points[0].label) + "</text>" +
        '<text x="' + X(points.length - 1) + '" y="' + (h - 6) + '" text-anchor="end" fill="#6f8fa6" font-size="10">' +
        esc(points[points.length - 1].label) + "</text>";
    }
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="점수 추이 그래프">' +
      '<defs><linearGradient id="badaArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(57,230,208,0.35)"/><stop offset="100%" stop-color="rgba(56,182,255,0)"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#badaArea)"/>' +
      '<path d="' + path + '" fill="none" stroke="#38b6ff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + "</svg>";
  }

  function accBar(pct) {
    var cls = pct == null ? "" : (pct < 50 ? " low" : (pct < 75 ? " mid" : ""));
    return '<span class="acc-bar' + cls + '"><i style="width:' + (pct == null ? 0 : clamp(pct, 0, 100)) + '%"></i></span>';
  }

  /* ------------------------------------------------------------
     홈
     ------------------------------------------------------------ */
  function renderHome() {
    var a = S.analysis;
    var est = a ? a.estimate : { total: null, lc: null, rc: null };
    $("#homeGauge").innerHTML = gaugeSvg(est.total);
    $("#chipScoreValue").textContent = est.total == null ? "-" : est.total;
    $("#homeMessage").textContent = a ? a.message : "먼저 16문항 진단 테스트로 현재 위치를 확인해 보세요.";

    var solved = D.records.length;
    var correct = D.records.filter(function (r) { return r.correct; }).length;
    $("#statTotal").textContent = est.total == null ? "-" : est.total;
    $("#statBand").textContent = a && a.band ? ("예상 범위 " + a.band[0] + "~" + a.band[1] + "점") : (a ? "" : "진단 전");
    $("#statLcRc").textContent = (est.lc == null ? "-" : est.lc) + " / " + (est.rc == null ? "-" : est.rc);
    $("#statSolved").textContent = solved;
    $("#statAccuracy").textContent = solved ? ("정답률 " + Math.round((correct / solved) * 100) + "%") : "정답률 -";
    $("#statGap").textContent = a && a.gap != null ? (a.gap > 0 ? a.gap : "달성") : "-";
    $("#statTarget").textContent = "목표 " + D.settings.target + "점";

    var weakBox = $("#homeWeak");
    if (a && a.weak && a.weak.length) {
      weakBox.innerHTML = a.weak.map(function (w) {
        var pct = w.accuracy == null ? 0 : w.accuracy;
        return '<div class="weak-item">' +
          '<span class="w-name">' + esc(w.type) + ' <span class="muted small">Part ' + w.part + "</span></span>" +
          '<span class="weak-badge">' + pct + "%</span>" +
          '<span class="w-bar"><i style="width:' + clamp(100 - pct, 4, 100) + '%"></i></span>' +
          '<span class="w-sub">' + w.attempted + "문항 중 " + w.correct + "문항 정답" +
          (w.timing && w.timing.avg_sec != null ? " · 평균 " + w.timing.avg_sec + "초" : "") + "</span></div>";
      }).join("");
    } else {
      weakBox.innerHTML = '<p class="muted">진단을 마치면 취약 유형이 나타납니다. 16문항이면 충분해요.</p>';
    }

    var pts = D.history.slice(-12).map(function (h) { return { label: dateLabel(h.at), value: h.total }; });
    $("#homeHistory").innerHTML = pts.length ? lineChart(pts, { height: 150 }) : '<p class="muted">아직 기록이 없습니다.</p>';
    $("#historyCount").textContent = pts.length ? pts.length + "회 기록" : "";
    $("#btnStartDiag").textContent = solved ? "진단 다시 보기" : "진단 테스트 시작";
  }

  /* ------------------------------------------------------------
     파트별
     ------------------------------------------------------------ */
  function typesByPart() {
    var map = {};
    function add(item) {
      if (!map[item.part]) { map[item.part] = []; }
      if (item.type && map[item.part].indexOf(item.type) < 0) { map[item.part].push(item.type); }
    }
    (S.bank ? S.bank.questions : []).forEach(add);
    D.generated.forEach(add);
    return map;
  }
  function renderParts() {
    var tmap = typesByPart();
    var counts = {};
    (S.bank ? S.bank.questions : []).forEach(function (q) { counts[q.part] = (counts[q.part] || 0) + 1; });
    var html = "";
    [1, 2, 3, 4, 5, 6, 7].forEach(function (p) {
      html += '<div class="card glass part-card">' +
        '<h3><span class="part-num">' + p + "</span>" + PART_INFO[p].name + "</h3>" +
        '<p class="p-types">' + esc((tmap[p] || []).join(", ")) + "</p>" +
        '<p class="p-meta">' + esc(PART_INFO[p].desc) + " · 내장 " + (counts[p] || 0) + "문항</p>" +
        '<button class="btn small primary" data-start-part="' + p + '">이 파트 풀기</button>' +
        "</div>";
    });
    $("#partGrid").innerHTML = html;
    var ta = $("#timeAttack");
    if (ta) { ta.checked = !!D.settings.timeAttack; }
  }

  /* ------------------------------------------------------------
     세션 시작
     ------------------------------------------------------------ */
  function slimRecords() {
    return D.records.slice(-800).map(function (r) {
      return { id: r.id, part: r.part, type: r.type, difficulty: r.difficulty, correct: r.correct, time_ms: r.time_ms || 0 };
    });
  }

  function startSession(kind, label, questions, part) {
    if (!questions || !questions.length) { toast("문제를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
    S.session = {
      id: "s" + Date.now(), kind: kind, label: label, part: part || null,
      questions: questions, answers: {}, results: {}, idx: 0,
      startedAt: nowISO(), qStart: 0, timeAttack: !!D.settings.timeAttack
    };
    stopAudio(); clearInterval(S.timer);
    nav("quiz");
    renderQuiz();
    prefetchAudio(questions);
  }

  function prefetchAudio(questions) {
    var ids = [];
    questions.forEach(function (q) {
      if (q.part >= 1 && q.part <= 4 && q.source !== "ai" && !q.prefetched) { ids.push(q.id); q.prefetched = true; }
    });
    if (ids.length) { api("/api/audio/prefetch", { ids: ids.slice(0, 12), voice: D.settings.voice }).catch(function () { }); }
  }

  function startDiagnostic() {
    if (S.busy) { return; }
    S.busy = true; toast("진단 문제를 준비하고 있어요…");
    api("/api/diagnostic").then(function (r) { startSession("diagnostic", "16문항 진단 테스트", r.questions); })
      .catch(function (e) { toast("진단을 시작할 수 없습니다: " + e.message); })
      .then(function () { S.busy = false; });
  }

  function startPractice(part) {
    if (S.busy) { return; }
    var count = parseInt($("#partCount") ? $("#partCount").value : "10", 10) || 10;
    S.busy = true; toast("약점을 반영해 문제를 고르는 중…");
    api("/api/recommend", { records: slimRecords(), part: part || null, count: count })
      .then(function (r) {
        startSession(part ? "part" : "daily", part ? ("Part " + part + " 집중 훈련") : ("오늘의 추천 " + count + "문제"), r.questions, part);
      })
      .catch(function (e) { toast("문제를 불러오지 못했습니다: " + e.message); })
      .then(function () { S.busy = false; });
  }

  function startWrongRetry() {
    var ids = Object.keys(D.wrong).filter(function (k) { return !D.wrong[k].graduated; });
    var qs = ids.map(questionById).filter(Boolean).slice(0, 10);
    if (!qs.length) { toast("다시 풀 오답이 없습니다. 문제를 먼저 풀어 보세요."); return; }
    startSession("wrong", "오답 다시 풀기", qs);
  }

  function weakPartForAI() {
    var a = S.analysis;
    if (a && a.weak) {
      for (var i = 0; i < a.weak.length; i++) { if (a.weak[i].part >= 2) { return a.weak[i].part; } }
    }
    if (D.settings.aiPart >= 2 && D.settings.aiPart <= 7) { return D.settings.aiPart; }
    return 5;
  }

  function generateAI(opts) {
    var o = opts || {};
    var key = (D.settings.geminiKey || "").trim();
    if (!key) { toast("설정에서 Gemini API 키를 먼저 입력해 주세요."); nav("settings"); return Promise.resolve([]); }
    var part = o.part || weakPartForAI();
    var weakness = (S.analysis && S.analysis.weak ? S.analysis.weak : []).map(function (w) { return w.type + "(" + w.accuracy + "%)"; });
    toast("🤖 AI가 새로운 문제를 만들고 있어요… (10~30초)");
    return api("/api/ai/generate", {
      api_key: key, part: part, count: o.count || 5,
      weakness: weakness, difficulty: o.difficulty || "실전과 동일"
    }).then(function (r) {
      var added = [];
      (r.sets || []).forEach(function (set) {
        (set.questions || []).forEach(function (q) {
          q.source = "ai"; q.passage = set.passage || null;
          if (D.generated.some(function (g) { return g.id === q.id; })) { return; }
          D.generated.push(q); added.push(q);
        });
      });
      rebuildGenIndex(); save();
      if (!added.length) { throw new Error("생성된 문제가 없습니다."); }
      toast("AI 문제 " + added.length + "개를 만들었습니다 (" + (r.model || "Gemini") + ")");
      return added;
    }).catch(function (e) { toast("AI 문제 생성 실패: " + e.message, 4200); return []; });
  }

  function startAI() {
    generateAI({ count: 5 }).then(function (qs) { if (qs.length) { startSession("ai", "AI 약점 공략 문제", qs); } });
  }

  /* ------------------------------------------------------------
     음성
     ------------------------------------------------------------ */
  function stopAudio() {
    if (player.el) { try { player.el.pause(); } catch (e) { } player.el = null; }
  }

  function audioUrlFor(q) {
    if (q._audioUrl) { return Promise.resolve(q._audioUrl); }
    if (q.source === "ai") {
      return fetch("/api/audio/custom", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q.passage ? q.passage.text : "", voice: D.settings.voice })
      }).then(function (r) { if (!r.ok) { throw new Error("audio"); } return r.blob(); })
        .then(function (b) { q._audioUrl = URL.createObjectURL(b); return q._audioUrl; });
    }
    q._audioUrl = "/api/audio/" + encodeURIComponent(q.id) + ".mp3?voice=" + encodeURIComponent(D.settings.voice);
    return Promise.resolve(q._audioUrl);
  }

  function makeAudio() {
    var el = new Audio();
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.preload = "auto";
    return el;
  }

  function prefetchAIAudio(q) {
    if (q.source === "ai" && q.part >= 1 && q.part <= 4 && !q._audioUrl && !q._prefetching) {
      q._prefetching = true;
      audioUrlFor(q).catch(function () { q._prefetching = false; });
    }
  }

  function playAudio(q) {
    var card = $('[data-audio-for="' + q.id + '"]');
    var rate = 1;
    if (card) {
      var sel = $("[data-audio-rate]", card);
      if (sel) { rate = parseFloat(sel.value) || 1; }
      card.classList.add("is-playing");
    }
    stopAudio();
    // iOS Safari: 사용자 제스처 안에서 Audio 객체를 만들고 바로 재생해야 한다.
    var el = makeAudio();
    player.el = el;
    el.addEventListener("error", function () { speakFallback(q, card); });
    el.addEventListener("ended", function () { if (card) { card.classList.remove("is-playing"); } });

    var direct = q._audioUrl || (q.source === "ai" ? null :
      "/api/audio/" + encodeURIComponent(q.id) + ".mp3?voice=" + encodeURIComponent(D.settings.voice));
    if (direct) {
      q._audioUrl = direct;
      el.src = direct;
      el.playbackRate = rate;
      el.play().catch(function () { speakFallback(q, card); });
      return;
    }
    audioUrlFor(q).then(function (url) {
      if (player.el !== el) { return; }
      el.src = url;
      el.playbackRate = rate;
      return el.play();
    }).catch(function () {
      toast("음성을 준비하지 못했습니다. 재생 버튼을 한 번 더 눌러 주세요.");
      speakFallback(q, card);
    });
  }

  function scriptFor(q) {
    if (q.passage && q.passage.text) { return Promise.resolve(q.passage.text); }
    return fetch("/api/script/" + encodeURIComponent(q.id)).then(function (r) {
      if (!r.ok) { throw new Error("no-script"); }
      return r.json();
    }).then(function (d) { return d.text || ""; });
  }

  function speakFallback(q, card) {
    if (card) { card.classList.remove("is-playing"); }
    if (!("speechSynthesis" in window)) { toast("이 브라우저에서는 음성을 재생할 수 없습니다."); return; }
    scriptFor(q).then(function (text) {
      if (!text) { return; }
      var clean = text.replace(/^\s*[A-Z]{1,2}\s*[:：]\s*/gm, "");
      try { window.speechSynthesis.cancel(); } catch (e) { }
      var u = new SpeechSynthesisUtterance(clean);
      u.lang = "en-US"; u.rate = 0.95;
      if (card) {
        var note = $(".audio-note", card);
        if (note) { note.textContent = "🔈 서버 음성을 쓰지 못해 브라우저 음성으로 재생했습니다."; }
      }
      window.speechSynthesis.speak(u);
    }).catch(function () { toast("음성을 준비하지 못했습니다."); });
  }

  function pronounce(text) {
    var word = String(text || "").trim();
    if (!word) { return; }
    if (wordAudio[word]) { new Audio(wordAudio[word]).play().catch(function () { }); return; }
    fetch("/api/audio/custom", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: word, voice: D.settings.voice })
    }).then(function (r) { if (!r.ok) { throw new Error("audio"); } return r.blob(); })
      .then(function (b) {
        var url = URL.createObjectURL(b);
        wordAudio[word] = url;
        new Audio(url).play().catch(function () { });
      })
      .catch(function () {
        if (window.speechSynthesis) {
          var u = new SpeechSynthesisUtterance(word);
          u.lang = "en-US";
          window.speechSynthesis.speak(u);
        }
      });
  }

  /* ------------------------------------------------------------
     퀴즈 렌더링
     ------------------------------------------------------------ */
  function currentQuestion() { return S.session ? S.session.questions[S.session.idx] : null; }

  function highlightText(text, quote) {
    if (!quote) { return esc(text); }
    var idx = text.indexOf(quote);
    if (idx < 0) { return esc(text); }
    return esc(text.slice(0, idx)) + '<mark class="hl">' + esc(text.slice(idx, idx + quote.length)) + "</mark>" +
      esc(text.slice(idx + quote.length));
  }

  function passageHtml(q, res) {
    if (!q.passage || !q.passage.text) { return ""; }
    var label = PASSAGE_LABEL[q.passage.kind] || "지문";
    var body;
    if (res && res.evidence_quote && q.part === 7) {
      body = highlightText(q.passage.text, res.evidence_quote);
    } else {
      body = esc(q.passage.text);
    }
    body = body.replace(/\((\d)\)|___/g, function (m) { return '<span class="blank">' + m + "</span>"; });
    return '<div class="passage"><span class="p-label">' + esc(label) + "</span>" + body + "</div>";
  }

  function audioCardHtml(q) {
    if (!(q.part >= 1 && q.part <= 4)) { return ""; }
    var kindLabel = { 1: "사진 설명 4문장", 2: "질문과 응답", 3: "대화", 4: "담화" }[q.part] || "듣기";
    return '<div class="audio-card" data-audio-for="' + esc(q.id) + '">' +
      '<button class="play" type="button" data-play-audio aria-label="음성 재생">▶</button>' +
      '<div class="a-meta"><b>🎧 ' + esc(kindLabel) + "</b>" +
      '<span class="muted small">듣고 나서 답을 고르세요.</span></div>' +
      '<div class="audio-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<select data-audio-rate aria-label="재생 속도"><option value="0.85">0.85x</option><option value="1" selected>1.0x</option><option value="1.15">1.15x</option></select>' +
      '<p class="audio-note">음성이 재생되지 않으면 자동으로 브라우저 음성 모드로 안내합니다.</p>' +
      "</div>";
  }

  function choicesHtml(q, res) {
    var selected = S.session.answers[q.id];
    var hideText = q.hidden_choices && !res && !q._revealed;
    return q.choices.map(function (c, i) {
      var cls = "choice";
      if (res) {
        if (i === res.answer) { cls += " is-correct"; }
        else if (i === res.chosen) { cls += " is-wrong"; }
      } else if (selected === i) { cls += " is-selected"; }
      if (hideText) { cls += " hidden-choice"; }
      var label = hideText ? "듣고 고르는 선택지" : esc(c);
      return '<button type="button" class="' + cls + '" data-choice="' + i + '"' + (res ? " disabled" : "") + ">" +
        '<span class="key">' + String.fromCharCode(65 + i) + "</span>" +
        '<span class="c-text">' + label + "</span></button>";
    }).join("");
  }

  function grammarButtonHtml(q) {
    var note = noteForType(q.type);
    if (!note) { return ""; }
    return '<button class="btn small ghost" data-grammar-note="' + esc(note.id) + '">📖 관련 문법 강의</button>';
  }

  function renderQuiz() {
    var view = $("#view-quiz");
    if (!S.session) {
      view.innerHTML = '<div class="card glass"><h2>풀고 있는 문제가 없습니다.</h2>' +
        '<p class="muted">홈에서 진단 테스트나 오늘의 추천 문제를 시작해 보세요.</p>' +
        '<div class="actions"><button class="btn primary" data-nav="home">홈으로</button></div></div>';
      return;
    }
    clearInterval(S.timer);
    var s = S.session;
    var q = s.questions[s.idx];
    var res = s.results[q.id];
    var pct = Math.round((s.idx / s.questions.length) * 100);
    var lvlN = clamp(q.difficulty || 2, 1, 3);
    var lvl = "●".repeat(lvlN) + "○".repeat(3 - lvlN);
    var limit = timeLimitFor(q);

    var html = '<div class="quiz-top">' +
      '<button class="btn small ghost" data-exit-quiz>← 나가기</button>' +
      '<div class="quiz-progress"><i style="width:' + pct + '%"></i></div>' +
      '<span class="quiz-count">' + (s.idx + 1) + " / " + s.questions.length + "</span>" +
      '<span id="timerChip" class="timer-chip' + (limit ? "" : " hidden") + '">⏱ ' + (limit || "") + "</span>" +
      "</div>" +
      '<div class="qmeta">' +
      '<span class="tag">Part ' + q.part + " · " + esc(PART_INFO[q.part] ? PART_INFO[q.part].name : "") + "</span>" +
      '<span class="tag type">' + esc(q.type || "유형") + "</span>" +
      '<span class="tag lvl">난이도 ' + lvl + "</span>" +
      (q.source === "ai" ? '<span class="tag type">AI 생성</span>' : "") +
      (q.hidden_choices && !res ? '<button class="link" data-reveal-choices>선택지 텍스트 보기</button>' : "") +
      (limit && !res ? '<span class="tag timeattack">타임어택 ' + limit + "초</span>" : "") +
      "</div>";

    html += '<article class="qcard glass">';
    if (q.svg) { html += '<div class="photo-frame">' + q.svg + "</div>"; }
    html += passageHtml(q, res);
    html += audioCardHtml(q);
    html += '<p class="prompt">' + esc(q.prompt || "").replace(/\((\d)\)|___/g, function (m) { return '<span class="blank">' + m + "</span>"; }) + "</p>";
    html += '<div class="choices" data-choices>' + choicesHtml(q, res) + "</div>";
    html += '<div class="actions"><button class="btn primary" data-check' + (res ? " disabled" : "") + ">" +
      (res ? "채점 완료" : "정답 확인") + "</button>" +
      '<button class="btn" data-replay>🔁 다시 듣기</button></div>';
    if (res) { html += feedbackHtml(q, res); }
    html += "</article>";
    if (res) {
      html += '<div class="actions"><button class="btn primary" data-next>' +
        (s.idx + 1 >= s.questions.length ? "결과 보기" : "다음 문제 →") + "</button></div>";
    }
    view.innerHTML = html;
    s.qStart = Date.now();
    if (q.part >= 1 && q.part <= 4) { prefetchAIAudio(q); }
    startCountdown();
    if (res) {
      var fb = $(".feedback", view);
      if (fb) { fb.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    }
  }

  function timeLimitFor(q) {
    if (!S.session || !S.session.timeAttack) { return 0; }
    if (q.part === 5) { return 20; }
    if (q.part === 6) { return 30; }
    return 0;
  }

  function startCountdown() {
    clearInterval(S.timer);
    var q = currentQuestion();
    if (!q) { return; }
    var limit = timeLimitFor(q);
    if (!limit) { return; }
    var left = limit;
    var chip = $("#timerChip");
    S.timer = setInterval(function () {
      left -= 1;
      var c = $("#timerChip");
      if (c) {
        c.textContent = "⏱ " + Math.max(0, left) + "s";
        c.classList.toggle("urgent", left <= 5);
      }
      if (left <= 0) {
        clearInterval(S.timer);
        if (!S.session || S.session.results[q.id]) { return; }
        checkCurrent(true);
      }
    }, 1000);
  }

  function feedbackHtml(q, res) {
    var ok = res.correct;
    var answerText = q.choices[res.answer];
    var secs = Math.round((res.time_ms || 0) / 1000);
    var html = '<div class="feedback">' +
      '<h3 class="' + (ok ? "fb-correct" : "fb-wrong") + '">' + (ok ? "✅ 정답입니다!" : (res.chosen === -1 ? "⏱ 시간 초과" : "❌ 아쉽게 틀렸어요")) + "</h3>" +
      '<p class="fb-answer">정답: <b>' + String.fromCharCode(65 + res.answer) + ". " + esc(answerText) + "</b>" +
      (secs ? ' <span class="time-badge">⏱ ' + secs + "초</span>" : "") +
      (ok && secs > 30 ? ' <span class="time-badge slow">시간 단축 필요</span>' : "") + "</p>";
    if (res.explanation) { html += '<span class="exp-label">해설</span><p class="exp">' + esc(res.explanation) + "</p>"; }
    if (res.translation) { html += '<span class="exp-label">해석</span><p class="exp">' + esc(res.translation) + "</p>"; }
    if (res.vocabulary && res.vocabulary.length) {
      html += '<span class="exp-label">핵심 어휘</span><div class="vocab-chips">' +
        res.vocabulary.map(function (v) { return '<span class="vchip"><b>' + esc(v.word) + "</b> " + esc(v.meaning) + "</span>"; }).join("") + "</div>";
    }
    if (res.evidence_quote) {
      html += '<span class="exp-label">정답 근거 (지문 하이라이트)</span>' +
        '<div class="evidence"><p>' + esc(res.evidence_quote) + "</p>" +
        (res.paraphrase_pair && res.paraphrase_pair.length
          ? '<div class="para-pairs">' + res.paraphrase_pair.map(function (p) {
            return '<span class="para-pair"><b>' + esc(p.question) + "</b> ↔ " + esc(p.passage) + "</span>";
          }).join("") + "</div>"
          : "") + "</div>";
    }
    if (res.passage && res.passage.text && q.part <= 4) {
      html += '<span class="exp-label">스크립트</span><div class="transcript">' + esc(res.passage.text) + "</div>";
      if (res.passage.translation) { html += '<span class="exp-label">스크립트 해석</span><div class="transcript">' + esc(res.passage.translation) + "</div>"; }
    }
    html += '<div class="row gap wrap fb-actions">' +
      grammarButtonHtml(q) +
      (q.part <= 4 && res.passage && res.passage.text ? '<button class="btn small" data-dictation>✍️ 빈칸 받아쓰기 연습</button>' : "") +
      "</div></div>";
    return html;
  }

  function bindQuizEvents() {
    var view = $("#view-quiz");
    if (!view) { return; }
    view.addEventListener("click", function (ev) {
      if (!S.session) { return; }
      var q = currentQuestion();
      if (ev.target.closest("[data-exit-quiz]")) {
        if (confirm("지금 나가면 이번 풀이 기록은 저장되지 않습니다. 나갈까요?")) {
          stopAudio(); clearInterval(S.timer); S.session = null; nav("home");
        }
        return;
      }
      if (ev.target.closest("[data-reveal-choices]")) { q._revealed = true; renderQuiz(); return; }
      var ch = ev.target.closest("[data-choice]");
      if (ch && !S.session.results[q.id]) {
        S.session.answers[q.id] = parseInt(ch.getAttribute("data-choice"), 10);
        $$(".choice", view).forEach(function (b) { b.classList.remove("is-selected"); });
        ch.classList.add("is-selected");
        var cb = $("[data-check]", view);
        if (cb) { cb.disabled = false; }
        return;
      }
      if (ev.target.closest("[data-check]")) { checkCurrent(false); return; }
      if (ev.target.closest("[data-next]")) { nextQuestion(); return; }
      if (ev.target.closest("[data-play-audio]") || ev.target.closest("[data-replay]")) { playAudio(q); return; }
      if (ev.target.closest("[data-dictation]")) { openDictation(q, S.session.results[q.id]); return; }
      if (ev.target.closest("[data-grammar-note]")) { openGrammar(ev.target.closest("[data-grammar-note]").getAttribute("data-grammar-note"), q); return; }
    });
    view.addEventListener("change", function (ev) {
      if (ev.target.matches("[data-audio-rate]") && player.el) { player.el.playbackRate = parseFloat(ev.target.value) || 1; }
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (CURRENT !== "quiz" || !S.session) { return; }
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT")) { return; }
    var q = currentQuestion();
    if (!q) { return; }
    if (/^[1-4]$/.test(ev.key) && !S.session.results[q.id]) {
      var i = parseInt(ev.key, 10) - 1;
      if (i < q.choices.length) { S.session.answers[q.id] = i; renderQuiz(); }
    } else if (ev.key === "Enter") {
      if (S.session.results[q.id]) { nextQuestion(); } else { checkCurrent(false); }
    }
  });

  /* ------------------------------------------------------------
     채점 · 기록
     ------------------------------------------------------------ */
  function checkCurrent(isTimeout) {
    var s = S.session, q = currentQuestion();
    if (!s || !q || s.results[q.id]) { return; }
    var choice = s.answers[q.id];
    if (choice === undefined) {
      if (!isTimeout) { toast("먼저 답을 골라 주세요."); return; }
      choice = -1;
    }
    clearInterval(S.timer);
    var secs = s.qStart ? Math.max(1, Math.round((Date.now() - s.qStart) / 1000)) : 0;
    var btn = $("[data-check]");
    if (btn) { btn.disabled = true; btn.textContent = "채점 중…"; }

    var p;
    if (q.source === "ai" && q.answer !== undefined) {
      p = Promise.resolve({
        chosen: choice, correct: choice === q.answer, answer: q.answer,
        explanation: q.explanation || "", translation: q.translation || "",
        vocabulary: q.vocabulary || [], passage: q.passage || null,
        evidence_quote: q.evidence_quote || "", paraphrase_pair: q.paraphrase_pair || []
      });
    } else {
      p = api("/api/grade", { answers: [{ id: q.id, choice: choice }] }).then(function (r) {
        if (!r.results || !r.results.length) { throw new Error("채점 결과가 없습니다."); }
        return r.results[0];
      });
    }
    p.then(function (res) {
      res.time_ms = secs * 1000;
      s.results[q.id] = res;
      recordAnswer(q, choice, res);
      renderQuiz();
    }).catch(function (e) {
      toast("채점에 실패했습니다: " + e.message);
      var cb = $("[data-check]");
      if (cb) { cb.disabled = false; cb.textContent = "정답 확인"; }
    });
  }

  function recordAnswer(q, choice, res) {
    var s = S.session;
    D.records.push({
      id: q.id, part: q.part, type: q.type || "", difficulty: q.difficulty || 2,
      choice: choice, correct: !!res.correct, time_ms: res.time_ms || 0,
      at: nowISO(), sid: s.id
    });
    if (!res.correct) {
      var w = D.wrong[q.id] || { id: q.id, part: q.part, type: q.type || "", count: 0, graduated: false };
      w.count += 1; w.lastWrong = nowISO(); w.graduated = false;
      D.wrong[q.id] = w;
    } else if (s.kind === "wrong" && D.wrong[q.id]) {
      D.wrong[q.id].graduated = true; D.wrong[q.id].graduatedAt = nowISO();
    }
    if (!res.correct && res.vocabulary && res.vocabulary.length) {
      res.vocabulary.forEach(function (v) {
        if (!v || !v.word) { return; }
        var k = String(v.word).toLowerCase();
        if (!D.vocab[k]) {
          D.vocab[k] = { word: v.word, meaning: v.meaning || "", example: v.example || "", source: q.id,
            created: nowISO(), status: "new", know: 0, again: 0, seen: 0, correct: 0, wrong: 0 };
        }
      });
    }
    save();
  }

  function nextQuestion() {
    var s = S.session;
    if (!s) { return; }
    stopAudio(); clearInterval(S.timer);
    if (s.idx + 1 >= s.questions.length) { finishSession(); }
    else { s.idx += 1; renderQuiz(); }
  }

  function finishSession() {
    var s = S.session;
    if (!s) { return; }
    stopAudio(); clearInterval(S.timer);
    var answered = Object.keys(s.results).length;
    var correct = 0, perPart = {};
    s.questions.forEach(function (q) {
      var r = s.results[q.id];
      if (!r) { return; }
      if (r.correct) { correct += 1; }
      perPart[q.part] = perPart[q.part] || { n: 0, c: 0 };
      perPart[q.part].n += 1;
      if (r.correct) { perPart[q.part].c += 1; }
    });
    $("#view-quiz").innerHTML = '<div class="card glass summary-hero"><p class="eyebrow">' + esc(s.label) +
      '</p><div class="spinner" aria-hidden="true"></div><p class="muted">점수를 계산하고 있어요…</p></div>';

    api("/api/analyze", { records: slimRecords(), target: D.settings.target }).then(function (r) {
      S.analysis = r.analysis;
      var est = r.analysis.estimate;
      if (est.total != null) { D.history.push({ at: nowISO(), total: est.total, lc: est.lc, rc: est.rc }); }
      D.sessions.unshift({ id: s.id, kind: s.kind, label: s.label, at: nowISO(), answered: answered, correct: correct, lc: est.lc, rc: est.rc, total: est.total });
      save();
      renderSummary(s, answered, correct, r.analysis);
      refreshChip();
    }).catch(function (e) {
      renderSummary(s, answered, correct, null);
      toast("점수 분석을 불러오지 못했습니다: " + e.message);
    });
  }

  function renderSummary(s, answered, correct, analysis) {
    var est = analysis ? analysis.estimate : { lc: null, rc: null, total: null };
    var acc = answered ? Math.round((correct / answered) * 100) : 0;
    var band = analysis && analysis.band ? "예상 범위 " + analysis.band[0] + "~" + analysis.band[1] + "점" : "";
    var weakHtml = (analysis && analysis.weak && analysis.weak.length)
      ? analysis.weak.slice(0, 3).map(function (w) {
        return '<div class="weak-item"><span class="w-name">' + esc(w.type) + "</span>" +
          '<span class="weak-badge">' + w.accuracy + "%</span>" +
          '<span class="w-bar"><i style="width:' + clamp(100 - w.accuracy, 4, 100) + '%"></i></span></div>';
      }).join("")
      : '<p class="muted">기록이 쌓이면 취약 유형을 더 정확히 찾아냅니다.</p>';
    var timing = analysis && analysis.timing ? analysis.timing : null;

    $("#view-quiz").innerHTML = '<div class="card glass summary-hero">' +
      '<p class="eyebrow">' + esc(s.label) + " 완료</p>" +
      '<div class="big">' + (est.total == null ? "-" : est.total) + "</div>" +
      '<p class="band">' + esc(band || "점수를 계산할 수 없습니다") + "</p>" +
      '<div class="result-rows">' +
      "<div><span>정답</span><b>" + correct + " / " + answered + "</b></div>" +
      "<div><span>정답률</span><b>" + acc + "%</b></div>" +
      "<div><span>LC / RC</span><b>" + (est.lc == null ? "-" : est.lc) + " / " + (est.rc == null ? "-" : est.rc) + "</b></div>" +
      "</div>" +
      (timing && timing.avg_sec != null ? '<p class="muted small">평균 풀이 시간 ' + timing.avg_sec + "초 · 30초 초과 " + timing.over_30s + "문항</p>" : "") +
      "</div>" +
      '<div class="card glass"><div class="card-head"><h2>지금 잡을 약점</h2></div>' + weakHtml + "</div>" +
      '<div class="actions">' +
      '<button class="btn primary" data-sum-next>' + (s.kind === "wrong" ? "오답노트로" : "오늘의 추천 더 풀기") + "</button>" +
      '<button id="sumAi" class="btn">🤖 AI 문제 더 풀기</button>' +
      '<button class="btn ghost" data-nav="home">홈으로</button></div>';

    var nb = $("[data-sum-next]");
    if (nb) {
      nb.onclick = function () {
        if (s.kind === "wrong") { S.session = null; nav("wrong"); }
        else { S.session = null; startPractice(null); }
      };
    }
    var aiBtn = $("#sumAi");
    if (aiBtn) {
      aiBtn.onclick = function () {
        S.session = null;
        generateAI({ count: 5 }).then(function (qs) { if (qs.length) { startSession("ai", "AI 약점 공략 문제", qs); } });
      };
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshChip() {
    var total = S.analysis && S.analysis.estimate ? S.analysis.estimate.total : null;
    $("#chipScoreValue").textContent = total == null ? "-" : total;
  }

  function refreshAnalysis(renderHomeToo) {
    if (!D.records.length) {
      S.analysis = null; refreshChip();
      if (renderHomeToo) { renderHome(); }
      return Promise.resolve(null);
    }
    return api("/api/analyze", { records: slimRecords(), target: D.settings.target }).then(function (r) {
      S.analysis = r.analysis; refreshChip();
      if (renderHomeToo) { renderHome(); }
      return r.analysis;
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------
     오답노트
     ------------------------------------------------------------ */
  function renderWrong() {
    var showGrad = $("#showGraduated").checked;
    var rows = Object.keys(D.wrong).map(function (k) { return D.wrong[k]; })
      .filter(function (w) { return showGrad || !w.graduated; })
      .sort(function (a, b) { return String(b.lastWrong).localeCompare(String(a.lastWrong)); });
    var box = $("#wrongList");
    if (!rows.length) {
      box.innerHTML = '<div class="empty glass">아직 오답이 없습니다. 문제를 풀면 틀린 문제가 여기에 쌓입니다.</div>';
      return;
    }
    box.innerHTML = rows.map(function (w) {
      var q = questionById(w.id);
      var prompt = q ? q.prompt : "(문제 데이터를 찾을 수 없음)";
      return '<div class="item"><div class="i-main">' +
        '<div class="i-title">' + esc(String(prompt).slice(0, 90)) + "</div>" +
        '<div class="i-sub">Part ' + w.part + " · " + esc(w.type || "") + " · " + w.count + "회 틀림" +
        (w.graduated ? " · ✅ 졸업" : "") + " · " + dateLabel(w.lastWrong) + "</div></div>" +
        '<div class="i-side">' +
        (q && !w.graduated ? '<button class="btn small primary" data-retry="' + esc(w.id) + '">다시 풀기</button>' : "") +
        (q ? '<button class="btn small ghost" data-wrong-grammar="' + esc(w.id) + '">📖</button>' : "") +
        '<button class="btn small ghost" data-forget="' + esc(w.id) + '" aria-label="삭제">🗑</button>' +
        "</div></div>";
    }).join("");
  }

  /* ------------------------------------------------------------
     문법 강의
     ------------------------------------------------------------ */
  function noteForType(type) {
    if (!S.grammar || !type) { return null; }
    for (var i = 0; i < S.grammar.notes.length; i++) {
      if ((S.grammar.notes[i].types || []).indexOf(type) >= 0) { return S.grammar.notes[i]; }
    }
    return null;
  }
  function noteById(id) {
    if (!S.grammar) { return null; }
    for (var i = 0; i < S.grammar.notes.length; i++) { if (S.grammar.notes[i].id === id) { return S.grammar.notes[i]; } }
    return null;
  }

  function renderGrammar() {
    var box = $("#grammarList");
    if (!S.grammar) { box.innerHTML = '<div class="empty glass">문법 강의를 불러오는 중입니다…</div>'; return; }
    box.innerHTML = S.grammar.notes.map(function (n) {
      return '<div class="card glass grammar-card">' +
        '<div class="card-head"><h3><span class="part-num">' + n.no + "</span> " + esc(n.title) + "</h3></div>" +
        '<p class="muted small">' + esc(n.subtitle) + "</p>" +
        '<ul class="formula-mini">' + n.formula.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>" +
        '<div class="row gap wrap"><button class="btn small primary" data-grammar-open="' + n.id + '">강의 보기</button>' +
        '<button class="btn small ghost" data-grammar-practice="' + n.id + '">관련 문제 풀기</button></div>' +
        "</div>";
    }).join("");
  }

  function openGrammar(id, question) {
    var n = noteById(id);
    if (!n) { return; }
    $("#gramTitle").textContent = "📖 " + n.no + ". " + n.title;
    var html = '<p class="muted small">' + esc(n.subtitle) + "</p>" +
      '<div class="formula-box"><b>3줄 핵심 공식</b><ol>' + n.formula.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ol></div>" +
      '<div class="trap-box"><b>⚠️ 출제 함정 포인트</b><p>' + esc(n.trap) + "</p></div>" +
      '<div class="patterns"><b>대표 기출 패턴</b>' + n.patterns.map(function (p) {
        return '<div class="pattern"><p class="p-en">' + esc(p.en) + "</p><p class=\"p-kr\">" + esc(p.kr) + "</p><p class=\"p-point\">👉 " + esc(p.point) + "</p></div>";
      }).join("") + "</div>" +
      '<div class="row gap wrap" style="margin-top:14px">' +
      '<button class="btn small primary" data-grammar-practice="' + n.id + '">이 문법 관련 문제 풀기</button>' +
      '<button class="btn small" data-grammar-ai="' + n.id + '">🤖 AI에게 더 쉽게 설명 듣기</button></div>' +
      '<div id="gramAiResult" class="ai-result"></div>';
    $("#grammarBody").innerHTML = html;
    $("#modalGrammar").classList.add("is-open");
    S.grammarQuestion = question || null;
  }

  function askGrammarAI(id) {
    var n = noteById(id);
    var key = (D.settings.geminiKey || "").trim();
    var box = $("#gramAiResult");
    if (!n) { return; }
    if (!key) {
      box.innerHTML = '<p class="muted small">설정에서 Gemini API 키를 넣으면 이 문법을 내 수준에 맞게 다시 설명해 드립니다. ' +
        '(키가 없어도 위 강의로 학습할 수 있어요)</p>';
      return;
    }
    box.innerHTML = '<p class="muted small"><span class="spinner"></span> AI가 설명을 준비하고 있어요…</p>';
    api("/api/ai/explain", {
      api_key: key, topic: n.title + " (" + n.subtitle + ")",
      question: S.grammarQuestion ? S.grammarQuestion.prompt : ""
    }).then(function (r) {
      box.innerHTML = '<h4>🤖 AI 쉬운 설명</h4><div class="ai-text">' + esc(r.text).replace(/\n/g, "<br>") + "</div>";
    }).catch(function (e) {
      box.innerHTML = '<p class="muted small">AI 설명을 가져오지 못했습니다: ' + esc(e.message) + "</p>";
    });
  }

  function practiceGrammar(id) {
    var n = noteById(id);
    if (!n) { return; }
    var types = n.types || [];
    var pool = (S.bank ? S.bank.questions : []).filter(function (q) { return types.indexOf(q.type) >= 0; });
    if (!pool.length) { toast("이 문법의 내장 문제가 아직 없습니다. Part 5 문제를 풀어 보세요."); return; }
    var picked = shuffle(pool.slice()).slice(0, Math.min(5, pool.length));
    closeModal();
    startSession("grammar", "문법 집중: " + n.title, picked);
  }

  /* ------------------------------------------------------------
     받아쓰기(딕테이션)
     ------------------------------------------------------------ */
  function openDictation(q, res) {
    var text = (res && res.passage && res.passage.text) || (q.passage && q.passage.text) || "";
    if (!text) { toast("대본이 없어 받아쓰기를 열 수 없습니다."); return; }
    var lines = text.split("\n").filter(function (l) { return l.trim(); });
    var blankCount = 0;
    var html = '<div class="dict-controls">' +
      '<button id="dictPlay" class="btn small primary">▶ 재생</button>' +
      '<select id="dictRate" aria-label="재생 속도"><option value="0.85">0.85x</option><option value="1" selected>1.0x</option><option value="1.15">1.15x</option></select>' +
      '<label class="switch"><input type="checkbox" id="dictLoop" checked><span>무한 반복</span></label>' +
      '<span class="muted small">빈칸을 들으며 직접 입력해 보세요.</span></div>' +
      '<div class="dict-lines">';
    lines.forEach(function (line) {
      var m = line.match(/^(\s*[A-Z]{1,2}\s*[:：]\s*)(.*)$/);
      var speaker = m ? m[1] : "";
      var body = m ? m[2] : line;
      var words = body.split(/(\s+)/);
      var out = "";
      words.forEach(function (token) {
        var core = token.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
        var isWord = /^[A-Za-z']+$/.test(core);
        var pick = isWord && core.length >= 4 && STOPWORDS.indexOf(core.toLowerCase()) < 0 &&
          (blankCount < 8) && (out.length % 3 !== 2 || Math.random() < 0.55);
        if (pick) {
          blankCount += 1;
          var pre = token.slice(0, token.indexOf(core));
          var post = token.slice(token.indexOf(core) + core.length);
          out += esc(pre) + '<input class="dict-input" type="text" autocomplete="off" spellcheck="false" data-answer="' + esc(core) + '" size="' + Math.max(6, core.length) + '" aria-label="빈칸">' + esc(post);
          out += "";
        } else {
          out += esc(token);
        }
      });
      html += '<p class="dict-line">' + esc(speaker) + out + "</p>";
    });
    html += "</div>" +
      '<div class="actions"><button id="dictCheck" class="btn primary">채점</button>' +
      '<button id="dictShow" class="btn small ghost">정답 보기</button></div>' +
      '<div id="dictResult" class="dict-result"></div>';
    $("#dictBody").innerHTML = html;

    var audio = null;
    function stop() { if (audio) { audio.pause(); audio = null; } }
    function start() {
      stop();
      audio = makeAudio();
      audio.loop = $("#dictLoop").checked;
      audio.playbackRate = parseFloat($("#dictRate").value) || 1;
      $("#dictPlay").textContent = "⏸ 정지";
      var direct = q._audioUrl || (q.source === "ai" ? null :
        "/api/audio/" + encodeURIComponent(q.id) + ".mp3?voice=" + encodeURIComponent(D.settings.voice));
      if (direct) {
        audio.src = direct;
        audio.play().catch(function () { speakFallback(q, null); });
        return;
      }
      audioUrlFor(q).then(function (url) {
        audio.src = url;
        return audio.play();
      }).catch(function () { speakFallback(q, null); });
    }
    $("#dictPlay").onclick = function () {
      if (audio) { stop(); $("#dictPlay").textContent = "▶ 재생"; }
      else { start(); }
    };
    $("#dictRate").onchange = function () { if (audio) { audio.playbackRate = parseFloat(this.value) || 1; } };
    $("#dictLoop").onchange = function () { if (audio) { audio.loop = this.checked; } };
    $("#dictShow").onclick = function () {
      $$("#dictBody .dict-input").forEach(function (inp) {
        inp.value = inp.getAttribute("data-answer");
        inp.classList.add("revealed");
      });
    };
    $("#dictCheck").onclick = function () {
      var inputs = $$("#dictBody .dict-input");
      var total = 0, good = 0;
      inputs.forEach(function (inp) {
        var answer = (inp.getAttribute("data-answer") || "").toLowerCase();
        var val = (inp.value || "").trim().toLowerCase().replace(/[^a-z']/g, "");
        total += 1;
        if (val && val === answer.replace(/[^a-z']/g, "")) { good += 1; inp.classList.add("ok"); inp.classList.remove("bad"); }
        else { inp.classList.add("bad"); inp.classList.remove("ok"); }
      });
      $("#dictResult").innerHTML = '<p class="dict-score">' + good + " / " + total + " 정답" +
        (good === total ? " 🎉 완벽해요!" : " — 틀린 빈칸의 정답을 확인해 보세요.") + "</p>";
    };
    $("#modalDict").classList.add("is-open");
  }

  function closeModal() {
    ["#modalShare", "#modalGrammar", "#modalDict"].forEach(function (sel) {
      var m = $(sel); if (m) { m.classList.remove("is-open"); }
    });
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) { } }
    var d = $("#modalDict"); if (d) { var a = $("audio", d); if (a) { a.pause(); } }
  }

  /* ------------------------------------------------------------
     단어장 (암기 → 시험 → 복기)
     ------------------------------------------------------------ */
  function vocabAll() {
    var map = {};
    var setTitles = {};
    if (S.vocabBank) { S.vocabBank.sets.forEach(function (s) { setTitles[s.id] = s.title; }); }
    (S.vocabBank ? S.vocabBank.words : []).forEach(function (w) {
      var k = w.word.toLowerCase();
      map[k] = {
        key: k, word: w.word, pos: w.pos || "", meaning: w.meaning || "",
        example: w.example || "", example_kr: w.example_kr || "",
        set: w.set, setTitle: setTitles[w.set] || "", source: "필수 단어",
        status: "new", know: 0, again: 0, seen: 0, correct: 0, wrong: 0
      };
    });
    Object.keys(D.vocab).forEach(function (k) {
      var p = D.vocab[k] || {};
      var base = map[k] || { key: k, status: "new", know: 0, again: 0, seen: 0, correct: 0, wrong: 0 };
      map[k] = {
        key: k, word: p.word || base.word || k, pos: p.pos || base.pos || "",
        meaning: p.meaning || base.meaning || "", example: p.example || base.example || "",
        example_kr: p.example_kr || base.example_kr || "",
        set: base.set || "", setTitle: base.setTitle || "", source: p.source || base.source || "내 단어",
        status: p.status || base.status || "new", know: p.know || 0, again: p.again || 0,
        seen: p.seen || 0, correct: p.correct || 0, wrong: p.wrong || 0,
        created: p.created || ""
      };
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function vocabByScope(scope) {
    var all = vocabAll();
    if (scope === "confusing") { return all.filter(function (v) { return v.status === "confusing"; }); }
    if (scope === "known") { return all.filter(function (v) { return v.status === "known"; }); }
    if (scope === "my") { return all.filter(function (v) { return !v.set; }); }
    if (scope && scope.indexOf("set:") === 0) {
      var sid = scope.slice(4);
      return all.filter(function (v) { return v.set === sid; });
    }
    return all;
  }

  function setWordStatus(v, status) {
    var k = v.key || String(v.word).toLowerCase();
    var cur = D.vocab[k] || {
      word: v.word, meaning: v.meaning, example: v.example || "", example_kr: v.example_kr || "",
      pos: v.pos || "", source: v.source || "필수 단어", created: nowISO(), know: 0, again: 0, seen: 0, correct: 0, wrong: 0
    };
    cur.status = status;
    if (status === "known") { cur.know = (cur.know || 0) + 1; }
    if (status === "confusing") { cur.again = (cur.again || 0) + 1; }
    cur.lastReview = nowISO();
    D.vocab[k] = cur;
    save();
  }

  function fillScopeSelect(sel, includeExam) {
    if (!sel) { return; }
    var prev = sel.value;
    var html = '<option value="all">전체 필수 단어' + (S.vocabBank ? " (" + S.vocabBank.total + ")" : "") + "</option>";
    if (S.vocabBank) {
      S.vocabBank.sets.forEach(function (s) {
        html += '<option value="set:' + s.id + '">' + esc(s.title) + " (" + s.count + ")</option>";
      });
    }
    html += '<option value="confusing">헷갈리는 단어만</option>';
    if (includeExam) { html += '<option value="my">내가 추가한 단어</option>'; }
    sel.innerHTML = html;
    if (prev) { sel.value = prev; }
    if (!sel.value) { sel.value = "all"; }
  }

  function studyList() {
    var list = vocabByScope($("#studyScope").value);
    if ($("#studyOnlyUnseen") && $("#studyOnlyUnseen").checked) {
      list = list.filter(function (v) { return v.status !== "known"; });
    }
    return list;
  }

  function renderVocab() {
    fillScopeSelect($("#studyScope"), false);
    fillScopeSelect($("#examScope"), true);
    renderStudyCard();
    renderVocabList();
    renderConfusing();
    renderExamHistory();
    var stats = $("#vocabStats");
    if (stats) {
      var all = vocabAll();
      stats.textContent = "내 기록: " + Object.keys(D.vocab).length + "단어 · 외웠음 " +
        all.filter(function (v) { return v.status === "known"; }).length + " · 헷갈림 " +
        all.filter(function (v) { return v.status === "confusing"; }).length;
    }
  }

  function renderStudyCard() {
    var list = studyList();
    var card = $("#flashCard");
    if (!card) { return; }
    if (!list.length) {
      S.flashIdx = 0;
      $("#flashWord").textContent = "-";
      $("#flashMeaning").textContent = "조건에 맞는 단어가 없습니다";
      $("#flashExample").textContent = "범위를 바꾸거나 '아직 안 외운 단어만'을 꺼 보세요.";
      $("#flashExampleKr").textContent = "";
      $("#flashPos").textContent = "";
      $("#flashCount").textContent = "";
      $("#studyStats").textContent = "";
      card.classList.remove("is-flipped");
      return;
    }
    if (S.flashIdx >= list.length) { S.flashIdx = 0; }
    var v = list[S.flashIdx];
    $("#flashWord").textContent = v.word;
    $("#flashPos").textContent = (v.pos || "") + " " + (v.meaning ? "" : "");
    $("#flashMeaning").textContent = v.meaning || "(뜻 없음)";
    $("#flashExample").textContent = v.example || "";
    $("#flashExampleKr").textContent = v.example_kr || "";
    $("#flashSet").textContent = v.setTitle || v.source || "내 단어";
    $("#flashCount").textContent = (S.flashIdx + 1) + " / " + list.length + " · " +
      (v.status === "known" ? "✓ 외웠음" : v.status === "confusing" ? "☆ 헷갈림" : "새 단어");
    $("#studyStats").textContent = list.filter(function (x) { return x.status === "known"; }).length + " / " + list.length + " 외웠음";
    card.classList.remove("is-flipped");
  }

  function renderVocabList() {
    var list = vocabAll().filter(function (v) { return D.vocab[v.key]; })
      .sort(function (a, b) { return String(b.created || "").localeCompare(String(a.created || "")); });
    $("#vocabTotal").textContent = list.length + "개";
    $("#vocabList").innerHTML = list.length ? list.map(function (v) {
      return '<div class="item"><div class="i-main"><div class="i-title">' + esc(v.word) +
        ' <span class="muted small">' + esc(v.meaning) + "</span>" +
        (v.status === "known" ? ' <span class="badge ok">외웠음</span>' : v.status === "confusing" ? ' <span class="badge warn">헷갈림</span>' : "") +
        "</div><div class=\"i-sub\">" + esc(v.source || "") + (v.example ? " · " + esc(v.example) : "") + "</div></div>" +
        '<div class="i-side"><button class="btn small ghost" data-say="' + esc(v.word) + '" aria-label="발음">🔊</button>' +
        '<button class="btn small ghost" data-vocab-del="' + esc(v.key) + '" aria-label="삭제">🗑</button></div></div>';
    }).join("") : '<div class="empty">아직 저장된 단어가 없습니다. 필수 단어를 외우면 여기에 기록됩니다.</div>';
  }

  function renderConfusing() {
    var list = vocabAll().filter(function (v) { return v.status === "confusing"; });
    var box = $("#confusingList");
    if (!box) { return; }
    box.innerHTML = list.length ? list.map(function (v) {
      return '<div class="item"><div class="i-main"><div class="i-title">' + esc(v.word) +
        ' <span class="muted small">' + esc(v.meaning) + "</span></div>" +
        '<div class="i-sub">' + esc(v.example || "") + "</div></div>" +
        '<div class="i-side"><button class="btn small ghost" data-say="' + esc(v.word) + '">🔊</button>' +
        '<button class="btn small" data-known="' + esc(v.key) + '">외웠음</button></div></div>';
    }).join("") : '<div class="empty">헷갈리는 단어가 없습니다. 시험에서 틀린 단어가 자동으로 모입니다.</div>';
  }

  function renderExamHistory() {
    var box = $("#examHistory");
    if (!box) { return; }
    if (!D.vocabExams.length) {
      box.innerHTML = '<div class="empty">아직 시험 기록이 없습니다.</div>';
      $("#examHistoryCount").textContent = "";
      return;
    }
    $("#examHistoryCount").textContent = D.vocabExams.length + "회";
    box.innerHTML = D.vocabExams.slice(0, 8).map(function (e, i) {
      return '<div class="item"><div class="i-main"><div class="i-title">' + e.correct + " / " + e.total +
        " (" + Math.round((e.correct / Math.max(1, e.total)) * 100) + "%)</div>" +
        '<div class="i-sub">' + dateLabel(e.at) + " · " + esc(e.scopeLabel || e.scope) + " · " + esc(e.typeLabel || e.type) + "</div></div>" +
        '<div class="i-side">' + (e.wrong && e.wrong.length
          ? '<button class="btn small primary" data-exam-retry="' + i + '">틀린 단어 다시</button>' : "") + "</div></div>";
    }).join("");
  }

  /* --- 단어 시험 --- */
  function makeExamQuestion(word, pool, type) {
    var kind = type;
    if (type === "mix") { kind = Math.random() < 0.5 ? "meaning" : "blank"; }
    if (kind === "blank" && !word.example) { kind = "meaning"; }
    var options, answerText, prompt, sub;
    var others = pool.filter(function (v) { return v.key !== word.key && v.meaning && v.meaning !== word.meaning; });
    if (kind === "meaning") {
      prompt = word.word;
      sub = word.pos ? word.pos : "";
      answerText = word.meaning;
      options = [answerText].concat(shuffle(others.slice()).slice(0, 3).map(function (v) { return v.meaning; }));
    } else {
      prompt = blankExample(word);
      sub = "빈칸에 알맞은 단어를 고르세요";
      answerText = word.word;
      var words = shuffle(others.slice()).slice(0, 3).map(function (v) { return v.word; });
      options = [answerText].concat(words);
    }
    if (!options || options.length < 4) { return null; }
    options = shuffle(options.slice(0, 4));
    return {
      kind: kind, word: word, prompt: prompt, sub: sub,
      options: options, answer: options.indexOf(answerText),
      example: word.example, exampleKr: word.example_kr, meaning: word.meaning
    };
  }

  function blankExample(word) {
    var w = word.word;
    var base = w.toLowerCase().endsWith("y") ? escapeRe(w.slice(0, -1)) + "(?:y|ies)" : escapeRe(w);
    var re = new RegExp("\\b" + base + "(?:s|es|ed|d|ing)?\\b", "i");
    if (re.test(word.example)) { return word.example.replace(re, "_____"); }
    return word.example;
  }

  function startExam(opts) {
    var o = opts || {};
    var scope = o.scope || ($("#examScope") ? $("#examScope").value : "all");
    var count = o.count || (parseInt($("#examCount") ? $("#examCount").value : "10", 10) || 10);
    var type = o.type || ($("#examType") ? $("#examType").value : "mix");
    var pool = o.words && o.words.length ? o.words.slice() : q_pool(scope);
    if (pool.length < 1) { toast("시험을 보려면 단어가 필요합니다."); return; }
    var distractorPool = q_pool("all");
    if (distractorPool.length < 4) { distractorPool = q_pool(scope); }
    if (distractorPool.length < 4) { toast("시험을 보려면 단어가 4개 이상 필요합니다."); return; }
    var picked = shuffle(pool.slice()).slice(0, Math.min(count, pool.length));
    var questions = [];
    picked.forEach(function (w) {
      var q = makeExamQuestion(w, distractorPool, type);
      if (q) { questions.push(q); }
    });
    if (!questions.length) { toast("문제를 만들지 못했습니다."); return; }
    S.exam = {
      questions: questions, idx: 0, answers: {}, scope: scope, type: type,
      scopeLabel: (($("#examScope") && $("#examScope").selectedOptions[0]) ? $("#examScope").selectedOptions[0].textContent : "선택 단어"),
      typeLabel: { mix: "섞어서", meaning: "단어→뜻", blank: "빈칸→단어" }[type] || type,
      startedAt: nowISO()
    };
    var setup = $("#examSetup");
    if (setup) { setup.classList.add("hidden"); }
    renderExam();
  }

  function q_pool(scope) {
    var pool = vocabByScope(scope).filter(function (v) { return v.meaning; });
    if (pool.length < 4) {
      var all = vocabAll().filter(function (v) { return v.meaning; });
      if (all.length >= 4) { pool = all; }
    }
    return pool;
  }

  function renderExam() {
    var box = $("#examBody");
    if (!box) { return; }
    if (!S.exam) {
      box.innerHTML = "";
      var setup = $("#examSetup");
      if (setup) { setup.classList.remove("hidden"); }
      return;
    }
    var e = S.exam;
    var q = e.questions[e.idx];
    var answered = e.answers[e.idx];
    var pct = Math.round((e.idx / e.questions.length) * 100);
    var html = '<div class="quiz-top"><button class="btn small ghost" data-exam-exit>← 나가기</button>' +
      '<div class="quiz-progress"><i style="width:' + pct + '%"></i></div>' +
      '<span class="quiz-count">' + (e.idx + 1) + " / " + e.questions.length + "</span></div>" +
      '<article class="qcard glass">' +
      '<div class="qmeta"><span class="tag">단어 시험</span><span class="tag type">' +
      (q.kind === "meaning" ? "영단어 → 뜻" : "예문 빈칸 → 단어") + "</span></div>" +
      '<p class="exam-prompt">' + (q.kind === "meaning" ? esc(q.prompt) : esc(q.prompt)) + "</p>" +
      (q.kind === "meaning" && q.sub ? '<p class="muted small">' + esc(q.sub) + "</p>" : '<p class="muted small">' + esc(q.sub) + "</p>") +
      '<div class="choices">' + q.options.map(function (opt, i) {
        return '<button type="button" class="choice' + (answered === i ? " is-selected" : "") + '" data-exam-choice="' + i + '">' +
          '<span class="key">' + String.fromCharCode(65 + i) + '</span><span class="c-text">' + esc(opt) + "</span></button>";
      }).join("") + "</div>" +
      '<div class="actions">' +
      '<button class="btn" data-exam-prev' + (e.idx === 0 ? " disabled" : "") + ">← 이전</button>" +
      '<button class="btn primary" data-exam-next>' + (e.idx + 1 >= e.questions.length ? "채점하기" : "다음 →") + "</button>" +
      "</div></article>";
    box.innerHTML = html;
  }

  function finishExam() {
    var e = S.exam;
    if (!e) { return; }
    var correct = 0, wrong = [];
    e.questions.forEach(function (q, i) {
      var chosen = e.answers[i];
      if (chosen === q.answer) { correct += 1; }
      else {
        wrong.push({
          word: q.word.word, key: q.word.key, meaning: q.meaning || q.word.meaning,
          chosenText: chosen === undefined ? "(응답 없음)" : q.options[chosen],
          answerText: q.options[q.answer], example: q.example || q.word.example || "",
          kind: q.kind
        });
      }
      // 단어별 학습 통계
      var k = q.word.key;
      var rec = D.vocab[k] || {
        word: q.word.word, meaning: q.word.meaning, example: q.word.example || "",
        example_kr: q.word.example_kr || "", pos: q.word.pos || "", source: q.word.source || "필수 단어",
        created: nowISO(), know: 0, again: 0, seen: 0, correct: 0, wrong: 0
      };
      rec.seen = (rec.seen || 0) + 1;
      if (chosen === q.answer) { rec.correct = (rec.correct || 0) + 1; }
      else {
        rec.wrong = (rec.wrong || 0) + 1;
        rec.status = "confusing";
      }
      rec.lastReview = nowISO();
      D.vocab[k] = rec;
    });
    D.vocabExams.unshift({
      at: nowISO(), scope: e.scope, scopeLabel: e.scopeLabel, type: e.type, typeLabel: e.typeLabel,
      total: e.questions.length, correct: correct, wrong: wrong
    });
    save();
    var pct = Math.round((correct / e.questions.length) * 100);
    var wrongHtml = wrong.length ? wrong.map(function (w, i) {
      return '<div class="item"><div class="i-main">' +
        '<div class="i-title">' + esc(w.word) + ' <span class="muted small">' + esc(w.meaning) + "</span></div>" +
        '<div class="i-sub">내 답: <b class="fb-wrong">' + esc(w.chosenText) + "</b> · 정답: <b class=\"fb-correct\">" + esc(w.answerText) + "</b></div>" +
        '<div class="i-sub">' + esc(w.example) + "</div></div>" +
        '<div class="i-side"><button class="btn small ghost" data-say="' + esc(w.word) + '">🔊</button>' +
        '<button class="btn small ghost" data-exam-star="' + i + '">☆ 헷갈림</button></div></div>';
    }).join("") : '<div class="empty">틀린 단어가 없습니다. 완벽해요! 🎉</div>';

    $("#examBody").innerHTML = '<div class="card glass summary-hero">' +
      '<p class="eyebrow">' + esc(e.scopeLabel) + " · " + esc(e.typeLabel) + "</p>" +
      '<div class="big">' + correct + " / " + e.questions.length + "</div>" +
      '<p class="band">정답률 ' + pct + "%" + (pct === 100 ? " · 단어 마스터! 🌊" : "") + "</p></div>" +
      '<div class="card glass"><div class="card-head"><h2>틀린 단어 복기</h2><span class="muted small">자동으로 헷갈림 단어장에 저장됩니다</span></div>' +
      '<div class="list compact">' + wrongHtml + "</div></div>" +
      '<div class="actions">' +
      (wrong.length ? '<button class="btn primary" data-retry-wrong>틀린 단어만 다시 시험</button>' : "") +
      (wrong.length ? '<button class="btn" data-save-confusing>헷갈림 단어장에 저장</button>' : "") +
      '<button class="btn ghost" data-new-exam>새 시험</button></div>';
    e.finished = true;
    e.wrong = wrong;
  }

  /* ------------------------------------------------------------
     리포트
     ------------------------------------------------------------ */
  function renderReport() {
    var a = S.analysis;
    var est = a ? a.estimate : { total: null, lc: null, rc: null };
    $("#reportBand").textContent = a && a.band ? ("예상 " + a.band[0] + "~" + a.band[1] + "점 · " + (a.level || "")) : "";
    var pts = D.history.map(function (h) { return { label: dateLabel(h.at), value: h.total }; });
    $("#reportHistory").innerHTML = lineChart(pts, { height: 220 });

    var parts = a ? a.parts : [];
    $("#reportParts").innerHTML = parts.map(function (p) {
      var t = p.timing || {};
      return '<div class="bar-row"><span class="b-label">Part ' + p.part + " " + esc(p.title) + "</span>" +
        '<span class="b-track"><i style="width:' + (p.accuracy == null ? 0 : p.accuracy) + '%"></i></span>' +
        '<span class="b-val">' + (p.accuracy == null ? "-" : p.accuracy + "%") +
        (t.avg_sec != null ? '<br><small>' + t.avg_sec + "초</small>" : "") + "</span></div>";
    }).join("");

    var t = a && a.timing ? a.timing : null;
    $("#reportTiming").innerHTML = t ? [
      ["평균 풀이 시간", t.avg_sec == null ? "-" : t.avg_sec + "초"],
      ["시간 기록 문항", t.timed + "문항"],
      ["30초 초과 문항", t.over_30s + "문항"],
      ["맞혔지만 30초 초과", t.slow_correct + "문항"]
    ].map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("")
      : '<p class="muted">문제를 풀면 풀이 시간이 기록됩니다.</p>';

    var slow = (a && a.slow_items) ? a.slow_items : [];
    $("#reportSlow").innerHTML = slow.length ? slow.slice(-8).reverse().map(function (id) {
      var q = questionById(id);
      return '<div class="item"><div class="i-main"><div class="i-title">' + esc(q ? String(q.prompt).slice(0, 70) : id) + "</div>" +
        '<div class="i-sub">Part ' + (q ? q.part : "-") + " · " + esc(q ? q.type : "") + " · 시간 단축 훈련 권장</div></div>" +
        '<div class="i-side">' + (q ? '<button class="btn small ghost" data-practice-slow="' + esc(id) + '">바로 풀기</button>' : "") + "</div></div>";
    }).join("") : '<div class="empty">아직 30초를 넘긴 정답이 없습니다. 좋아요!</div>';

    var types = a ? a.types : [];
    if (!types.length) {
      $("#reportTypes").innerHTML = '<div class="empty">진단 테스트를 마치면 유형별 분석이 나타납니다.</div>';
    } else {
      $("#reportTypes").innerHTML = '<table class="tbl"><thead><tr><th>세부 유형</th><th>파트</th><th>푼 문항</th><th>정답</th><th>정답률</th><th>평균 시간</th><th>약점</th></tr></thead><tbody>' +
        types.slice(0, 20).map(function (x) {
          var avg = x.timing && x.timing.avg_sec != null ? x.timing.avg_sec + "초" : "-";
          return "<tr><td>" + esc(x.type) + "</td><td>" + x.part + "</td><td class='num'>" + x.attempted +
            "</td><td class='num'>" + x.correct + "</td><td>" + accBar(x.accuracy) +
            "</td><td class='num'>" + avg + "</td><td class='num'>" + x.weakness + "</td></tr>";
        }).join("") + "</tbody></table>";
    }

    $("#reportSessionCount").textContent = D.sessions.length ? D.sessions.length + "회" : "";
    $("#reportSessions").innerHTML = D.sessions.length ? D.sessions.slice(0, 12).map(function (s) {
      return '<div class="item"><div class="i-main"><div class="i-title">' + esc(s.label) + "</div>" +
        '<div class="i-sub">' + s.answered + "문항 · 정답 " + s.correct + " · " + dateLabel(s.at) + "</div></div>" +
        '<div class="i-side"><b>' + (s.total == null ? "-" : s.total) + "</b></div></div>";
    }).join("") : '<div class="empty">아직 학습 기록이 없습니다.</div>';
  }

  /* ------------------------------------------------------------
     설정 · 공유 · 백업
     ------------------------------------------------------------ */
  function renderSettings() {
    if ($("#setTarget")) { $("#setTarget").value = D.settings.target; }
    if ($("#setVoice")) { $("#setVoice").value = D.settings.voice; }
    if ($("#setTimeAttack")) { $("#setTimeAttack").checked = !!D.settings.timeAttack; }
    if ($("#setKey")) { $("#setKey").value = D.settings.geminiKey || ""; }
    var ks = $("#keyStatus");
    if (ks) {
      ks.textContent = D.settings.geminiKey
        ? "키가 이 브라우저에만 저장되어 있습니다. 서버에는 저장되지 않습니다."
        : "키를 넣지 않아도 내장 문제은행·단어·문법 강의로 학습할 수 있습니다.";
    }
    renderConnect();
    renderAppInfo();
    var bs = $("#backupStatus");
    if (bs) {
      bs.textContent = "현재 기록: " + D.records.length + "문항 · 오답 " + Object.keys(D.wrong).length +
        "개 · 내 단어 " + Object.keys(D.vocab).length + "개 · 시험 " + D.vocabExams.length + "회";
    }
  }

  function renderAppInfo() {
    var box = $("#appInfo");
    if (!box) { return; }
    var h = S.health || {};
    var rows = [
      ["앱", "🌊 바다토익 (BADA TOEIC) v" + (h.version || "1.0.0")],
      ["서버 모드", h.mode === "cloud" ? "클라우드 (24시간 접속)" : "내 PC 로컬"],
      ["내장 문제은행", (S.bank ? S.bank.total : h.bank_total || 0) + "문항 (Part 1~7)"],
      ["필수 단어", (S.vocabBank ? S.vocabBank.total : h.vocab_total || 0) + "단어 · 13세트"],
      ["문법 강의", (S.grammar ? S.grammar.total : h.grammar_total || 0) + "강"],
      ["LC 음성", h.tts ? "edge-tts 신경망 음성 사용 가능" : "서버 음성 불가 → 브라우저 음성 모드"],
      ["학습 기록", "이 브라우저 localStorage에만 저장 (" + D.records.length + "문항)"],
      ["저장 키", KEY]
    ];
    box.innerHTML = rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
  }

  function renderConnect() {
    var box = $("#connectBox");
    if (!box) { return; }
    var origin = window.location.origin;
    box.innerHTML = '<p class="muted small">아래 QR을 폰 카메라로 찍으면 지금 이 학습 앱이 그대로 열립니다.</p>' +
      "<p><code>" + esc(origin) + "</code></p>" +
      '<div class="row gap wrap"><button id="connectQr" class="btn small primary">QR 보기</button>' +
      '<button id="connectCopy" class="btn small">주소 복사</button></div>';
    $("#connectQr").onclick = openShare;
    $("#connectCopy").onclick = function () { copyText(origin); };
    api("/api/connect").then(function (r) {
      if (r.mode === "local" && r.urls && r.urls.length) {
        box.innerHTML += '<div class="share-lan"><b>같은 와이파이의 폰에서 접속</b><br>' +
          r.urls.map(function (u) { return '<button class="btn small ghost" data-lan="' + esc(u) + '">' + esc(u) + " 주소 복사</button>"; }).join("") +
          "<span class='small'>PC에서 실행 중일 때는 폰과 같은 와이파이에 연결되어 있어야 합니다.</span></div>";
      }
    }).catch(function () { });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("복사했습니다."); },
        function () { toast("복사에 실패했습니다. 주소를 길게 눌러 복사해 주세요."); });
    } else { toast("주소를 길게 눌러 복사해 주세요."); }
  }

  function openShare() {
    var modal = $("#modalShare");
    var url = window.location.origin + window.location.pathname;
    S.shareUrl = url;
    try {
      $("#shareQr").innerHTML = window.BadaQR ? window.BadaQR.svg(url, { scale: 6, border: 3 }) : "";
    } catch (e) { $("#shareQr").innerHTML = '<p class="small">QR을 만들지 못했습니다.</p>'; }
    $("#shareUrl").textContent = url;
    modal.classList.add("is-open");
    var lanBox = $("#shareLan");
    lanBox.innerHTML = "";
    api("/api/connect").then(function (r) {
      var cloud = r.mode === "cloud";
      lanBox.innerHTML = cloud
        ? "<p>☁️ 클라우드 모드: PC가 꺼져 있어도 이 주소로 언제든 접속됩니다. 친구에게 QR을 보여 주세요.</p>"
        : "<p>💻 로컬 모드: 같은 와이파이의 폰에서 아래 주소로 접속하세요. (PC가 켜져 있어야 합니다)</p>";
      (r.urls || []).forEach(function (u) {
        var b = document.createElement("button");
        b.className = "btn small ghost";
        b.textContent = u + " 주소 복사";
        b.onclick = function () { copyText(u); };
        lanBox.appendChild(b);
      });
      if (!cloud && r.urls && r.urls.length) {
        var use = document.createElement("button");
        use.className = "btn small";
        use.textContent = "이 주소로 QR 바꾸기";
        use.onclick = function () {
          S.shareUrl = r.urls[0];
          $("#shareQr").innerHTML = window.BadaQR.svg(r.urls[0], { scale: 6, border: 3 });
          $("#shareUrl").textContent = r.urls[0];
        };
        lanBox.appendChild(use);
      }
    }).catch(function () { });
  }

  function exportData() {
    var payload = { app: "bada-toeic", version: 1, exportedAt: nowISO(), data: D };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "바다토익_학습기록_" + todayLabel() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast("학습 기록을 내보냈습니다. 폰에서 '불러오기'로 이어서 쓰세요.");
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var raw = JSON.parse(String(reader.result));
        var data = raw && raw.data ? raw.data : raw;
        if (!data || !Array.isArray(data.records)) { throw new Error("바다토익 기록 파일이 아닙니다."); }
        if (!confirm("지금 기록 대신 불러온 기록으로 바꿉니다. 계속할까요?")) { return; }
        D = normalize(data);
        save(); rebuildGenIndex(); S.flashIdx = 0;
        toast("학습 기록을 불러왔습니다. (" + D.records.length + "문항)");
        refreshAnalysis(true); renderSettings(); nav("home");
      } catch (e) { toast("불러오기 실패: " + e.message); }
    };
    reader.readAsText(file, "utf-8");
  }

  function resetData() {
    if (!confirm("학습 기록·오답노트·단어장·시험 이력이 모두 삭제됩니다. 되돌릴 수 없습니다. 계속할까요?")) { return; }
    if (!confirm("정말 초기화할까요? 필요하면 먼저 '내보내기'로 백업하세요.")) { return; }
    var keepKey = D.settings.geminiKey;
    D = defaultStore();
    D.settings.geminiKey = keepKey;
    save(); S.analysis = null; S.session = null; S.exam = null;
    rebuildGenIndex();
    toast("학습 기록을 초기화했습니다.");
    nav("home");
  }

  /* ------------------------------------------------------------
     이벤트
     ------------------------------------------------------------ */
  function bindGlobal() {
    bindQuizEvents();

    document.addEventListener("click", function (ev) {
      var t = ev.target;

      /* 홈/파트 */
      if (t.closest("#btnStartDiag")) { startDiagnostic(); return; }
      if (t.closest("#btnStartDaily")) { startPractice(null); return; }
      if (t.closest("#btnAiWeak")) { startAI(); return; }
      if (t.closest("[data-start-part]")) { startPractice(parseInt(t.closest("[data-start-part]").getAttribute("data-start-part"), 10)); return; }

      /* 오답 */
      if (t.closest("#btnRetryWrong")) { startWrongRetry(); return; }
      if (t.closest("[data-retry]")) {
        var q = questionById(t.closest("[data-retry]").getAttribute("data-retry"));
        if (q) { startSession("wrong", "오답 다시 풀기", [q]); }
        return;
      }
      if (t.closest("[data-wrong-grammar]")) {
        var wq = questionById(t.closest("[data-wrong-grammar]").getAttribute("data-wrong-grammar"));
        if (wq) {
          var note = noteForType(wq.type);
          if (note) { openGrammar(note.id, wq); } else { toast("이 유형의 문법 강의는 아직 없습니다."); }
        }
        return;
      }
      if (t.closest("[data-forget]")) {
        delete D.wrong[t.closest("[data-forget]").getAttribute("data-forget")];
        save(); renderWrong(); return;
      }

      /* 단어 — 암기 */
      if (t.closest("#flashCard")) { $("#flashCard").classList.toggle("is-flipped"); return; }
      if (t.closest("#flashPronounce")) {
        var cur = studyList()[S.flashIdx];
        if (cur) { pronounce(cur.word); }
        return;
      }
      if (t.closest("#flashStar") || t.closest("#flashKnow")) {
        var list = studyList();
        var v = list[S.flashIdx];
        if (v) {
          setWordStatus(v, t.closest("#flashKnow") ? "known" : "confusing");
          toast(t.closest("#flashKnow") ? "✓ 외웠음으로 표시했습니다." : "☆ 헷갈림 단어장에 담았습니다.");
          if (t.closest("#flashKnow")) {
            S.flashIdx = Math.min(S.flashIdx, Math.max(0, studyList().length - 1));
          }
          renderVocab();
        }
        return;
      }
      if (t.closest("#flashNext")) { S.flashIdx += 1; renderStudyCard(); return; }
      if (t.closest("#flashPrev")) { S.flashIdx = Math.max(0, S.flashIdx - 1); renderStudyCard(); return; }

      /* 단어 — 시험 */
      if (t.closest("#btnStartExam")) { startExam({}); return; }
      if (t.closest("#btnExamConfusing")) {
        var conf = vocabAll().filter(function (x) { return x.status === "confusing"; });
        if (conf.length < 4) { toast("헷갈림 단어가 4개 이상이어야 시험을 볼 수 있습니다."); return; }
        startExam({ scope: "confusing", count: Math.min(20, conf.length), type: "mix" });
        return;
      }
      if (t.closest("[data-exam-choice]") && S.exam) {
        S.exam.answers[S.exam.idx] = parseInt(t.closest("[data-exam-choice]").getAttribute("data-exam-choice"), 10);
        renderExam();
        return;
      }
      if (t.closest("[data-exam-prev]") && S.exam) { S.exam.idx = Math.max(0, S.exam.idx - 1); renderExam(); return; }
      if (t.closest("[data-exam-next]") && S.exam) {
        if (S.exam.idx + 1 >= S.exam.questions.length) { finishExam(); }
        else { S.exam.idx += 1; renderExam(); }
        return;
      }
      if (t.closest("[data-exam-exit]")) {
        S.exam = null;
        if ($("#examSetup")) { $("#examSetup").classList.remove("hidden"); }
        renderExam();
        return;
      }
      if (t.closest("[data-retry-wrong]") && S.exam) {
        var wl = S.exam.wrong || [];
        var words = wl.map(function (w) {
          return vocabAll().filter(function (v) { return v.key === w.key; })[0];
        }).filter(Boolean);
        if (words.length) { startExam({ scope: "all", words: words, count: words.length, type: S.exam.type === "blank" ? "blank" : "meaning" }); }
        return;
      }
      if (t.closest("[data-save-confusing]") && S.exam) {
        (S.exam.wrong || []).forEach(function (w) {
          var v = vocabAll().filter(function (x) { return x.key === w.key; })[0];
          if (v) { setWordStatus(v, "confusing"); }
        });
        toast("틀린 단어를 헷갈림 단어장에 저장했습니다.");
        return;
      }
      if (t.closest("[data-new-exam]")) {
        S.exam = null;
        if ($("#examSetup")) { $("#examSetup").classList.remove("hidden"); }
        renderExam(); renderVocab();
        return;
      }
      if (t.closest("[data-exam-retry]")) {
        var idx = parseInt(t.closest("[data-exam-retry]").getAttribute("data-exam-retry"), 10);
        var exam = D.vocabExams[idx];
        if (exam && exam.wrong && exam.wrong.length) {
          var ws = exam.wrong.map(function (w) {
            return vocabAll().filter(function (v) { return v.key === w.key; })[0];
          }).filter(Boolean);
          if (ws.length) { startExam({ scope: "all", words: ws, count: ws.length, type: "meaning" }); }
        }
        return;
      }
      if (t.closest("[data-exam-star]") && S.exam) {
        var si = parseInt(t.closest("[data-exam-star]").getAttribute("data-exam-star"), 10);
        var sw = (S.exam.wrong || [])[si];
        if (sw) {
          var sv = vocabAll().filter(function (v) { return v.key === sw.key; })[0];
          if (sv) { setWordStatus(sv, "confusing"); }
          toast("헷갈림 단어장에 담았습니다.");
        }
        return;
      }

      /* 단어 — 복기/기타 */
      if (t.closest("[data-say]")) { pronounce(t.closest("[data-say]").getAttribute("data-say")); return; }
      if (t.closest("[data-known]")) {
        var kv = vocabAll().filter(function (v) { return v.key === t.closest("[data-known]").getAttribute("data-known"); })[0];
        if (kv) { setWordStatus(kv, "known"); renderVocab(); toast("✓ 외웠음으로 옮겼습니다."); }
        return;
      }
      if (t.closest("[data-vocab-del]")) {
        delete D.vocab[t.closest("[data-vocab-del]").getAttribute("data-vocab-del")];
        save(); renderVocab(); return;
      }
      if (t.closest("[data-vtab]")) {
        var tab = t.closest("[data-vtab]").getAttribute("data-vtab");
        $$(".seg").forEach(function (b) { b.classList.toggle("is-active", b === t.closest("[data-vtab]")); b.setAttribute("aria-selected", b === t.closest("[data-vtab]") ? "true" : "false"); });
        $$(".vpanel").forEach(function (p) { p.classList.toggle("is-active", p.getAttribute("data-vpanel") === tab); });
        if (tab === "review") { renderConfusing(); renderExamHistory(); renderVocabList(); }
        return;
      }

      /* 문법 */
      if (t.closest("[data-grammar-open]")) { openGrammar(t.closest("[data-grammar-open]").getAttribute("data-grammar-open")); return; }
      if (t.closest("[data-grammar-practice]")) { practiceGrammar(t.closest("[data-grammar-practice]").getAttribute("data-grammar-practice")); return; }
      if (t.closest("[data-grammar-ai]")) { askGrammarAI(t.closest("[data-grammar-ai]").getAttribute("data-grammar-ai")); return; }
      if (t.closest("[data-close-modal]")) { closeModal(); return; }
      if (t.id === "modalShare" || t.id === "modalGrammar" || t.id === "modalDict") { closeModal(); return; }

      /* 느린 정답 바로 풀기 */
      if (t.closest("[data-practice-slow]")) {
        var pq = questionById(t.closest("[data-practice-slow]").getAttribute("data-practice-slow"));
        if (pq) { startSession("slow", "시간 단축 연습", [pq]); }
        return;
      }

      /* 설정 */
      if (t.closest("#btnSaveSettings")) {
        D.settings.target = clamp(parseInt($("#setTarget").value, 10) || 800, 400, 990);
        D.settings.voice = $("#setVoice").value;
        D.settings.geminiKey = $("#setKey").value.trim();
        D.settings.timeAttack = $("#setTimeAttack").checked;
        save();
        toast("설정을 저장했습니다. 목표 " + D.settings.target + "점");
        refreshAnalysis(true); renderSettings();
        return;
      }
      if (t.closest("#btnTestKey")) {
        var key = $("#setKey").value.trim();
        if (!key) { toast("키를 입력해 주세요."); return; }
        var st = $("#keyStatus");
        st.textContent = "키를 확인하고 있어요…";
        api("/api/ai/test", { api_key: key }).then(function (r) {
          st.textContent = "✅ 사용 가능한 키입니다. 예: " + (r.info.models || []).slice(0, 3).join(", ");
          toast("Gemini 키가 정상입니다.");
        }).catch(function (e) { st.textContent = "❌ " + e.message; });
        return;
      }
      if (t.closest("#btnClearKey")) {
        D.settings.geminiKey = ""; save(); $("#setKey").value = "";
        $("#keyStatus").textContent = "키를 삭제했습니다."; toast("Gemini 키를 삭제했습니다.");
        return;
      }
      if (t.closest("#btnExport")) { exportData(); return; }
      if (t.closest("#btnReset")) { resetData(); return; }
      if (t.closest("#shareBtn")) { openShare(); return; }
      if (t.closest("#shareClose")) { closeModal(); return; }
      if (t.closest("#shareCopy")) { copyText(S.shareUrl || window.location.href); return; }
      if (t.closest("#shareNative")) {
        if (navigator.share) {
          navigator.share({ title: "바다토익", text: "같이 토익 공부해요 🌊", url: S.shareUrl || window.location.href }).catch(function () { });
        } else { copyText(S.shareUrl || window.location.href); }
        return;
      }
      if (t.closest("[data-lan]")) { copyText(t.closest("[data-lan]").getAttribute("data-lan")); return; }
    });

    var imp = $("#fileImport");
    if (imp) {
      imp.addEventListener("change", function (ev) {
        var f = ev.target.files && ev.target.files[0];
        if (f) { importData(f); }
        ev.target.value = "";
      });
    }
    var sg = $("#showGraduated");
    if (sg) { sg.addEventListener("change", renderWrong); }
    var ta = $("#timeAttack");
    if (ta) {
      ta.addEventListener("change", function () {
        D.settings.timeAttack = ta.checked; save();
        toast(ta.checked ? "타임어택을 켰습니다. Part 5는 20초, Part 6은 30초입니다." : "타임어택을 껐습니다.");
      });
    }
    var ss = $("#studyScope");
    if (ss) { ss.addEventListener("change", function () { S.flashIdx = 0; renderStudyCard(); }); }
    var su = $("#studyOnlyUnseen");
    if (su) { su.addEventListener("change", function () { S.flashIdx = 0; renderStudyCard(); }); }

    var vf = $("#vocabForm");
    if (vf) {
      vf.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var w = $("#vocabWord").value.trim();
        var m = $("#vocabMeaning").value.trim();
        if (!w || !m) { toast("단어와 뜻을 모두 입력해 주세요."); return; }
        var k = w.toLowerCase();
        D.vocab[k] = D.vocab[k] || { word: w, meaning: m, example: "", source: "직접 추가", created: nowISO(), status: "new", know: 0, again: 0, seen: 0, correct: 0, wrong: 0 };
        D.vocab[k].meaning = m;
        save();
        $("#vocabWord").value = ""; $("#vocabMeaning").value = "";
        renderVocab(); toast("단어를 추가했습니다.");
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { closeModal(); }
    });
  }

  /* ------------------------------------------------------------
     스플래시 인트로
     ------------------------------------------------------------ */
  function initSplash() {
    var sp = $("#splash");
    if (!sp) { return; }
    var seen = false;
    try { seen = sessionStorage.getItem("badaSplashShown") === "1"; } catch (e) { seen = false; }
    if (seen) {
      if (sp.parentNode) { sp.parentNode.removeChild(sp); }
      return;
    }
    document.body.classList.add("is-splashing");
    var ctrl = null;
    var canvas = $("#splashCanvas");
    if (canvas && window.BadaSplash) {
      try { ctrl = window.BadaSplash.mount(canvas, { duration: 2000 }); } catch (e) { ctrl = null; }
    }
    if (!ctrl) {
      // WebGL 스크립트를 못 불러온 경우에도 어두운 바다 배경으로 안전하게 표시
      sp.style.background = "radial-gradient(900px 600px at 50% 12%, rgba(56,182,255,.22), transparent 62%)," +
        "linear-gradient(180deg,#02101b 0%,#041c2e 55%,#03202f 100%)";
    }
    var done = false;
    var hideTimer = 0;
    // 전체 화면 윤슬이 1.25초 반짝인 뒤, 0.75초 동안 깔끔한 크로스디졸브로 사라진다.
    function dissolve(ms) {
      if (done || !sp) { return; }
      done = true;
      clearTimeout(hideTimer);
      var fade = Math.max(120, Number(ms) || 750);
      sp.style.transitionDuration = (fade / 1000) + "s";
      sp.classList.add("is-dissolving", "is-hiding");
      document.body.classList.remove("is-splashing");
      try { sessionStorage.setItem("badaSplashShown", "1"); } catch (e) { }
      // 디졸브가 끝난 뒤 WebGL 루프를 완전히 정지하고 캔버스를 제거한다.
      setTimeout(function () {
        if (ctrl) { try { ctrl.stop(); } catch (e) { } }
        if (sp && sp.parentNode) { sp.parentNode.removeChild(sp); }
      }, fade + 30);
    }
    function hide() { dissolve(280); }   // 탭·키 입력은 즉시(짧게) 스킵
    hideTimer = setTimeout(function () { dissolve(750); }, 1250);
    sp.addEventListener("click", hide);
    sp.addEventListener("touchstart", hide, { passive: true });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        hide();
        document.removeEventListener("keydown", onKey);
      }
    });
  }

  /* ------------------------------------------------------------
     부팅
     ------------------------------------------------------------ */
  function boot() {
    initSplash();
    bindGlobal();
    api("/api/health").then(function (h) { S.health = h; }).catch(function () { });
    api("/api/bank").then(function (bank) {
      S.bank = bank;
      bank.questions.forEach(function (q) { S.index[q.id] = q; });
      renderHome(); renderParts();
      refreshAnalysis(true);
    }).catch(function (e) { toast("문제은행을 불러오지 못했습니다: " + e.message, 5000); });
    api("/api/vocab").then(function (v) { S.vocabBank = v; renderVocab(); }).catch(function () { });
    api("/api/grammar").then(function (g) { S.grammar = g; renderGrammar(); }).catch(function () { });
    rebuildGenIndex();
    renderHome();
    renderVocab();
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", boot); }
  else { boot(); }

  window.BadaApp = {
    state: S, store: function () { return D; }, nav: nav,
    refresh: refreshAnalysis, exportData: exportData, importData: importData,
    vocabAll: vocabAll, startExam: startExam
  };
})();
