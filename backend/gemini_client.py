#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini API 연동 (gemini_client.py)
=================================

사용자가 설정에 넣은 Gemini API 키로 "새 토익 문제"를 즉석에서 생성합니다.

중요(개인정보):
- API 키는 요청 본문으로만 받아 그 요청 안에서 쓰고 버립니다.
- 서버 메모리에도, 디스크에도, 로그에도 남기지 않습니다.
- 생성 결과는 호출자(브라우저)에게만 돌려주고 서버에는 저장하지 않습니다.

표준 라이브러리(urllib)만 사용합니다.
"""

from __future__ import annotations

import json
import os
import random
import re
import urllib.error
import urllib.request

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
FALLBACK_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-2.5-flash-lite",
]
TIMEOUT = 55
KEY_RE = re.compile(r"^AIza[0-9A-Za-z_\-]{30,}$")

PART_LABEL = {
    2: "질의응답(Part 2)",
    3: "대화(Part 3)",
    4: "담화(Part 4)",
    5: "단문 빈칸(Part 5)",
    6: "장문 빈칸(Part 6)",
    7: "독해(Part 7)",
}


class AIError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _request(url: str, payload: dict | None = None, api_key: str = "", timeout: int = TIMEOUT) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="GET" if payload is None else "POST")
    req.add_header("x-goog-api-key", api_key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = b""
        try:
            body = exc.read()
        except Exception:
            pass
        msg = ""
        try:
            msg = json.loads(body.decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            msg = body.decode("utf-8", "replace")[:200]
        if exc.code in (400, 401, 403):
            raise AIError("Gemini 키가 올바르지 않거나 권한이 없습니다. %s" % msg, 401) from exc
        if exc.code == 404:
            raise AIError("사용할 수 없는 모델입니다. %s" % msg, 404) from exc
        if exc.code == 429:
            raise AIError("Gemini 사용 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.", 429) from exc
        raise AIError("Gemini 호출 실패(%d): %s" % (exc.code, msg or "알 수 없는 오류"), 502) from exc
    except urllib.error.URLError as exc:
        raise AIError("Gemini 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.", 503) from exc
    except TimeoutError as exc:
        raise AIError("Gemini 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.", 504) from exc
    except AIError:
        raise
    except Exception as exc:  # SSL/연결 끊김 등 → 500 대신 503으로 안내
        raise AIError("Gemini 연결 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.", 503) from exc


def check_key_format(api_key: str) -> str:
    key = str(api_key or "").strip()
    if not KEY_RE.match(key):
        raise AIError("Gemini API 키 형식이 올바르지 않습니다(AIza... 로 시작).", 400)
    return key


def list_models(api_key: str) -> list[str]:
    data = _request(API_BASE + "/models?pageSize=200", api_key=api_key, timeout=25)
    out = []
    for m in data.get("models", []):
        methods = m.get("supportedGenerationMethods") or []
        if "generateContent" in methods:
            name = str(m.get("name", "")).replace("models/", "")
            if name and "embedding" not in name:
                out.append(name)
    return out


def _pick_models(api_key: str, preferred: str | None) -> list[str]:
    names = []
    for cand in [preferred or "", DEFAULT_MODEL] + FALLBACK_MODELS:
        if cand and cand not in names:
            names.append(cand)
    try:
        available = list_models(api_key)
    except AIError:
        available = []
    if available:
        ranked = [m for m in available if "flash" in m and not m.endswith(("-tts", "-image", "-live"))]
        ranked.sort(key=lambda m: (0 if "lite" in m else 1, -len(m)))
        names = [m for m in names if m in available] + ranked
    seen = set()
    ordered = []
    for m in names:
        if m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered[:4]


PROMPT_TEMPLATE = """당신은 한국의 토익(TOEIC) 전문 강사입니다. 실제 기출과 같은 품질의 **새로운** 문제를 만듭니다.

요청:
- 파트: {part_label}
- 문항 수: {count}문항 (세트로 묶일 수 있음)
- 학습자 약점: {weakness}
- 난이도: {difficulty}

규칙:
1. 실제 토익과 같은 형식·난이도·어휘 수준. 정답은 반드시 하나.
2. 모든 해설과 해석은 자연스러운 한국어.
3. Part 3·4는 대화/담화 대본을 함께 만들고, 화자는 줄 앞에 "W: " 또는 "M: " (안내방송은 "N: ")로 표기. 한 세트에 2~3문항.
4. Part 6·7은 지문(passage)을 함께 만들고 세트당 2~3문항. Part 5는 지문 없이 1문항.
5. Part 2는 질문 1개와 응답 3개(정답 1개), passage.text에 "W: 질문\\nM: 응답A\\nM: 응답B\\nM: 응답C" 형식으로.
6. Part 7 문항에는 반드시 다음 두 필드를 넣으세요.
   - "evidence_quote": 지문 본문에 **글자 그대로 존재하는** 정답 근거 문장(그대로 복사, 따옴표/말줄임 금지)
   - "paraphrase_pair": [{{"question": "질문·선지의 표현", "passage": "지문에서 바뀐 표현"}}] 형태 1~2개
7. 중복된 문제를 만들지 말 것.

아래 JSON 형식으로만 답하세요. 코드블록이나 설명 문장 없이 JSON만 출력합니다.
{{
  "sets": [
    {{
      "part": {part_num},
      "passage": {{"kind": "conversation|announcement|email|notice|article|chat", "text": "...", "translation": "..."}},
      "questions": [
        {{
          "type": "세부유형(예: 문법-시제, 대화-추론, 독해-세부사항)",
          "difficulty": 1,
          "prompt": "문제 지시문 또는 빈칸 문장",
          "choices": ["...", "...", "...", "..."],
          "answer": 0,
          "explanation": "왜 정답인지, 오답은 왜 아닌지 한국어 해설",
          "translation": "문제/지문의 한국어 해석",
          "evidence_quote": "Part 7일 때 지문 속 정답 근거 문장(그대로)",
          "paraphrase_pair": [{{"question": "바꿔 쓴 표현", "passage": "지문 속 표현"}}],
          "vocabulary": [{{"word": "영단어", "meaning": "뜻", "example": "예문"}}]
        }}
      ]
    }}
  ]
}}"""


def _extract_json(text: str) -> dict:
    text = str(text or "").strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise AIError("AI 응답에서 JSON을 찾지 못했습니다.", 502)
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise AIError("AI 응답 형식을 해석하지 못했습니다.", 502) from exc


def _normalize(raw: dict, part: int, count: int) -> dict:
    sets_out = []
    total = 0
    for si, s in enumerate(raw.get("sets") or []):
        if not isinstance(s, dict):
            continue
        spart = int(s.get("part") or part)
        if spart not in PART_LABEL:
            spart = part
        passage = s.get("passage") if isinstance(s.get("passage"), dict) else None
        if spart in (2, 3, 4, 6, 7) and not (passage and str(passage.get("text", "")).strip()):
            continue
        gid = "ai-g-%d-%d" % (si, random.randint(1000, 9999))
        qs = []
        for qi, item in enumerate(s.get("questions") or []):
            if not isinstance(item, dict):
                continue
            choices = [str(c).strip() for c in (item.get("choices") or []) if str(c).strip()]
            need = 3 if spart == 2 else 4
            if len(choices) != need:
                continue
            try:
                answer = int(item.get("answer", -1))
            except (TypeError, ValueError):
                continue
            if not (0 <= answer < need):
                continue
            prompt = str(item.get("prompt") or "").strip()
            explanation = str(item.get("explanation") or "").strip()
            if not prompt or not explanation:
                continue
            vocab = []
            for vv in (item.get("vocabulary") or [])[:4]:
                if isinstance(vv, dict) and str(vv.get("word", "")).strip():
                    vocab.append({
                        "word": str(vv.get("word", "")).strip()[:40],
                        "meaning": str(vv.get("meaning", "")).strip()[:80],
                        "example": str(vv.get("example", "")).strip()[:160],
                    })
            ptext = str((passage or {}).get("text") or "")
            evidence = str(item.get("evidence_quote") or "").strip()
            if spart == 7 and evidence and evidence not in ptext:
                evidence = ""  # 지문에 없는 근거는 버린다
            pairs = []
            if spart == 7:
                for pr in (item.get("paraphrase_pair") or [])[:3]:
                    if isinstance(pr, dict) and pr.get("question") and pr.get("passage"):
                        pairs.append({"question": str(pr["question"])[:80],
                                      "passage": str(pr["passage"])[:120]})
            qs.append({
                "id": "ai-%d-%d-%d" % (si, qi, random.randint(10000, 99999)),
                "part": spart,
                "type": str(item.get("type") or "AI 생성").strip()[:30],
                "difficulty": min(3, max(1, int(item.get("difficulty") or 2))),
                "prompt": prompt[:400],
                "choices": [c[:200] for c in choices],
                "answer": answer,
                "explanation": explanation[:1200],
                "translation": str(item.get("translation") or "").strip()[:800],
                "vocabulary": vocab,
                "evidence_quote": evidence if spart == 7 else "",
                "paraphrase_pair": pairs,
                "group_id": gid if spart != 5 else None,
                "source": "ai",
            })
            total += 1
            if total >= count:
                break
        if qs:
            sets_out.append({
                "group_id": gid,
                "passage": {
                    "id": gid,
                    "kind": str((passage or {}).get("kind") or "article")[:20],
                    "text": str((passage or {}).get("text") or "").strip()[:3000],
                    "translation": str((passage or {}).get("translation") or "").strip()[:2000],
                    "speakers": [{"id": "W"}, {"id": "M"}],
                } if passage else None,
                "questions": qs,
            })
        if total >= count:
            break
    if not sets_out:
        raise AIError("AI가 유효한 문제를 만들지 못했습니다. 다시 시도해 주세요.", 502)
    return {"sets": sets_out, "count": total, "model": None}


def generate_questions(api_key: str, part: int = 5, count: int = 5,
                       weakness: str = "", difficulty: str = "실전과 동일",
                       model: str | None = None) -> dict:
    key = check_key_format(api_key)
    part = int(part) if int(part) in PART_LABEL else 5
    count = max(1, min(10, int(count or 5)))
    prompt = PROMPT_TEMPLATE.format(
        part_label=PART_LABEL[part],
        part_num=part,
        count=count,
        weakness=(weakness or "아직 데이터 없음").strip()[:600],
        difficulty=difficulty,
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 4096,
                             "responseMimeType": "application/json"},
    }
    last_error: AIError | None = None
    for candidate in _pick_models(key, model):
        try:
            data = _request("%s/models/%s:generateContent" % (API_BASE, candidate),
                            payload=payload, api_key=key)
        except AIError as exc:
            last_error = exc
            if exc.status in (404, 400):
                continue
            raise
        text = ""
        for cand in data.get("candidates", []):
            for part_obj in (cand.get("content") or {}).get("parts", []):
                text += part_obj.get("text", "")
        if not text.strip():
            last_error = AIError("AI 응답이 비어 있습니다.", 502)
            continue
        result = _normalize(_extract_json(text), part, count)
        result["model"] = candidate
        return result
    raise last_error or AIError("AI 문제 생성에 실패했습니다.", 502)


def test_key(api_key: str) -> dict:
    key = check_key_format(api_key)
    models = list_models(key)
    flash = [m for m in models if "flash" in m][:5]
    return {"ok": True, "models": flash, "count": len(models)}


EXPLAIN_PROMPT = """당신은 한국의 토익 전문 강사입니다. 아래 문법 주제를 학습자 수준에 맞게 다시 설명해 주세요.

- 주제: {topic}
- 학습자 요청: {level}
- 학습자가 방금 틀린 문제(있으면 참고): {question}

요구사항:
1. 3~5문장의 아주 쉬운 설명으로 시작 (중학생도 이해할 수 있게)
2. "이것만 기억하세요" 1줄 공식
3. 토익에 실제로 나오는 짧은 예문 3개 (영어 + 한국어 해석 + 왜 그런지 한 줄)
4. 자주 하는 실수 1가지
5. 마크다운 없이 줄바꿈만 사용한 평문으로, 전체 400자~900자 사이
한국어로 답하세요."""


def explain_grammar(api_key: str, topic: str, level: str = "더 쉽게 설명해 줘",
                    question: str = "") -> dict:
    """특정 문법 주제를 Gemini가 다시 설명(키는 이 요청에서만 사용)."""
    key = check_key_format(api_key)
    topic = str(topic or "").strip()[:120]
    if not topic:
        raise AIError("설명할 문법 주제가 필요합니다.", 400)
    prompt = EXPLAIN_PROMPT.format(topic=topic, level=str(level or "")[:100],
                                   question=str(question or "")[:300])
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 1200},
    }
    last_error = None
    for candidate in _pick_models(key, None):
        try:
            data = _request("%s/models/%s:generateContent" % (API_BASE, candidate),
                            payload=payload, api_key=key)
        except AIError as exc:
            last_error = exc
            if exc.status in (404, 400):
                continue
            raise
        text = ""
        for cand in data.get("candidates", []):
            for part_obj in (cand.get("content") or {}).get("parts", []):
                text += part_obj.get("text", "")
        if text.strip():
            return {"text": text.strip()[:4000], "model": candidate}
        last_error = AIError("AI 응답이 비어 있습니다.", 502)
    raise last_error or AIError("AI 설명을 만들지 못했습니다.", 502)
