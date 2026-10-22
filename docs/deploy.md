# 공용 서버 배포와 운영

실제 팀이 함께 쓰는 Orbit 서버 한 대를 띄우고 운영하는 문서다. 묶음은 `deploy/`와 `backend/Dockerfile`이다.

```
인터넷 ──443/80──▶ caddy (HTTPS 자동, Let's Encrypt)
                     │ 내부망
                     ▼
                  backend (uvicorn 1워커, 비루트 uid 10001)
                   │            │
                postgres     qdrant      ← 밖으로 열린 포트 없음
```

| 파일 | 역할 |
|---|---|
| `backend/Dockerfile` | 백엔드 이미지. `requirements.lock`으로 의존성 고정, 비루트, `/health` healthcheck |
| `backend/requirements.lock` | 운영 의존성 고정본(로컬 전체 시험과 같은 버전) |
| `deploy/docker-compose.prod.yml` | postgres 16.14, qdrant v1.18.2, backend, caddy 2.10.2. 모두 `restart: unless-stopped`, 데이터는 이름 붙은 볼륨 |
| `deploy/Caddyfile` | HTTPS, HSTS, `/docs`·`/openapi.json` 숨김, 역방향 프록시 |
| `deploy/.env.production.example` | 비밀값 키 이름만 |
| `deploy/backup.sh`, `deploy/restore.sh`, `deploy/qdrant_snapshot.py` | 백업과 복구 |

아래 명령은 서버의 `deploy/` 폴더에서 실행한다. 매번 길게 치지 않도록 별칭을 둔다.

```bash
alias oc='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

## 1. 서버 준비 (한 번)

권장: Ubuntu 24.04 LTS, 메모리 2GB 이상(아래 '사양' 참고).

```bash
# 1) 관리자 계정과 SSH 키. 비밀번호 로그인과 root 로그인을 끈다.
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# 2) 방화벽: 22·80·443만 연다. 공급자 콘솔의 방화벽(보안 그룹)도 같은 세 포트만 연다.
sudo ufw default deny incoming && sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable

# 3) 자동 보안 업데이트
sudo apt-get update && sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# 4) Docker Engine + compose 플러그인 (공식 저장소)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # 다시 로그인해야 적용

# 5) 2GB 서버는 스왑 2GB를 둔다(이미지 빌드·임베딩 백필 때 순간 메모리 대비)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

주의: Docker가 공개한 포트(`ports:`)는 ufw 규칙보다 먼저 iptables에 들어간다. 그래서 compose에서는 caddy의 80·443만 `ports:`로 열고, postgres·qdrant·backend에는 `ports:`를 두지 않았다. 디버깅하려고 `ports:`를 더하지 않는다. 필요하면 `oc exec`로 들어간다.

## 2. 처음 설치

1. DNS: 도메인의 A 레코드(IPv6면 AAAA)를 서버 공인 IP로 둔다. 인증서 발급 전에 전파돼야 한다(`dig +short <도메인>`).
2. 코드를 받는다: `git clone <저장소> /opt/orbit && cd /opt/orbit/deploy`
3. 비밀값(아래 3장)을 채운다.
4. 띄운다.

```bash
oc up -d --build
oc ps                       # backend 가 (healthy) 인지
curl -s https://<도메인>/health   # {"status":"ok"}
```

처음 기동하면 백엔드가 테이블을 만들고(`create_all`) 멱등 ALTER 러너(`app/db/migrations.py`)를 돌린다. 별도 마이그레이션 명령은 없다. 실패하면 백엔드가 뜨지 않으므로 `oc logs backend`를 본다.

5. 백업 cron(5장)을 건다.
6. 확장을 공용 주소로 빌드해 팀에 나눈다(4장).

## 3. 비밀값

- 서버의 `deploy/.env.production` 한 곳에만 둔다. 저장소, 채팅, 스크린샷, 이슈에 값을 올리지 않는다.
- `.gitignore`의 `.env.*` 규칙이 이 파일을 막는다(`.env.*.example`만 추적).

```bash
cp .env.production.example .env.production
chmod 600 .env.production          # 소유자만 읽기·쓰기
python3 -c "import secrets; print(secrets.token_hex(24))"       # POSTGRES_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # JWT_SECRET
```

- `POSTGRES_PASSWORD`는 접속 URL에 그대로 들어가므로 영숫자(`token_hex`)만 쓴다.
- `JWT_SECRET`은 로컬 개발 값과 다른 새 값이다. 바꾸면 모든 사용자가 다시 로그인한다.
- 기본값이 있는 키(`AXK1_BASE_URL` 등)를 `KEY=`처럼 빈 값으로 두면 기본값이 아니라 빈 문자열이 들어간다. 바꿀 때만 주석을 푼다.
- `DATABASE_URL`, `QDRANT_URL`은 compose가 내부 주소로 정한다. `.env.production`에 넣지 않는다.
- 비밀값 백업은 서버 밖 비밀번호 관리자 한 곳에 둔다. 서버를 잃으면 이 파일도 같이 잃는다.

## 4. CORS, 확장, 구글 로그인

### CORS

지금 `backend/app/main.py`는 `allow_origins=["*"]`다. 공용 서버에서는 설정값으로 좁힌다(제품 코드 반영 대기, GitHub main 통합 뒤 CTO가 반영).

- 새 설정 `CORS_ALLOW_ORIGINS`: 쉼표로 구분한 출처 목록. 기본값은 고정 확장 ID 하나 `chrome-extension://aghgamoeifieijjckhpfkmhiibacnhml`.
- 로컬 개발에서 웹 미리보기 출처가 필요하면 `.env`에 `http://localhost:5173`처럼 더한다. 공용 서버에는 넣지 않는다.
- 인증은 쿠키가 아니라 `Authorization: Bearer` 헤더라 `allow_credentials`는 끈 채로 둔다.

### 확장을 공용 주소로 빌드

```bash
cd extension
# extension/.env (커밋 금지). 셸 환경변수로 줘도 된다: VITE_API_BASE_URL=https://<도메인> pnpm build
#   VITE_API_BASE_URL=https://<도메인>
#   VITE_GOOGLE_CLIENT_ID=<Chrome 확장 유형 OAuth 클라이언트 ID>
pnpm build
# 빌드 결과에 공용 주소가 들어갔는지, localhost 가 남지 않았는지 확인
grep -rl "https://<도메인>" .output/chrome-mv3      # background.js 와 사이드패널 청크가 나와야 한다
grep -rl "localhost:8000" .output/chrome-mv3          # 아무것도 나오지 않아야 한다
```

- 확장 ID는 `wxt.config.ts`의 `key`로 고정돼 있어 어느 기기에서 빌드해도 `aghgamoeifieijjckhpfkmhiibacnhml`이다. 팀원은 `.output/chrome-mv3`를 압축 해제된 확장으로 불러온다.
- `VITE_API_BASE_URL`은 빌드할 때 박힌다. 주소를 바꾸면 다시 빌드해 다시 나눈다.
- `host_permissions`에는 지금 localhost만 있다. 서버가 CORS로 확장 출처를 허용하면 요청은 된다. 권한 경고 없이 깔끔하게 하려면 `host_permissions`에 `https://<도메인>/*`를 더하는 것을 검토한다(제품 코드 반영 대기).

### 구글 OAuth 운영 설정

로그인은 `chrome.identity.getAuthToken`(Chrome 확장 유형 OAuth 클라이언트)으로 받은 토큰을 백엔드가 검증하는 방식이다. 웹 리디렉션 흐름이 아니므로 "승인된 자바스크립트 출처"와 "승인된 리디렉션 URI"는 등록할 것이 없다.

- Google Cloud Console > 사용자 인증 정보 > OAuth 클라이언트(Chrome 확장 프로그램): 항목 ID `aghgamoeifieijjckhpfkmhiibacnhml`.
- 같은 클라이언트 ID를 서버 `GOOGLE_CLIENT_ID`와 확장 `VITE_GOOGLE_CLIENT_ID`에 둔다.
- OAuth 동의 화면이 "테스트" 상태면 테스트 사용자로 등록한 계정만 로그인된다(최대 100명). 팀원 계정을 모두 등록한다. 외부 공개(게시)는 구글 검토가 필요하므로 팀 사용 단계에서는 테스트 상태를 유지한다.
- 나중에 웹 화면을 공용 서버에서 직접 연다면 그때 웹 애플리케이션 유형 클라이언트를 따로 만들고 `https://<도메인>`을 출처로 등록한다.

## 5. 백업과 복구

`backup.sh`는 `deploy/backups/<UTC 시각>/`에 Postgres 덤프(`pg_dump -Fc`)와 Qdrant 컬렉션 스냅샷(컬렉션마다 한 파일)을 받는다. 파일 권한은 600, 폴더는 700이다. 빈 파일이 생기면 실패로 끝낸다. 최근 `KEEP`개(기본 14개, 하루 한 번이면 2주)만 남긴다.

```bash
crontab -e
30 3 * * * cd /opt/orbit/deploy && ./backup.sh >> backups/backup.log 2>&1
```

- 서버 디스크에만 있으면 서버를 잃을 때 같이 잃는다. 주 1회는 서버 밖으로 옮긴다(노트북으로 `scp`, 또는 공급자의 서버 스냅샷 기능 — 유료일 수 있어 대표 확인 뒤).
- 실측: 세션 2만 행 + 4096차원 벡터 1만 개에서 한 묶음이 209MB였다. 벡터가 대부분이다. 14개면 약 3GB이므로 디스크 60GB에서 여유가 있다. 데이터가 크게 늘면 `KEEP`을 줄인다.

복구(지금 데이터를 덮어쓴다):

```bash
./restore.sh backups/20261022T033000Z
```

순서: caddy·backend를 내림 → `pg_restore --clean --if-exists` → 백엔드 이미지로 일회성 컨테이너를 띄워 Qdrant 스냅샷 업로드 → backend·caddy 시작(시작할 때 멱등 마이그레이션이 다시 돌아 옛 백업에 없던 컬럼을 채운다). 중간에 실패하면 caddy와 backend를 내린 채로 멈추고 이유를 출력한다. 고친 뒤 다시 돌린다.

Postgres와 Qdrant 사본은 몇 초 차이로 받는다. 그 사이에 만들어진 세션은 벡터가 없을 수 있지만, 검색에서 빠질 뿐 데이터가 깨지지는 않는다.

## 6. 업데이트와 롤백

```bash
cd /opt/orbit && git fetch && git log --oneline HEAD..origin/main   # 무엇이 바뀌는지
cd deploy && ./backup.sh                                            # 업데이트 전 백업
PREV=$(git rev-parse --short HEAD)
git pull --ff-only
ORBIT_IMAGE_TAG=$(git rev-parse --short HEAD) oc up -d --build backend
oc ps && curl -s https://<도메인>/health
```

롤백:

```bash
git checkout "$PREV"
ORBIT_IMAGE_TAG="$PREV" oc up -d backend      # 그 태그 이미지가 남아 있으면 빌드 없이 뜬다
```

- 스키마는 컬럼 추가만 하는 멱등 러너라 코드를 되돌려도 새 컬럼은 남는다. 옛 코드는 모르는 컬럼을 무시하므로 보통 그대로 돌아간다.
- 새 버전이 데이터를 잘못 바꿨다면 업데이트 직전 백업으로 `restore.sh`.
- 오래된 이미지 정리: `docker image prune` (최근 몇 개 태그는 롤백용으로 남긴다).

## 7. 로그와 장애 대응

```bash
oc ps                          # 상태와 healthcheck
oc logs -f --tail 200 backend  # 백엔드
oc logs --tail 100 caddy       # 인증서 발급·프록시 오류
docker stats --no-stream       # 메모리
df -h                          # 디스크(백업이 쌓인다)
```

Docker 로그는 기본 json-file 드라이버라 무한히 쌓인다. `/etc/docker/daemon.json`에 한도를 둔다.

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

| 증상 | 먼저 볼 것 |
|---|---|
| `https://` 접속 안 됨, 인증서 오류 | `oc logs caddy`. DNS가 이 서버를 가리키는지, 80·443이 열려 있는지. 발급 실패를 반복하면 Let's Encrypt 실패 제한(시간당 5회)에 걸리니 원인을 고친 뒤 다시 띄운다 |
| 502 | backend가 죽었거나 기동 중. `oc logs backend` — 마이그레이션 실패면 부팅이 멈춘다 |
| 로그인 401 "google_client_id" | `.env.production`의 `GOOGLE_CLIENT_ID` 누락 |
| 검색만 안 됨 | qdrant 상태(`oc logs qdrant`), `UPSTAGE_API_KEY` |
| 요약이 안 생김 | AI 공급자 키·한도. 백엔드 로그의 공급자 오류 |
| 메모리 부족(OOM) | `docker stats`, `dmesg | grep -i oom`. 스왑 확인, 4GB로 올린다 |
| 서버 재부팅 뒤 | 모두 `restart: unless-stopped`라 Docker가 다시 띄운다(리허설에서 Docker 재시작 뒤 4개 모두 자동 복귀 확인) |

## 8. 사양과 비용

### 메모리 실측 (2026-10-22, 로컬 리허설)

| 상태 | caddy | backend | postgres | qdrant | 합계 |
|---|---|---|---|---|---|
| 빈 DB, 막 기동 | 14MiB | 131MiB | 30MiB | 198MiB | 약 375MiB |
| 세션 2만 행 + 벡터 1만 개(4096차원) 적재 직후 | 52MiB | 185MiB | 66MiB | 425MiB | 약 730MiB |
| 같은 데이터, 사용자 필터 검색 200회 뒤 | 52MiB | 185MiB | 66MiB | 323MiB | 약 630MiB |

- 디스크: qdrant 199MB, postgres 68MB(같은 데이터).
- 벡터 하나가 4096차원 float32라 원본만 16KB다. 벡터 1만 개마다 qdrant 메모리가 대략 150~250MB 는다.
- 권고: **팀 사용(사람 10명 안팎, 세션 수만 개 이하)은 2GB + 스왑 2GB로 충분하다.** OS·Docker 몫 약 300~400MB를 더해도 1.1GB 안쪽이다. 페이지 단위 벡터(세션당 벡터가 여러 개)를 켜거나 벡터가 5만 개를 넘으면 4GB로 올린다.
- 이미지 빌드는 서버에서 해도 2GB에서 된다(백엔드 이미지 약 97MB, 컴파일 없는 휠만 받는다).

### 운영 비용 (서버 말고)

- 도메인: 연 1~2만 원대(.com 기준, 등록업체마다 다름). 무료 대안은 아래 표.
- 인증서: Let's Encrypt 무료.
- AI API(A.X·EXAONE·Upstage): 사용량 비례. 공용 서버로 바뀌어도 단가는 같고, 사용자 수만큼 는다.

## 9. 도메인과 HTTPS 선택지

| 방식 | 비용 | Let's Encrypt | 장단점 |
|---|---|---|---|
| 도메인 구매(예: `orbit-xxx.com`) + A 레코드 | 연 1~2만 원대 | 됨(HTTP-01, Caddy 자동). 등록 도메인당 주 50장 | 가장 안정적. 서버를 옮겨도 주소가 같아 확장을 다시 빌드할 필요가 없다. 권장 |
| 무료 동적 DNS(DuckDNS 등의 하위 도메인) | 무료 | 됨 | 계정만 있으면 바로. 상위 도메인을 수많은 사용자가 공유하므로 서비스가 멈추거나 정책이 바뀌면 주소를 잃는다. 시연·임시용 |
| IP 기반 호스트명(`<IP>.sslip.io`, `nip.io`) | 무료 | 됨(이름이 도메인이므로) | 설정 0. IP가 바뀌면 주소도 바뀌어 확장을 다시 빌드해야 한다. 고정 IP(Lightsail 고정 IP 등)와 함께면 임시로 쓸 만하다 |
| IP 주소 자체에 인증서 | 무료 | 2026-01-15부터 정식 지원. 단 6일짜리 단기 인증서만 | Caddy에 `shortlived` 프로필 설정이 필요하고, Caddy에서 IP 식별자가 거절된 이슈 보고가 있다(caddy#7399). 지금은 권하지 않는다 |

참고: Let's Encrypt 제한(공식 문서) — 등록 도메인 또는 IPv4당 7일에 50장, 같은 이름 묶음 7일에 5장, 검증 실패 계정·이름당 시간당 5회.

## 10. 공급자 선택지 (2026-10-22 공식 페이지 확인)

| 후보 | 월 비용 | 사양 | 서울 리전 | 장단점 |
|---|---|---|---|---|
| **AWS Lightsail 2GB** | **$12** (IPv4 포함) | 2 vCPU, 2GB, SSD 60GB, 전송 3TB | 있음 | 고정 요금, 고정 IP 무료(붙어 있을 때), 콘솔이 쉬움. 서울이라 국내 지연이 낮다. 권장 |
| AWS Lightsail 4GB | $24 | 2 vCPU, 4GB, SSD 80GB, 전송 4TB | 있음 | 페이지 벡터를 켜거나 데이터가 커질 때. 2GB에서 콘솔로 올릴 수 있다(스냅샷→큰 인스턴스) |
| DigitalOcean Basic 2GB / 4GB | $12(1 vCPU) / $18(2 vCPU), 4GB $24 | SSD 50~80GB, 전송 2~4TB | 없음(가까운 곳 싱가포르) | 쉬움. 싱가포르라 지연 약 70~90ms. Lightsail보다 나은 점이 없다 |
| Hetzner CPX12 / CPX22 (싱가포르) | €15.99 / €26.99 (VAT 별도) | 1 vCPU 2GB / 2 vCPU 4GB, NVMe 40/80GB, 전송 0.5~1TB | 없음(싱가포르) | 유럽 리전은 매우 싸지만(€11.99/€19.99) 한국에서 멀다. 싱가포르는 전송량이 작고 비싸다. 페이지에 "생성 일시 불가" 표시가 있었다 |
| 네이버 클라우드(NCP) Server | 확인 못 함 | High CPU 2 vCPU/4GB 또는 Standard 2 vCPU/8GB | 있음 | 국내 결제·세금계산서, 국내 지원. 시간 단위 종량제이고 공인 IP가 별도일 수 있다. 공식 가격은 요금 계산기(로그인/동적 페이지)에서만 보여 이번에 숫자를 확인하지 못했다 |
| NHN Cloud / KT Cloud | 확인 못 함 | — | 있음 | 국내 사업자. 공식 요금표를 웹에서 확인하지 못했다. 고르게 되면 콘솔 계산기로 확인한다 |

- Vultr(서울 리전 있음)는 공식 가격 페이지가 403으로 막혀 제3자 자료만 보였다(2 vCPU/4GB $24 수준). 공식 확인 전이라 표에서 뺐다.
- 결제 통화·환율·부가세는 공급자마다 다르다. 위 달러 금액은 세금 별도다.

출처: aws.amazon.com/lightsail/pricing, digitalocean.com/pricing/droplets, hetzner.com/cloud/regular-performance, letsencrypt.org/docs/rate-limits, letsencrypt.org/2026/01/15/6day-and-ip-general-availability.

## 11. 대표 확인이 필요한 단계와 걸리는 시간

| 단계 | 누가 | 시간 |
|---|---|---|
| 공급자 계정·결제 수단 등록, 인스턴스 생성(Ubuntu 24.04, 서울, 2GB), 고정 IP 연결 | 대표(콘솔) | 15분 |
| 도메인 구매와 A 레코드 | 대표(등록업체) | 10분 + DNS 전파 수 분~1시간 |
| SSH 키 전달 | 대표 → CTO | 5분 |
| 1장 서버 준비, 2장 설치, 비밀값 입력, 백업 cron | CTO | 40~60분 |
| 확장 빌드·배포, 팀원 OAuth 테스트 사용자 등록, 로그인 확인 | CTO + 대표(OAuth 콘솔) | 30분 |

서버가 생긴 뒤 운영까지 약 1.5~2시간(DNS 전파 제외).

## 의존성 고정 갱신

`pyproject.toml`을 바꾸면 고정본도 다시 만든다. 로컬 시험 환경과 같은 버전으로 맞추는 것이 원칙이다.

```bash
cd backend
pip freeze > /tmp/local.txt   # 전체 시험이 통과한 환경에서
docker run --rm -v "$PWD:/src:ro" -v /tmp/local.txt:/c.txt:ro python:3.13.17-slim \
  sh -c "cp -r /src /b && cd /b && pip install -q -c /c.txt . && pip freeze --exclude orbit-backend"
# 출력을 requirements.lock 에 넣고(머리 주석은 유지) 이미지를 다시 빌드해 리허설한다
```
