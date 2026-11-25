#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gemini_client 폴백 단위 테스트 (바다토익)

실행: python3 tests/test_gemini_fallback.py
- 503/404/타임아웃이 나면 같은 모델을 재시도하지 않고 다음 후보로 넘어가는지
- 모든 모델이 503이면 404가 아니라 '사용량이 몰리고 있습니다'로 안내하는지
- 실제 키로 한 번 호출해 정상 동작하는지(키는 인자·환경변수로만, 파일에 저장하지 않음)
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import gemini_client as gc  # noqa: E402

KEY = os.environ.get("GEMINI_KEY", "").strip()


def ok_data(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


GOOD_JSON = ('{"sets":[{"part":5,"questions":[{"type":"문법-시제","difficulty":2,'
             '"prompt":"The report ___ by Friday.","choices":["submitted","will be submitted",'
             '"submit","submitting"],"answer":1,"explanation":"미래 수동태입니다.",'
             '"translation":"보고서는 금요일까지 제출될 것이다."}]}]}')


class FakeResponse:
    """모델별로 정해진 응답(또는 오류)을 돌려주는 _request 대역."""

    def __init__(self, plan: dict, calls: list):
        self.plan = plan
        self.calls = calls

    def __call__(self, url, payload=None, api_key="", timeout=gc.REQUEST_TIMEOUT):
        model = url.split("/models/")[1].split(":")[0]
        self.calls.append((model, payload))
        action = self.plan.get(model, "ok")
        if action == "ok":
            return ok_data(GOOD_JSON)
        if action == "badjson":
            return ok_data("이건 JSON이 아닙니다")
        if action == "empty":
            return ok_data("   ")
        code = action
        status_map = {404: ("사용할 수 없는 모델입니다.", 404, 404),
                      429: ("Gemini 사용 한도를 초과했습니다.", 429, 429),
                      503: ("AI 사용량이 몰리고 있습니다.", 503, 503),
                      500: ("AI 사용량이 몰리고 있습니다.", 503, 500)}
        msg, status, code_n = status_map[code]
        raise gc.AIError(msg, status, code=code_n, retryable=True, busy=code in (429, 500, 503))


class FallbackTest(unittest.TestCase):
    def setUp(self):
        self.orig_request = gc._request
        self.orig_list = gc.list_models
        self.calls: list = []

    def tearDown(self):
        gc._request = self.orig_request
        gc.list_models = self.orig_list

    def run_gen(self, plan):
        gc._request = FakeResponse(plan, self.calls)
        return gc.generate_questions(KEY or "AQ." + "x" * 40, part=5, count=1)

    def test_503_falls_back_to_next_model(self):
        res = self.run_gen({"gemini-3.5-flash-lite": 503})
        self.assertEqual(res["model"], "gemini-flash-lite-latest")
        self.assertEqual([c[0] for c in self.calls],
                         ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"])
        self.assertEqual(res["count"], 1)

    def test_404_falls_back_to_next_model(self):
        res = self.run_gen({"gemini-3.5-flash-lite": 404})
        self.assertEqual(res["model"], "gemini-flash-lite-latest")

    def test_same_model_not_retried(self):
        self.run_gen({"gemini-3.5-flash-lite": 503})
        models = [c[0] for c in self.calls]
        self.assertEqual(len(models), len(set(models)), "같은 모델을 두 번 부르면 안 된다")

    def test_bad_json_falls_back(self):
        res = self.run_gen({"gemini-3.5-flash-lite": "badjson"})
        self.assertEqual(res["model"], "gemini-flash-lite-latest")

    def test_empty_text_falls_back(self):
        res = self.run_gen({"gemini-3.5-flash-lite": "empty"})
        self.assertEqual(res["model"], "gemini-flash-lite-latest")

    def test_all_busy_reports_busy_not_404(self):
        plan = {m: 503 for m in gc._model_order()}
        plan[gc._model_order()[-1]] = 404      # 마지막은 404 → 503 안내가 남아야 한다
        with self.assertRaises(gc.AIError) as ctx:
            self.run_gen(plan)
        self.assertEqual(ctx.exception.status, 503)
        self.assertIn("몰리고", str(ctx.exception))
        self.assertEqual([c[0] for c in self.calls], gc._model_order())

    def test_all_404_reports_model_missing(self):
        gc.list_models = lambda key: []      # 발견 조회는 하지 않은 것으로
        plan = {m: 404 for m in gc._model_order()}
        with self.assertRaises(gc.AIError) as ctx:
            self.run_gen(plan)
        self.assertIn("모델을 찾지 못했습니다", str(ctx.exception))
        self.assertEqual(len(self.calls), len(gc._model_order()))

    def test_invalid_key_stops_immediately(self):
        def boom(url, payload=None, api_key="", timeout=gc.REQUEST_TIMEOUT):
            self.calls.append(("x", None))
            raise gc.AIError("Gemini 키가 올바르지 않거나 권한이 없습니다.", 401, code=400)
        gc._request = boom
        with self.assertRaises(gc.AIError) as ctx:
            gc.generate_questions("AQ." + "x" * 40, part=5, count=1)
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(len(self.calls), 1)

    def test_explain_grammar_uses_same_fallback(self):
        gc._request = FakeResponse({"gemini-3.5-flash-lite": 503}, self.calls)
        gc._request.plan["gemini-flash-lite-latest"] = "explain"
        orig = gc._request.__call__

        def patched(url, payload=None, api_key="", timeout=gc.REQUEST_TIMEOUT):
            model = url.split("/models/")[1].split(":")[0]
            if model == "gemini-flash-lite-latest":
                self.calls.append((model, payload))
                return ok_data("쉬운 설명입니다.")
            return orig(url, payload, api_key, timeout)
        gc._request = patched
        res = gc.explain_grammar("AQ." + "x" * 40, "현재완료")
        self.assertEqual(res["model"], "gemini-flash-lite-latest")
        self.assertIn("쉬운 설명", res["text"])

    def test_timeout_falls_back(self):
        def slow_once(url, payload=None, api_key="", timeout=gc.REQUEST_TIMEOUT):
            model = url.split("/models/")[1].split(":")[0]
            if model == "gemini-3.5-flash-lite":
                self.calls.append((model, payload))
                raise gc.AIError("Gemini 응답이 너무 늦습니다.", 504, retryable=True)
            self.calls.append((model, payload))
            return ok_data(GOOD_JSON)
        gc._request = slow_once
        res = gc.generate_questions("AQ." + "x" * 40, part=5, count=1)
        self.assertEqual(res["model"], "gemini-flash-lite-latest")

    def test_truncated_answer_falls_back(self):
        """생각 토큰이 출력 한도를 다 써 잘린 답은 버리고 다음 모델로 간다."""
        def truncated_once(url, payload=None, api_key="", timeout=gc.REQUEST_TIMEOUT):
            model = url.split("/models/")[1].split(":")[0]
            self.calls.append((model, payload))
            if model == "gemini-3.5-flash-lite":
                return {"candidates": [{"content": {"parts": [{"text": "잘린 설"}]},
                                        "finishReason": "MAX_TOKENS"}]}
            return ok_data(GOOD_JSON)
        gc._request = truncated_once
        res = gc.generate_questions("AQ." + "x" * 40, part=5, count=1)
        self.assertEqual(res["model"], "gemini-flash-lite-latest")
        res2 = gc.explain_grammar("AQ." + "x" * 40, "현재완료")   # explain 경로도 같은 폴백
        self.assertEqual(res2["model"], "gemini-flash-lite-latest")


class LiveTest(unittest.TestCase):
    def setUp(self):
        if not KEY:
            self.skipTest("GEMINI_KEY 환경변수가 없어 실제 호출 테스트를 건너뜁니다")

    def test_generate_questions_live(self):
        res = gc.generate_questions(KEY, part=5, count=1)
        self.assertGreaterEqual(res["count"], 1)
        self.assertIn(res["model"], gc.MODEL_CANDIDATES)

    def test_explain_live(self):
        res = gc.explain_grammar(KEY, "현재완료")
        self.assertGreater(len(res["text"]), 50)
        self.assertIn(res["model"], gc.MODEL_CANDIDATES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
