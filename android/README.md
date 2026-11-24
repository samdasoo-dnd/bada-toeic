# 바다토익 Android 앱 (WebView 래퍼)

`https://bada-toeic.onrender.com` 을 그대로 감싸는 안드로이드 앱입니다.
웹 서비스(`backend/`, `frontend/`, `Dockerfile`)와는 완전히 분리되어 있어서
이 폴더가 추가되어도 Render/Docker 웹 배포에는 영향이 없습니다.

## 앱 정보

| 항목 | 값 |
|---|---|
| 앱 이름 | 바다토익 |
| applicationId | `com.donsik.badatoeic` |
| minSdk / targetSdk / compileSdk | 24 / 34 / 34 |
| versionCode / versionName | 4 / `1.0.3` |
| 빌드 | Gradle 8.7 · AGP 8.5.1 · Kotlin 1.9.24 · JDK 17 |
| 서명 | 고정 릴리스 키 (CN=BadaToeic, O=Donsik, C=KR) · 키 없으면 debug 폴백 |

## 동작

- 앱을 켜면 **0.1초 만에 내장 윤슬 인트로**(`app/src/main/assets/loading.html`)가 뜬다
  - `frontend/splash.js` 와 같은 WebGL 윤슬 셰이더(미지원 기기에서는 Canvas 2D 폴백)
  - 순백 `바다토익` 로고(화면 아래에서 60% 지점) + 하단 5가지 안내 문구가 5초마다 페이드 전환
    (`토익의 바다로 들어가는 중...` → `단어 파도를 타는 중...` → `문법 암초를 피해 항해하는 중...`
    → `리스닝 물결에 귀 기울이는 중...` → `만점 등대에 거의 다 왔어요!`)
  - 문구 아래 **출렁이는 파도 로딩바**: 캡슐 트랙 안의 물결이 실시간으로 일렁이며 왼쪽→오른쪽으로 차오른다
    (서버가 깨어나기 전 약 45초 기준 92%까지, `window.finishLoading()` 호출 시 0.4초 만에 100%)
- Render 무료 플랜 콜드 스타트 동안 메인 페이지를 바로 열지 않고,
  백그라운드 스레드에서 `GET /api/health` 를 **2초 간격·최대 70초** 두드린다
  - 502/503/타임아웃은 Render 가 깨어나는 중이므로 오류 화면 없이 계속 재시도
  - 200 이 오면 그때 `https://bada-toeic.onrender.com` 을 메인 WebView 로 연다
  - 메인 페이지 `onPageFinished` 후(인트로 최소 1.5초 노출) 파도를 100%로 채우고 오버레이를 페이드아웃
  - 오류 화면은 네트워크가 계속 끊겨 있을 때(연속 6회 실패≈12초) 또는 70초를 넘겼을 때만
- `localStorage`(`domStorageEnabled`), 쿠키, 혼합 콘텐츠 허용
- 학습 기록·API 키를 `SharedPreferences`(`bada_toeic_store`)에도 `commit()` 동기 저장
  (`BadaToeicAndroid.saveStore`/`loadStore`) — 앱을 껐다 켜도 유지
- LC 음성 자동 재생 (`mediaPlaybackRequiresUserGesture = false`)
- 오프라인·서버 오류 시 재시도 화면
- 뒤로가기: 웹 히스토리가 있으면 뒤로, 없으면 앱 종료
- 외부 링크는 기본 브라우저/해당 앱으로, `mailto:`·`tel:` 등도 외부 앱으로
- `confirm()`/`alert()` 는 네이티브 다이얼로그로 표시
- 학습 기록 JSON 내보내기(`blob:`)는 안드로이드 파일 저장 화면으로 이어짐
  (파일 이름은 웹앱이 정한 `바다토익_학습기록_YYYY-MM-DD.json`)

## 빌드

GitHub Actions 가 `.github/workflows/build-apk.yml` 로 자동 빌드합니다.
(Actions 탭 → **Build Android APK** → Run workflow, 또는 `android/**` 변경 push)

산출물: `bada-toeic-v1.0.3.apk`
- Actions 실행의 Artifacts(`bada-toeic-v1.0.3-apk`)
- Release 태그 `v1.0.3` 에도 첨부

## 서명 (고정 키)

Repository Secret 4개가 있으면 워크플로우가 `$RUNNER_TEMP/bada-toeic-release.p12` 로
키스토어를 복원하고 **release** 빌드를 그 키로 서명합니다.

| Secret | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `bada-toeic-release.p12` 를 base64 로 인코딩한 한 줄 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `badatoeic` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

로컬에서 같은 키로 빌드하려면:

```bash
export ANDROID_KEYSTORE_PATH=/경로/bada-toeic-release.p12
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=badatoeic
export ANDROID_KEY_PASSWORD=...
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

키스토어 원본은 저장소에 커밋하지 않습니다(백업: 워크스페이스 `work/bada_toeic_keystore/`).
키를 잃으면 이후 업데이트를 같은 서명으로 배포할 수 없어, 설치된 앱 위에 덮어쓰기가 불가능해집니다.

> 1.0.1 은 debug 키로 서명되어 있어 1.0.2(고정 키)를 덮어쓰려면 한 번 삭제 후 설치해야 합니다.
> 1.0.2 이후 업데이트(1.0.3 포함)부터는 고정 키 서명이 같아 삭제 없이 덮어쓰기 설치가 됩니다.

로컬 빌드:

```bash
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## 아이콘 재생성

```bash
pip install pillow
python3 android/tools/make_icons.py
```
