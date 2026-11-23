# 🌊 바다토익 (BADA TOEIC) — Hugging Face Spaces(Docker) / Render 공용 이미지
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860 \
    HOST=0.0.0.0

WORKDIR /app

# 1) 파이썬 의존성 (경량: edge-tts 만)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 2) 앱 코드
COPY backend ./backend
COPY frontend ./frontend

# 3) 음성 캐시 폴더 (Space/Render 임시 디스크에 저장, 컨테이너 재시작 시 재생성)
RUN mkdir -p /app/data/audio && chmod -R 777 /app/data

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','7860')+'/api/health',timeout=4)"

CMD ["python", "backend/server.py"]
