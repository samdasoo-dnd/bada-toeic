#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
바다토익 학습 엔진 (toeic_engine.py)
====================================

- 예상 점수 산출 (LC / RC / 총점, 990점 만점)
- 파트·세부유형별 취약점 분석
- 약점 우선 추천(오늘의 10문제) 및 파트별 집중 훈련 문제 선정
- 진단 테스트 구성 (Part 1~7 골고루 16문항)
- 오답노트 / 단어장 보조

표준 라이브러리만 사용합니다.
"""

from __future__ import annotations

import math
import random
from datetime import datetime

LC_PARTS = (1, 2, 3, 4)
RC_PARTS = (5, 6, 7)
ALL_PARTS = (1, 2, 3, 4, 5, 6, 7)

PART_TITLES = {
    1: "사진 묘사",
    2: "질의응답",
    3: "대화",
    4: "담화",
    5: "단문 빈칸",
    6: "장문 빈칸",
    7: "독해",
}

PART_TIPS = {
    1: "사람의 동작(be -ing)과 사물의 상태를 구분해 듣는 연습이 효과적입니다.",
    2: "의문사(When/Where/Who/Why/How)에 맞는 응답 유형을 먼저 잡으세요.",
    3: "대화의 목적·다음 행동·세부 숫자를 메모하며 듣는 훈련이 필요합니다.",
    4: "담화 첫 문장에서 주제를 잡고, 안내되는 조건(시간·장소·대상)을 표시하세요.",
    5: "시제·수일치·품사 자리는 단기간에 점수를 올리기 가장 좋은 구간입니다.",
    6: "지문 전체 흐름(문법·접속사·문장 삽입)을 먼저 파악한 뒤 빈칸을 보세요.",
    7: "질문의 키워드를 지문에서 먼저 찾는 '스캐닝' 순서를 지키세요.",
}

# 진단 테스트 구성: (파트, 문항 수). P3·P4·P7은 한 세트(3문항)씩, P6은 1문항.
DIAGNOSTIC_PLAN = [(1, 2), (2, 2), (3, 3), (4, 3), (5, 2), (6, 1), (7, 3)]

# 같은 지문/음성을 공유하는 묶음 유형
GROUPED_PARTS = (3, 4, 6, 7)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def diff_weight(difficulty) -> float:
    try:
        d = int(difficulty)
    except (TypeError, ValueError):
        d = 2
    return {1: 1.0, 2: 1.12, 3: 1.3}.get(d, 1.12)


# ---------------------------------------------------------------------------
# 점수 산출
# ---------------------------------------------------------------------------
def _section_score(records: list[dict]) -> int | None:
    """가중 정답률 → 5~495점 환산 (난이도 가중 + 소표본 보정)."""
    recs = [r for r in records if r.get("correct") is not None]
    if not recs:
        return None
    wsum = sum(diff_weight(r.get("difficulty")) for r in recs)
    csum = sum(diff_weight(r.get("difficulty")) for r in recs if r.get("correct"))
    # 문항이 적을 때 극단값이 나오지 않도록 55% 지점으로 약하게 당겨 줌
    #   (많이 풀수록 보정이 사라지고, 전부 정답이면 만점 495가 나온다)
    prior_w = 3.0 if wsum < 3 else max(0.0, 3.0 - (wsum - 3) * 0.25)
    if csum >= wsum - 1e-9:
        acc = 1.0
    else:
        acc = (csum + prior_w * 0.55) / (wsum + prior_w) if (wsum + prior_w) else 0.0
    score = 5 + 490 * (acc ** 0.62)
    return int(max(5, min(495, round(score / 5.0) * 5)))


def estimate(records: list[dict]) -> dict:
    lc_recs = [r for r in records if int(r.get("part", 0)) in LC_PARTS]
    rc_recs = [r for r in records if int(r.get("part", 0)) in RC_PARTS]
    lc = _section_score(lc_recs)
    rc = _section_score(rc_recs)
    total = None
    if lc is not None and rc is not None:
        total = lc + rc
    elif lc is not None:
        total = lc
    elif rc is not None:
        total = rc
    answered = len(records)
    margin = max(20, min(120, int(round(190 / math.sqrt(max(answered, 1))))))
    return {
        "lc": lc,
        "rc": rc,
        "total": total,
        "margin": margin,
        "answered": answered,
        "lc_answered": len(lc_recs),
        "rc_answered": len(rc_recs),
    }


def score_band(total: int | None, margin: int) -> list[int] | None:
    if total is None:
        return None
    return [max(10, total - margin), min(990, total + margin)]


# ---------------------------------------------------------------------------
# 통계
# ---------------------------------------------------------------------------
def _acc(recs: list[dict]) -> float:
    if not recs:
        return 0.0
    return sum(1 for r in recs if r.get("correct")) / len(recs)


def _timing(recs: list[dict]) -> dict:
    times = [float(r.get("time_ms") or 0) / 1000.0 for r in recs if float(r.get("time_ms") or 0) > 0]
    avg = round(sum(times) / len(times), 1) if times else None
    slow = sum(1 for r in recs if r.get("correct") and float(r.get("time_ms") or 0) > 30000)
    over = sum(1 for r in recs if float(r.get("time_ms") or 0) > 30000)
    return {"timed": len(times), "avg_sec": avg, "slow_correct": slow, "over_30s": over}


def part_stats(records: list[dict]) -> list[dict]:
    out = []
    for p in ALL_PARTS:
        recs = [r for r in records if int(r.get("part", 0)) == p]
        out.append({
            "part": p,
            "title": PART_TITLES[p],
            "attempted": len(recs),
            "correct": sum(1 for r in recs if r.get("correct")),
            "accuracy": round(_acc(recs) * 100, 1) if recs else None,
            "tip": PART_TIPS[p],
            "timing": _timing(recs),
        })
    return out


def type_stats(records: list[dict]) -> list[dict]:
    buckets: dict[str, dict] = {}
    for r in records:
        t = str(r.get("type") or "기타")
        b = buckets.setdefault(t, {"type": t, "part": int(r.get("part", 0)),
                                   "attempted": 0, "correct": 0, "last": ""})
        b["attempted"] += 1
        if r.get("correct"):
            b["correct"] += 1
        b["last"] = max(b["last"], str(r.get("at", "")))
    out = []
    for b in buckets.values():
        acc = b["correct"] / b["attempted"] if b["attempted"] else 0.0
        # 적게 풀었지만 틀린 유형도 취약 후보로 올라오게 표본 보정
        weakness = (1.0 - acc) * math.log(1 + b["attempted"]) + 0.15 / (1 + b["attempted"])
        recs = [r for r in records if str(r.get("type") or "기타") == b["type"]]
        out.append({
            "type": b["type"],
            "part": b["part"],
            "title": PART_TITLES.get(b["part"], ""),
            "attempted": b["attempted"],
            "correct": b["correct"],
            "accuracy": round(acc * 100, 1),
            "weakness": round(weakness, 3),
            "timing": _timing(recs),
            "last": b["last"],
        })
    out.sort(key=lambda x: (-x["weakness"], -x["attempted"]))
    return out


def weak_profile(records: list[dict], limit: int = 5) -> list[dict]:
    stats = [s for s in type_stats(records) if s["attempted"] >= 1]
    return stats[:limit]


# ---------------------------------------------------------------------------
# 문제 선정
# ---------------------------------------------------------------------------
def _recent_ids(records: list[dict], window: int = 40) -> set[str]:
    return {str(r.get("id")) for r in records[-window:]}


def _unit_map(questions: list[dict]) -> dict[str, list[dict]]:
    """group_id 기준 묶음(unit) 구성. 지문을 공유하는 문항은 함께 출제."""
    units: dict[str, list[dict]] = {}
    for item in questions:
        gid = item.get("group_id")
        key = "g:" + gid if (gid and int(item["part"]) in GROUPED_PARTS) else "q:" + item["id"]
        units.setdefault(key, []).append(item)
    return units


def _pick_groups(by_part_type: dict, part: int, count: int, rng: random.Random) -> list[dict]:
    """파트별로 count 문항을 묶음 단위로 뽑기."""
    pool = _unit_map(by_part_type[part])
    keys = list(pool.keys())
    rng.shuffle(keys)
    picked: list[dict] = []
    for key in keys:
        if len(picked) >= count:
            break
        picked.extend(sorted(pool[key], key=lambda x: x["id"]))
    return picked


def build_diagnostic(questions: list[dict], seed: int | None = None) -> list[dict]:
    rng = random.Random(seed)
    by_part = {p: [x for x in questions if int(x["part"]) == p] for p in ALL_PARTS}
    chosen: list[dict] = []
    for part, count in DIAGNOSTIC_PLAN:
        picked = _pick_groups(by_part, part, count, rng)
        if part == 6:
            picked = picked[:1]  # 장문 빈칸은 대표 1문항만
        chosen.extend(picked)
    # 난이도 순으로 섞어 쉬운 문항부터 자연스럽게
    return sorted(chosen, key=lambda x: (int(x["part"]), diff_weight(x.get("difficulty"))))


def _type_priority(records: list[dict]) -> tuple[dict[str, float], dict[str, float]]:
    """유형별 우선순위(취약도)와 파트별 우선순위."""
    ts = type_stats(records)
    prio = {s["type"]: s["weakness"] for s in ts}
    ps: dict[int, float] = {}
    for s in ts:
        ps[s["part"]] = ps.get(s["part"], 0.0) + s["weakness"]
    return prio, ps


def choose_practice(questions: list[dict], records: list[dict], count: int = 10,
                    part: int | None = None, seed: int | None = None) -> list[dict]:
    """약점 우선 추천. part를 주면 해당 파트 집중 훈련."""
    rng = random.Random(seed)
    recent = _recent_ids(records)
    wrong_ids = {str(r.get("id")) for r in records if r.get("correct") is False}
    prio_types, prio_parts = _type_priority(records)

    pool = [x for x in questions if part is None or int(x["part"]) == part]
    if not pool:
        pool = list(questions)

    units = _unit_map(pool)
    ranked: list[tuple[float, str, list[dict]]] = []
    for key, items in units.items():
        head = items[0]
        t = head.get("type", "")
        p = int(head["part"])
        score = 0.0
        score += prio_types.get(t, 0.4) * 3.0           # 유형 취약도
        score += prio_parts.get(p, 0.3) * 0.8            # 파트 취약도
        score += 0.9 if any(str(i["id"]) in wrong_ids for i in items) else 0.0
        score += 0.5 if all(str(i["id"]) not in recent for i in items) else 0.0
        score += rng.random() * 1.4                      # 다양성
        ranked.append((score, key, sorted(items, key=lambda x: x["id"])))
    ranked.sort(key=lambda x: -x[0])

    picked: list[dict] = []
    for _, _, items in ranked:
        if len(picked) >= count:
            break
        picked.extend(items)
    if len(picked) < count:  # 부족하면 반복 채우기(가장 최근 문항 제외)
        extra = [x for x in pool if str(x["id"]) not in recent]
        rng.shuffle(extra)
        for item in extra:
            if len(picked) >= count:
                break
            picked.append(item)
    # 파트 순으로 정렬해 지문/음성 흐름을 자연스럽게
    return picked


def pick_wrong_retry(wrong_notes: list[dict], count: int = 10) -> list[dict]:
    notes = sorted([n for n in wrong_notes if not n.get("graduated")],
                   key=lambda n: str(n.get("last_wrong", "")))
    return notes[:count]


# ---------------------------------------------------------------------------
# 세션 결과 요약
# ---------------------------------------------------------------------------
def summarize_session(answers: list[dict], records_all: list[dict], target: int) -> dict:
    """answers: [{id, part, type, difficulty, correct}]"""
    est = estimate(records_all)
    band = score_band(est["total"], est["margin"])
    return {
        "answered": len(answers),
        "correct": sum(1 for a in answers if a.get("correct")),
        "accuracy": round(_acc(answers) * 100, 1) if answers else 0.0,
        "estimate": est,
        "band": band,
        "gap": (target - est["total"]) if (est["total"] is not None and target) else None,
        "parts": part_stats(answers),
        "types": type_stats(answers),
        "weak": weak_profile(records_all, 5),
        "at": now_iso(),
    }


def level_label(total: int | None) -> str:
    if total is None:
        return "진단 전"
    if total >= 900:
        return "만점 사냥꾼"
    if total >= 800:
        return "바다 고수"
    if total >= 700:
        return "파도 타는 중"
    if total >= 600:
        return "물 만난 학습자"
    if total >= 500:
        return "수영 시작"
    return "발 담그기"


def goal_gap_message(total: int | None, target: int) -> str:
    if total is None:
        return "먼저 16문항 진단 테스트로 현재 위치를 확인해 보세요."
    gap = target - total
    if gap <= 0:
        return "목표 점수를 이미 넘었습니다! 유지 훈련으로 감을 지켜요."
    if gap <= 50:
        return "목표까지 %d점, 파트별 실수만 줄이면 충분합니다." % gap
    if gap <= 150:
        return "목표까지 %d점, 취약 유형 2~3개만 잡으면 닿습니다." % gap
    return "목표까지 %d점, 매일 10문제씩 꾸준히 쌓아 갑시다." % gap


# ---------------------------------------------------------------------------
# 공개용(정답 숨김) 변환 · 채점 · 분석 — 서버에서 사용
# ---------------------------------------------------------------------------
READING_KINDS = {"email", "advertisement", "notice", "article", "chat", "double", "report", "memo"}


def public_passage(passage: dict | None, reveal: bool = False) -> dict | None:
    """LC 대본은 정답 확인 전까지 숨기고, 독해 지문은 바로 보여 준다."""
    if not passage:
        return None
    kind = str(passage.get("kind") or "")
    show_text = reveal or kind in READING_KINDS
    out = {
        "id": passage.get("id") or "",
        "kind": kind,
        "is_script": kind not in READING_KINDS,
        "speakers": passage.get("speakers") or [{"id": "W"}, {"id": "M"}],
    }
    if show_text:
        out["text"] = passage.get("text") or ""
    if reveal:
        out["translation"] = passage.get("translation") or ""
    return out


def public_question(item: dict, passages: dict, reveal: bool = False) -> dict:
    out = {
        "id": item["id"],
        "part": int(item["part"]),
        "type": item.get("type", ""),
        "difficulty": int(item.get("difficulty", 2)),
        "prompt": item.get("prompt", ""),
        "choices": list(item.get("choices") or []),
        "hidden_choices": bool(item.get("hidden_choices")),
        "source": item.get("source", "bank"),
    }
    if item.get("svg"):
        out["svg"] = item["svg"]
    gid = item.get("group_id")
    if gid:
        out["group_id"] = gid
        psg = public_passage(passages.get(gid), reveal=reveal)
        if psg:
            out["passage"] = psg
    if reveal:
        out["answer"] = int(item["answer"])
        out["explanation"] = item.get("explanation", "")
        out["translation"] = item.get("translation", "")
        out["vocabulary"] = item.get("vocabulary") or []
        if item.get("evidence_quote"):
            out["evidence_quote"] = item["evidence_quote"]
        if item.get("paraphrase_pair"):
            out["paraphrase_pair"] = item["paraphrase_pair"]
    return out


def grade(answers: list[dict], bank_index: dict, passages: dict) -> list[dict]:
    """[{id, choice}] → 채점 결과(정답·해설 포함). 모르는 id는 건너뛴다."""
    results = []
    for ans in answers or []:
        qid = str(ans.get("id") or "")
        item = bank_index.get(qid)
        if not item:
            continue
        try:
            choice = int(ans.get("choice"))
        except (TypeError, ValueError):
            choice = -1
        correct = choice == int(item["answer"])
        pub = public_question(item, passages, reveal=True)
        pub["chosen"] = choice
        pub["correct"] = correct
        results.append(pub)
    return results


def analyze(records: list[dict], target: int = 800) -> dict:
    """누적 기록 → 예상 점수·취약 분석 묶음."""
    target = int(target or 800)
    est = estimate(records)
    band = score_band(est["total"], est["margin"])
    slow_items = [str(r.get("id")) for r in records
                  if r.get("correct") and float(r.get("time_ms") or 0) > 30000][-20:]
    return {
        "estimate": est,
        "band": band,
        "timing": _timing(records),
        "slow_items": slow_items,
        "target": target,
        "gap": (target - est["total"]) if est["total"] is not None else None,
        "level": level_label(est["total"]),
        "message": goal_gap_message(est["total"], target),
        "parts": part_stats(records),
        "types": type_stats(records),
        "weak": weak_profile(records, 5),
        "at": now_iso(),
    }
