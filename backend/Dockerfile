# Orbit 백엔드 운영 이미지. 빌드: docker build -t orbit-backend backend
FROM python:3.13.17-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 의존성 층을 소스와 분리해 소스만 바뀐 빌드는 캐시를 쓴다.
COPY requirements.lock ./
RUN pip install -r requirements.lock

# 패키지로 설치하지 않고 소스를 그대로 둔다(빌드 백엔드를 따로 받지 않으려고).
COPY app ./app
RUN useradd --system --uid 10001 --no-create-home orbit

USER orbit
EXPOSE 8000

# 이미지에 curl 이 없어 파이썬으로 확인한다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# 접근 로그는 끈다: 검색어·현재 탭 URL이 쿼리 문자열로 오므로 남기면 방문 기록이 로그에 쌓인다.
# 오류와 앱 로그는 그대로 남는다.
# 워커는 1개다. 시작 시 create_all·멱등 ALTER·주기 동기화 루프가 프로세스마다 돌기 때문에
# 여러 워커는 마이그레이션 경합과 동기화 중복을 만든다.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
