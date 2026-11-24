#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🌊 바다토익 (BADA TOEIC) 서버
=============================

- 표준 라이브러리 http.server 기반의 초경량 서버 (설치 부담 최소)
- PC 로컬 실행과 무료 클라우드(Hugging Face Spaces / Render) 모두 지원
  · PORT 환경변수가 있으면 그 포트에 정확히 바인딩 (클라우드)
  · 없으면 8768 부터 빈 포트를 찾아 로컬 실행 + 브라우저 자동 열기

개인정보 원칙 (공용 서버 대응):
  * 학습 기록·오답노트·단어장·Gemini API 키는 **브라우저(localStorage)** 에만 저장됩니다.
  * 이 서버는 공용 문제은행과 LC 음성 캐시만 디스크에 두고, 개인 기록을 저장하거나
    로그에 남기지 않습니다. Gemini 키는 요청 처리 중에만 메모리에 있고 즉시 버립니다.
"""

from __future__ import annotations

import json
import os
import re
import signal
import socket
import sys
import threading
import time
import traceback
import webbrowser
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")
AUDIO_DIR = os.path.join(DATA_DIR, "audio")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import audio_builder  # noqa: E402
import gemini_client  # noqa: E402
import qr as qr_mod  # noqa: E402
import toeic_engine as engine  # noqa: E402

APP_NAME = "바다토익 (BADA TOEIC)"
APP_VERSION = "1.0.1"
APP_ID = "bada-toeic"

DEFAULT_PORT = 8768
PORT_ENV = os.environ.get("PORT")
HOST = os.environ.get("HOST", "0.0.0.0").strip() or "0.0.0.0"
IS_CLOUD = bool(os.environ.get("SPACE_ID") or os.environ.get("RENDER")
                or os.environ.get("BADA_CLOUD") == "1")
MAX_JSON_BODY = 256 * 1024
MAX_ANSWERS = 60
SERVER_HOLDER: dict[str, ThreadingHTTPServer] = {}

START_TIME = time.time()


# ---------------------------------------------------------------------------
# 콘솔 · 로그 (개인정보·키 절대 출력 금지)
# ---------------------------------------------------------------------------
def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass


def log(msg: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print("[%s] %s" % (stamp, msg), flush=True)


KEY_PATTERN = re.compile(r"AIza[0-9A-Za-z_\-]{10,}")
BEARER_PATTERN = re.compile(r"(?i)(api[_-]?key|key|token)\s*[=:]\s*[^\s&,]+")


def redact(text: str) -> str:
    text = KEY_PATTERN.sub("AIza***REDACTED***", str(text or ""))
    return BEARER_PATTERN.sub(r"\1=***", text)


# ---------------------------------------------------------------------------
# 문제은행
# ---------------------------------------------------------------------------
def load_bank() -> dict:
    path = os.path.join(BACKEND_DIR, "question_bank.json")
    with open(path, "r", encoding="utf-8") as f:
        bank = json.load(f)
    questions = bank.get("questions") or []
    if len(questions) < 10:
        raise RuntimeError("문제은행이 비어 있습니다: %s" % path)
    for item in questions:
        item["answer"] = int(item["answer"])
        item["part"] = int(item["part"])
        item["difficulty"] = int(item.get("difficulty", 2))
    bank["questions"] = questions
    return bank


def load_json(name: str) -> dict:
    path = os.path.join(BACKEND_DIR, name)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


BANK = load_bank()
VOCAB_BANK = load_json("vocab_bank.json")
GRAMMAR_NOTES = load_json("grammar_notes.json")
QUESTIONS: list[dict] = BANK["questions"]
PASSAGES: dict = BANK["passages"]
INDEX: dict = {q["id"]: q for q in QUESTIONS}
PUBLIC_BANK = OrderedDict([
    ("version", BANK.get("version", "1.0")),
    ("total", len(QUESTIONS)),
    ("parts", BANK.get("parts", {})),
    ("questions", [engine.public_question(q, PASSAGES) for q in QUESTIONS]),
    ("reading_kinds", sorted(engine.READING_KINDS)),
])


# ---------------------------------------------------------------------------
# 아주 단순한 IP 기준 호출 제한 (개인정보 저장 없음, 메모리 카운터만)
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, limit: int, window: int = 3600):
        self.limit = limit
        self.window = window
        self.hits: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            arr = [t for t in self.hits.get(key, []) if now - t < self.window]
            if len(arr) >= self.limit:
                self.hits[key] = arr
                return False
            arr.append(now)
            self.hits[key] = arr
            if len(self.hits) > 5000:
                self.hits.clear()
            return True


AI_LIMIT = RateLimiter(30)
GRADE_LIMIT = RateLimiter(600)
AUDIO_LIMIT = RateLimiter(240)


# ---------------------------------------------------------------------------
# 네트워크 도우미
# ---------------------------------------------------------------------------
def lan_addresses() -> list[str]:
    ips: list[str] = []

    def add(ip: str) -> None:
        if ip and ip not in ips and not ip.startswith("127."):
            ips.append(ip)

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.4)
        sock.connect(("8.8.8.8", 80))
        add(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except Exception:
        pass
    return ips[:6]


def find_port(start: int = DEFAULT_PORT, tries: int = 40) -> int:
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise RuntimeError("사용 가능한 포트를 찾지 못했습니다.")


# ---------------------------------------------------------------------------
# HTTP 핸들러
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "BadaToeic/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    # 공통 헤더 ------------------------------------------------------------
    def _common_headers(self) -> dict:
        return {
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "microphone=(), camera=()",
            "Content-Security-Policy": (
                "default-src 'self'; img-src 'self' data: blob:; "
                "style-src 'self' 'unsafe-inline'; script-src 'self'; "
                "connect-src 'self'; media-src 'self' blob:; font-src 'self' data:; "
                "frame-ancestors 'self' https://huggingface.co https://*.huggingface.co; "
                "base-uri 'none'; form-action 'self'"
            ),
        }

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None,
              head_only: bool = False) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in self._common_headers().items():
            self.send_header(k, v)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionError):
                pass

    def _json(self, obj, code: int = 200, extra: dict | None = None, head_only: bool = False) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        hdr = {"Cache-Control": "no-store"}
        hdr.update(extra or {})
        self._send(code, body, "application/json; charset=utf-8", hdr, head_only=head_only)

    def _fail(self, message: str, code: int = 400, **extra) -> None:
        payload = {"ok": False, "error": message}
        payload.update(extra)
        self._json(payload, code)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_JSON_BODY:
            raise ValueError("요청이 너무 큽니다.")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ValueError("JSON 형식이 아닙니다.")
        if not isinstance(data, dict):
            raise ValueError("JSON 객체가 필요합니다.")
        return data

    def _client_ip(self) -> str:
        fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return fwd or self.client_address[0]

    def _origin_ok(self) -> bool:
        """교차 출처 POST 차단(CSRF 방지). 같은 출처·오리진 없음은 허용."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        try:
            o = urlparse(origin)
        except Exception:
            return False
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        oh = (o.hostname or "").lower()
        if not oh:
            return False
        if oh == host:
            return True
        if oh in ("localhost", "127.0.0.1") and host in ("localhost", "127.0.0.1"):
            return True
        return False

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        line = redact(fmt % args)
        line = re.sub(r"\?.*?(?=\s|$)", "?...", line)
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), line))

    # 라우팅 ----------------------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Allow", "GET, POST, HEAD, OPTIONS")
        for k, v in self._common_headers().items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET(head_only=True)

    def do_GET(self, head_only: bool = False) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path.startswith("/api/"):
                self._api_get(path, parse_qs(parsed.query), head_only)
                return
            self._serve_static(path, head_only)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._fail("서버 오류가 발생했습니다.", 500)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if not self._origin_ok():
            self._fail("허용되지 않은 출처에서의 요청입니다.", 403)
            return
        try:
            self._api_post(path, parse_qs(parsed.query))
        except ValueError as exc:
            self._fail(str(exc), 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._fail("서버 오류가 발생했습니다.", 500)

    # 정적 파일 -------------------------------------------------------------
    STATIC = {
        "/": ("index.html", "text/html; charset=utf-8"),
        "/index.html": ("index.html", "text/html; charset=utf-8"),
        "/styles.css": ("styles.css", "text/css; charset=utf-8"),
        "/main.js": ("main.js", "application/javascript; charset=utf-8"),
        "/qr.js": ("qr.js", "application/javascript; charset=utf-8"),
        "/splash.js": ("splash.js", "application/javascript; charset=utf-8"),
        "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
        "/icon.svg": ("icon.svg", "image/svg+xml"),
    }

    def _serve_static(self, path: str, head_only: bool = False) -> None:
        if path == "/favicon.ico":
            self._send(204, b"", "image/x-icon", head_only=head_only)
            return
        entry = self.STATIC.get(path)
        if not entry:
            self._send(404, b"Not found", "text/plain; charset=utf-8", head_only=head_only)
            return
        name, ctype = entry
        full = os.path.realpath(os.path.join(FRONTEND_DIR, name))
        if not full.startswith(os.path.realpath(FRONTEND_DIR)):
            self._send(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        try:
            with open(full, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        etag = 'W/"%s-%d"' % (APP_VERSION, len(body))
        if self.headers.get("If-None-Match") == etag:
            self._send(304, b"", ctype, {"ETag": etag})
            return
        self._send(200, body, ctype, {"ETag": etag,
                                      "Cache-Control": "no-cache, must-revalidate"},
                   head_only=head_only)

    # API GET ---------------------------------------------------------------
    def _api_get(self, path: str, query: dict, head_only: bool = False) -> None:
        if path == "/api/health":
            self._json({
                "ok": True,
                "app": APP_NAME,
                "version": APP_VERSION,
                "mode": "cloud" if IS_CLOUD else "local",
                "tts": audio_builder.HAS_EDGE_TTS,
                "bank_total": len(QUESTIONS),
                "vocab_total": VOCAB_BANK.get("total", 0),
                "grammar_total": GRAMMAR_NOTES.get("total", 0),
                "uptime_sec": int(time.time() - START_TIME),
                "server_time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }, head_only=head_only)
            return
        if path == "/api/bank":
            self._json(PUBLIC_BANK, extra={"Cache-Control": "no-cache"}, head_only=head_only)
            return
        if path == "/api/vocab":
            self._json(VOCAB_BANK, extra={"Cache-Control": "public, max-age=3600"}, head_only=head_only)
            return
        if path == "/api/grammar":
            self._json(GRAMMAR_NOTES, extra={"Cache-Control": "public, max-age=3600"}, head_only=head_only)
            return
        if path.startswith("/api/script/"):
            qid = path[len("/api/script/"):]
            item = INDEX.get(qid)
            if not item:
                self._json({"ok": False, "error": "없는 문제입니다."}, 404)
                return
            gid = item.get("group_id")
            psg = PASSAGES.get(gid) if gid else None
            if not psg or not psg.get("text"):
                self._json({"ok": False, "error": "이 문제에는 대본이 없습니다."}, 404)
                return
            self._json({"ok": True, "text": psg.get("text", ""),
                        "translation": psg.get("translation", ""),
                        "kind": psg.get("kind", "")})
            return
        if path == "/api/diagnostic":
            seed = (query.get("seed") or [None])[0]
            items = engine.build_diagnostic(QUESTIONS, seed=int(seed) if str(seed or "").isdigit() else None)
            self._json({
                "ok": True,
                "kind": "diagnostic",
                "questions": [engine.public_question(q, PASSAGES) for q in items],
            })
            return
        if path.startswith("/api/audio/") and path.endswith(".mp3"):
            self._audio_bank(path, query)
            return
        if path == "/api/audio/status":
            qid = (query.get("id") or [""])[0]
            voice = (query.get("voice") or ["us"])[0]
            item = INDEX.get(qid)
            if not item:
                self._json({"ok": False, "error": "없는 문제입니다."}, 404)
                return
            text = self._audio_text(item)
            cached = bool(text) and os.path.exists(audio_builder.cache_path(AUDIO_DIR, text, voice))
            self._json({"ok": True, "cached": cached, "available": audio_builder.HAS_EDGE_TTS})
            return
        if path == "/api/connect":
            port = SERVER_HOLDER.get("port") or DEFAULT_PORT
            urls = ["http://%s:%d" % (ip, port) for ip in lan_addresses()]
            self._json({
                "ok": True,
                "mode": "cloud" if IS_CLOUD else "local",
                "port": port,
                "urls": urls,
                "origin_hint": "지금 접속한 주소 그대로 QR에 담깁니다.",
            })
            return
        if path == "/api/qr":
            text = (query.get("text") or [""])[0][:300]
            if not text:
                self._fail("text 파라미터가 필요합니다.", 400)
                return
            fmt = (query.get("format") or ["svg"])[0]
            if fmt == "matrix":
                mtx, mask = qr_mod.build_matrix(text)
                self._json({"ok": True, "mask": mask, "matrix": mtx, "version": (len(mtx) - 17) // 4})
                return
            svg = qr_mod.to_svg(text)
            self._send(200, svg.encode("utf-8"), "image/svg+xml; charset=utf-8",
                       {"Cache-Control": "public, max-age=86400"})
            return
        self._fail("없는 API 주소입니다.", 404)

    # API POST --------------------------------------------------------------
    def _api_post(self, path: str, query: dict) -> None:
        ip = self._client_ip()
        if path == "/api/recommend":
            if not GRADE_LIMIT.allow(ip):
                self._fail("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
                return
            data = self._read_json()
            records = self._slim_records(data.get("records"))
            count = max(1, min(30, int(data.get("count") or 10)))
            part = data.get("part")
            seed = data.get("seed")
            items = engine.choose_practice(
                QUESTIONS, records, count=count,
                part=int(part) if str(part or "").isdigit() else None,
                seed=int(seed) if str(seed or "").isdigit() else None)
            self._json({
                "ok": True,
                "kind": "part" if part else "daily",
                "part": int(part) if str(part or "").isdigit() else None,
                "questions": [engine.public_question(q, PASSAGES) for q in items],
            })
            return
        if path == "/api/grade":
            if not GRADE_LIMIT.allow(ip):
                self._fail("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
                return
            data = self._read_json()
            answers = data.get("answers")
            if not isinstance(answers, list) or not answers:
                raise ValueError("answers 목록이 필요합니다.")
            if len(answers) > MAX_ANSWERS:
                raise ValueError("한 번에 너무 많은 문항입니다.")
            results = engine.grade(answers, INDEX, PASSAGES)
            self._json({"ok": True, "results": results, "graded": len(results)})
            return
        if path == "/api/analyze":
            if not GRADE_LIMIT.allow(ip):
                self._fail("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
                return
            data = self._read_json()
            records = self._slim_records(data.get("records"))
            target = data.get("target") or 800
            try:
                target = max(400, min(990, int(target)))
            except (TypeError, ValueError):
                target = 800
            self._json({"ok": True, "analysis": engine.analyze(records, target)})
            return
        if path == "/api/audio/prefetch":
            if not AUDIO_LIMIT.allow(ip):
                self._fail("요청이 너무 많습니다.", 429)
                return
            data = self._read_json()
            ids = data.get("ids") or []
            voice = str(data.get("voice") or "us")
            started = 0
            for qid in ids[:12]:
                item = INDEX.get(str(qid))
                if not item or not self._audio_text(item):
                    continue
                text = self._audio_text(item)
                if os.path.exists(audio_builder.cache_path(AUDIO_DIR, text, voice)):
                    continue
                threading.Thread(target=self._safe_build, args=(text, voice), daemon=True).start()
                started += 1
            self._json({"ok": True, "started": started, "tts": audio_builder.HAS_EDGE_TTS})
            return
        if path == "/api/audio/custom":
            if not AUDIO_LIMIT.allow(ip):
                self._fail("요청이 너무 많습니다.", 429)
                return
            data = self._read_json()
            text = str(data.get("text") or "")[:4000]
            voice = str(data.get("voice") or "us")
            if not text.strip():
                raise ValueError("text가 필요합니다.")
            if not audio_builder.HAS_EDGE_TTS:
                self._fail("이 서버에서는 음성 합성을 사용할 수 없습니다.", 503, fallback=True)
                return
            try:
                path_mp3 = audio_builder.ensure_audio(AUDIO_DIR, text, voice)
            except audio_builder.AudioUnavailable as exc:
                self._fail(str(exc), 503, fallback=True)
                return
            self._send_file(path_mp3, "audio/mpeg", cache=True)
            return
        if path == "/api/ai/generate":
            self._handle_ai(path)
            return
        if path == "/api/ai/test":
            self._handle_ai(path)
            return
        if path == "/api/ai/explain":
            self._handle_ai(path)
            return
        self._fail("없는 API 주소입니다.", 404)

    # AI -------------------------------------------------------------------
    def _handle_ai(self, path: str) -> None:
        ip = self._client_ip()
        if not AI_LIMIT.allow(ip):
            self._fail("AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
            return
        data = self._read_json()
        api_key = str(data.get("api_key") or "").strip()
        try:
            if path == "/api/ai/test":
                info = gemini_client.test_key(api_key)
                self._json({"ok": True, "info": info})
                return
            if path == "/api/ai/explain":
                res = gemini_client.explain_grammar(
                    api_key,
                    topic=str(data.get("topic") or ""),
                    level=str(data.get("level") or "더 쉽게 설명해 줘"),
                    question=str(data.get("question") or ""),
                )
                self._json({"ok": True, "text": res["text"], "model": res["model"]})
                return
            weakness = data.get("weakness")
            if isinstance(weakness, list):
                weakness = ", ".join(str(w) for w in weakness[:6])
            result = gemini_client.generate_questions(
                api_key,
                part=int(data.get("part") or 5),
                count=int(data.get("count") or 5),
                weakness=str(weakness or ""),
                difficulty=str(data.get("difficulty") or "실전과 동일"),
            )
            self._json({"ok": True, "sets": result["sets"], "count": result["count"],
                        "model": result["model"]})
        except gemini_client.AIError as exc:
            self._fail(str(exc), exc.status, ai=True)
        finally:
            api_key = ""  # 즉시 폐기 (디스크·메모리 어디에도 남기지 않음)

    # 음성 ------------------------------------------------------------------
    def _audio_text(self, item: dict) -> str:
        gid = item.get("group_id")
        psg = PASSAGES.get(gid) if gid else None
        if not psg:
            return ""
        kind = str(psg.get("kind") or "")
        if kind in engine.READING_KINDS:
            return ""
        return str(psg.get("text") or "")

    def _audio_bank(self, path: str, query: dict) -> None:
        qid = path[len("/api/audio/"):-len(".mp3")]
        item = INDEX.get(qid)
        if not item:
            self._fail("없는 문제입니다.", 404)
            return
        text = self._audio_text(item)
        if not text:
            self._fail("이 문제에는 음성이 없습니다.", 404, fallback=True)
            return
        voice = (query.get("voice") or ["us"])[0]
        if voice not in audio_builder.VOICE_SETS:
            voice = "us"
        if not audio_builder.HAS_EDGE_TTS:
            self._fail("서버에서 음성을 만들 수 없습니다. 브라우저 음성으로 재생합니다.",
                       503, fallback=True)
            return
        try:
            full = audio_builder.ensure_audio(AUDIO_DIR, text, voice)
        except audio_builder.AudioUnavailable as exc:
            self._fail(redact(str(exc)), 503, fallback=True)
            return
        self._send_file(full, "audio/mpeg", cache=True)

    def _safe_build(self, text: str, voice: str) -> None:
        try:
            audio_builder.ensure_audio(AUDIO_DIR, text, voice)
        except Exception:
            pass

    # 파일 전송(Range 지원 — iOS Safari 필수) ------------------------------
    def _send_file(self, full: str, ctype: str, cache: bool = True) -> None:
        try:
            size = os.path.getsize(full)
            f = open(full, "rb")
        except OSError:
            self._fail("파일을 열 수 없습니다.", 404)
            return
        with f:
            start, end = 0, size - 1
            code = 200
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
                if m:
                    if m.group(1):
                        start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                    if not m.group(1) and m.group(2):
                        start = max(0, size - int(m.group(2)))
                    if start > end or start >= size:
                        self._send(416, b"", ctype, {"Content-Range": "bytes */%d" % size})
                        return
                    code = 206
            length = end - start + 1
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            self.send_header("Cache-Control", "public, max-age=86400" if cache else "no-store")
            for k, v in self._common_headers().items():
                self.send_header(k, v)
            self.end_headers()
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # 기록 정리 -------------------------------------------------------------
    @staticmethod
    def _slim_records(records) -> list[dict]:
        """브라우저가 보낸 학습 기록에서 통계에 필요한 필드만 추린다."""
        out = []
        for rec in (records or [])[-3000:]:
            if not isinstance(rec, dict):
                continue
            try:
                out.append({
                    "id": str(rec.get("id"))[:40],
                    "part": int(rec.get("part") or 0),
                    "type": str(rec.get("type") or "")[:40],
                    "difficulty": int(rec.get("difficulty") or 2),
                    "correct": bool(rec.get("correct")),
                    "time_ms": max(0, min(3_600_000, int(rec.get("time_ms") or 0))),
                    "at": str(rec.get("at") or ""),
                })
            except (TypeError, ValueError):
                continue
        return out


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------
def _shutdown(signum, frame) -> None:  # noqa: ARG001
    log("종료 신호를 받았습니다. 서버를 닫습니다.")
    srv = SERVER_HOLDER.get("server")
    if srv:
        threading.Thread(target=srv.shutdown, daemon=True).start()


def main() -> None:
    _fix_console()
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DIR, exist_ok=True)

    if PORT_ENV:
        port = int(PORT_ENV)
    else:
        port = find_port(DEFAULT_PORT)
    SERVER_HOLDER["port"] = port

    server = ThreadingHTTPServer((HOST, port), Handler)
    server.daemon_threads = True
    SERVER_HOLDER["server"] = server
    try:
        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)
    except Exception:
        pass

    print("")
    print("  ============================================================")
    print("   🌊  %s  v%s" % (APP_NAME, APP_VERSION))
    print("  ============================================================")
    print("   내 PC        : http://127.0.0.1:%d" % port)
    if not IS_CLOUD:
        for ip in lan_addresses():
            print("   같은 와이파이 : http://%s:%d   (폰에서 접속)" % (ip, port))
    print("   문제은행     : %d문항 (Part 1~7)" % len(QUESTIONS))
    print("   LC 음성      : %s" % ("edge-tts 사용 가능" if audio_builder.HAS_EDGE_TTS
                                     else "미설치 → 브라우저 음성으로 대체"))
    print("   저장 방식    : 학습 기록·API 키는 이 브라우저(localStorage)에만 저장")
    print("  ------------------------------------------------------------")
    print("   종료하려면 이 창에서 Ctrl+C 를 누르세요.")
    print("")

    if not IS_CLOUD and os.environ.get("BADA_NO_BROWSER") != "1":
        threading.Timer(1.2, lambda: webbrowser.open("http://127.0.0.1:%d" % port)).start()

    try:
        server.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("  바다토익 서버를 종료했습니다.")


if __name__ == "__main__":
    main()
