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
| versionCode / versionName | 1 / `1.0.0` |
| 빌드 | Gradle 8.7 · AGP 8.5.1 · Kotlin 1.9.24 · JDK 17 |

## 동작

- 첫 화면에서 바로 `https://bada-toeic.onrender.com` 로드
- Render 무료 플랜 콜드 스타트(최대 50초) 동안 딥 블루(`#061124`) 로딩 화면과 진행률 표시
- `localStorage`(`domStorageEnabled`), 쿠키, 혼합 콘텐츠 허용 — 학습 기록이 그대로 유지됨
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

산출물: `bada-toeic-v1.0.0.apk`
- Actions 실행의 Artifacts(`bada-toeic-v1.0.0-apk`)
- Release 태그 `v1.0.0` 에도 첨부

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
