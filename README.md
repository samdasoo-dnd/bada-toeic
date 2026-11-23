---
title: Bada TOEIC
emoji: 🌊
colorFrom: blue
colorTo: cyan
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: AI가 약점을 찾아주는 토익 학습 웹앱
---

# 🌊 바다토익 (BADA TOEIC)

산타토익 스타일의 **AI 토익 학습 웹앱**입니다. 진단 테스트로 현재 점수를 뽑고, 약점 유형을 골라 문제를 내주며,
LC 실제 음성·단어 암기/시험·문법 강의까지 한 화면에서 돌아갑니다.

- **PC·스마트폰 동시 사용**: 반응형 UI + QR로 폰에서 바로 접속
- **설치 부담 없음**: 파이썬 표준 라이브러리 기반 서버, 외부 CDN·이미지 없음(100% 오프라인 렌더링)
- **개인정보 안전**: 학습 기록·오답·단어장·Gemini API 키는 **브라우저 localStorage**에만 저장.
  서버는 공용 문제은행·음성 캐시만 보관하며 개인 기록을 저장하거나 로그에 남기지 않습니다.

## 주요 기능

| 구분 | 내용 |
| --- | --- |
| ① 진단 테스트 | Part 1~7 고르게 16문항 → 예상 LC/RC/총점(990), 목표 대비 부족분, 유형별 취약점 |
| ② 약점 공략 | 내장 문제은행 **86문항**(P1 8·P2 12·P3 12·P4 9·P5 24·P6 6·P7 15) + 약점 우선 추천 10문제 |
| ③ 파트 훈련 | Part 1~7 선택, 5~20문항, **⏱️ 타임어택**(Part 5 = 20초, Part 6 = 30초)과 문항별 소요 시간 자동 측정 |
| ④ LC 듣기 | `edge-tts` 신경망 음성(미국·영국·호주), 화자별 목소리, 0.85x/1.0x/1.15x, 스크립트·해석, **✍️ 빈칸 받아쓰기** |
| ⑤ 오답·단어 | 오답노트(맞히면 졸업), 틀린 문제 어휘 자동 저장, **필수 단어 130개 암기 → 시험 → 복기** |
| ⑥ 문법 강의 | 핵심 문법 **12강**(3줄 공식·함정 포인트·기출 패턴) + 해설에서 바로 연결 + AI 쉬운 재설명(선택) |
| ⑦ 독해 근거 | Part 7 정답 근거 문장을 지문에서 **형광펜 하이라이트**, 패러프레이징(동의어) 짝 표시 |
| ⑧ 성장 리포트 | 점수 추이, 파트·유형 정답률, 평균 풀이 시간, "맞혔지만 30초 초과" 문항 |
| ⑨ AI 무한 출제 | Gemini API 키(선택)를 넣으면 약점 맞춤 새 문제 생성·저장, 실패 시 내장 문제은행으로 자동 폴백 |
| ⑩ 인트로 | WebGL(GLSL) 실제 바다 사진풍 윤슬 — 가로 잔물결·중앙 윤슬 빛기둥·스타버스트 글린트 (1.25초) → 0.75초 크로스디졸브로 홈 화면 전환, WebGL 불가 기기는 Canvas 2D 폴백 |

## 실행 방법

### A. 내 PC에서 (Windows)

1. 압축을 풀고 `설치하기.bat` 더블클릭 (처음 한 번, 1~2분)
2. `실행하기.bat` 더블클릭 → 브라우저가 자동으로 열립니다 (`http://127.0.0.1:8768`)
3. 상단 **📱** 버튼 → QR을 폰 카메라로 찍으면 같은 와이파이의 폰에서 바로 접속

> Windows 방화벽 창이 뜨면 **개인 네트워크** 허용을 체크해야 폰에서 접속됩니다.

### B. 무료 클라우드 — Hugging Face Spaces (24시간 접속)

1. https://huggingface.co/new-space → **SDK: Docker**, Blank 선택
2. 이 폴더의 파일 전체를 업로드 (또는 `git push`)
   - `README.md` 맨 위의 `sdk: docker`, `app_port: 7860` 설정이 그대로 쓰입니다.
3. 빌드가 끝나면 `https://<사용자>-<스페이스>.hf.space` 주소가 생깁니다. PC를 꺼도 폰에서 접속됩니다.
   - 무료 CPU 플랜은 48시간 이상 미사용 시 잠들 수 있고, 접속하면 자동으로 깨어납니다(첫 응답에 수십 초).

### C. 무료 클라우드 — Render

1. https://render.com → **New + → Blueprint** → 이 저장소 선택 (`render.yaml` 자동 인식)
2. 무료 플랜은 약 15분 미사용 시 잠들며, 다시 접속하면 깨어납니다(첫 응답에 수십 초).

### D. 직접 실행 (macOS/Linux)

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PORT=8768 python backend/server.py
```

## 폰에서 쓰기 / 공유

- **클라우드 배포 시**: 상단 📱 → 지금 접속한 주소(`window.location.origin`)가 QR로 표시됩니다. 친구에게 그대로 공유 가능.
- **로컬 실행 시**: 📱 모달에 `http://192.168.x.x:8768` 형태의 같은 와이파이 주소가 함께 나옵니다.

## 내 기록 옮기기 (PC ↔ 폰)

`설정 → 내 학습 기록 내보내기(JSON)` → 폰에서 `설정 → 불러오기`.
기록·오답·단어 상태·시험 이력·설정(API 키 포함)이 한 파일에 담깁니다.

## Gemini API 키 (선택)

1. https://aistudio.google.com/apikey 에서 키 발급 (`AIza...`)
2. 앱 `설정 → Gemini API 키`에 입력 후 **키 확인**
- 키는 브라우저에만 저장되며, AI 요청 때마다 서버가 **그 요청 안에서만** 사용하고 즉시 버립니다.
- 서버는 키를 디스크·메모리·로그 어디에도 남기지 않습니다.

## 폴더 구조

```
바다토익/
├─ 설치하기.bat / 실행하기.bat      # Windows 로컬 실행
├─ 사용법.txt
├─ requirements.txt                 # edge-tts 만
├─ Dockerfile / render.yaml / README.md
├─ backend/
│  ├─ server.py                     # HTTP 서버 (표준 라이브러리)
│  ├─ toeic_engine.py               # 점수 산출·약점 분석·문제 선정·채점
│  ├─ question_bank.json            # 86문항 (해설·어휘·LC 대본·Part 7 근거)
│  ├─ vocab_bank.json               # 필수 단어 130 (13세트)
│  ├─ grammar_notes.json            # 핵심 문법 12강
│  ├─ audio_builder.py              # edge-tts 음성 생성·캐시
│  ├─ gemini_client.py              # Gemini 문제 생성·문법 설명
│  └─ qr.py                         # 순수 파이썬 QR 생성기
├─ frontend/
│  ├─ index.html / styles.css / main.js
│  ├─ splash.js                     # WebGL 윤슬 인트로 (Canvas 2D 폴백)
│  └─ qr.js                         # 순수 JS QR 생성기
└─ data/audio/                      # 생성된 LC 음성 캐시 (공용, 개인정보 없음)
```

## API 요약 (개인정보 저장 없음)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/health` | 상태·버전·TTS 가능 여부 |
| GET | `/api/bank` | 문제은행(정답·스크립트 숨김) |
| GET | `/api/diagnostic` | 진단 16문항 |
| POST | `/api/recommend` | 약점 기반 문제 추천 |
| POST | `/api/grade` | 채점(정답·해설·근거 반환) |
| POST | `/api/analyze` | 점수·유형·풀이시간 분석 |
| GET | `/api/vocab` · `/api/grammar` | 단어·문법 콘텐츠 |
| GET | `/api/audio/{id}.mp3` | LC 음성 (Range 지원, iOS 대응) |
| POST | `/api/audio/custom` | AI 지문·단어 발음 합성 |
| POST | `/api/ai/generate` · `/api/ai/test` · `/api/ai/explain` | Gemini(키는 요청 내 1회용) |
| GET | `/api/qr?text=` | QR SVG/매트릭스 |

## 라이선스

개인 학습용으로 자유롭게 사용·수정할 수 있습니다. 문제 콘텐츠는 학습 목적의 창작 예문입니다.
