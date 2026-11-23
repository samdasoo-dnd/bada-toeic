#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LC 듣기 음성 생성기 (audio_builder.py)
=====================================

`edge-tts`(마이크로소프트 신경망 음성)로 토익 Part 1~4 대본을 실제 MP3로 만듭니다.

- 화자별 목소리 분리 : W(여) / M(남) / N(안내) / W2 / M2
- 국가별 음성 세트 : us(미국) / uk(영국) / au(호주)
- 결과는 파일로 캐시되어 두 번째부터는 즉시 재생됩니다.
- edge-tts가 없거나 네트워크가 막혀 있으면 AudioUnavailable 예외 → 앱은
  브라우저 음성(speechSynthesis) 안내 모드로 자동 전환합니다.

대본 형식: 한 줄에 "W: 문장" 처럼 화자 접두사를 붙입니다.
개인정보를 저장하지 않으며, 대본 텍스트는 문제은행에 들어 있는 공용 콘텐츠입니다.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading

try:  # 선택 의존성
    import edge_tts  # type: ignore
    HAS_EDGE_TTS = os.environ.get("BADA_DISABLE_TTS") != "1"
except Exception:  # pragma: no cover
    edge_tts = None
    HAS_EDGE_TTS = False

VOICE_SETS = {
    "us": {
        "W": "en-US-JennyNeural",
        "M": "en-US-GuyNeural",
        "W2": "en-US-AriaNeural",
        "M2": "en-US-ChristopherNeural",
        "N": "en-US-JennyNeural",
        "DEFAULT": "en-US-JennyNeural",
    },
    "uk": {
        "W": "en-GB-SoniaNeural",
        "M": "en-GB-RyanNeural",
        "W2": "en-GB-LibbyNeural",
        "M2": "en-GB-RyanNeural",
        "N": "en-GB-SoniaNeural",
        "DEFAULT": "en-GB-SoniaNeural",
    },
    "au": {
        "W": "en-AU-NatashaNeural",
        "M": "en-AU-WilliamNeural",
        "W2": "en-AU-NatashaNeural",
        "M2": "en-AU-WilliamNeural",
        "N": "en-AU-NatashaNeural",
        "DEFAULT": "en-AU-NatashaNeural",
    },
}

SPEAKER_RE = re.compile(r"^\s*([A-Z]{1,2})\s*[:：]\s*(.+)$")

_AUDIO_LOCK = threading.Lock()
_LOCKS: dict[str, threading.Lock] = {}


class AudioUnavailable(RuntimeError):
    """edge-tts를 사용할 수 없을 때."""


def voice_set(value: str | None) -> dict:
    return VOICE_SETS.get((value or "us").lower(), VOICE_SETS["us"])


def split_lines(text: str) -> list[tuple[str, str]]:
    """'W: 문장' 형태의 대본을 (화자, 문장) 목록으로 나눈다."""
    out: list[tuple[str, str]] = []
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = SPEAKER_RE.match(line)
        if m:
            out.append((m.group(1), m.group(2).strip()))
        else:
            out.append(("N", line))
    return out


async def _synth_all(segments: list[tuple[str, str]], mapping: dict) -> bytes:
    audio = bytearray()
    for speaker, sentence in segments:
        voice = mapping.get(speaker) or mapping.get("DEFAULT")
        try:
            comm = edge_tts.Communicate(sentence, voice)
            async for chunk in comm.stream():
                if chunk.get("type") == "audio":
                    audio.extend(chunk["data"])
        except Exception:
            # 목소리 이름 문제 등 → 기본 목소리로 한 번 더
            comm = edge_tts.Communicate(sentence, mapping.get("DEFAULT"))
            async for chunk in comm.stream():
                if chunk.get("type") == "audio":
                    audio.extend(chunk["data"])
    return bytes(audio)


def synthesize(text: str, voice: str = "us") -> bytes:
    """대본 전체를 하나의 MP3 바이트로 합성한다."""
    if not HAS_EDGE_TTS:
        raise AudioUnavailable("edge-tts가 설치되어 있지 않습니다.")
    segments = split_lines(text)
    if not segments:
        raise AudioUnavailable("대본이 비어 있습니다.")
    mapping = voice_set(voice)
    import asyncio

    try:
        data = asyncio.run(_synth_all(segments, mapping))
    except AudioUnavailable:
        raise
    except Exception as exc:  # 네트워크 차단, 서비스 오류 등
        raise AudioUnavailable("음성 합성에 실패했습니다: %s" % exc) from exc
    if not data:
        raise AudioUnavailable("음성 데이터를 받지 못했습니다.")
    return data


def cache_key(text: str, voice: str) -> str:
    raw = ("v2|%s|%s" % (voice, text)).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:24]


def cache_path(audio_dir: str, text: str, voice: str) -> str:
    return os.path.join(audio_dir, "%s.mp3" % cache_key(text, voice))


def ensure_audio(audio_dir: str, text: str, voice: str = "us") -> str:
    """캐시에 없으면 합성해 저장하고 파일 경로를 돌려준다(동시 요청 안전)."""
    os.makedirs(audio_dir, exist_ok=True)
    path = cache_path(audio_dir, text, voice)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    with _AUDIO_LOCK:
        lock = _LOCKS.setdefault(path, threading.Lock())
    with lock:
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return path
        data = synthesize(text, voice)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return path
