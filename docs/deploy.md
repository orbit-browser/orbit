# 공용 서버 배포와 운영

실제 팀이 함께 쓰는 Orbit 서버 한 대를 띄우고 운영하는 문서다. 묶음은 `deploy/`와 `backend/Dockerfile`이다.

```
인터넷 ──443/80──▶ caddy (HTTPS 자동, Let's Encrypt, 접근 로그 없음, 본문 5MB 상한)
                     │ edge 망
                     ▼
                  backend (uvicorn 1워커, 비루트 uid 10001, 읽기 전용, 권한 없음)
                   │ data 망(internal, 밖으로 못 나감)
                postgres     qdrant      ← 밖으로 열린 포트 없음, caddy 에서 닿지 않음
```

같은 묶음을 클라우드 서버(아래 1~7장)와 노트북 모드(12장)에서 쓴다. 차이는 env 파일 하나다.

| 파일 | 역할 |
|---|---|
| `backend/Dockerfile` | 백엔드 이미지. `requirements.lock`으로 의존성 고정, 비루트, `/health` healthcheck |
| `backend/requirements.lock` | 운영 의존성 고정본(로컬 전체 시험과 같은 버전) |
| `deploy/docker-compose.prod.yml` | postgres 16.14, qdrant v1.18.2, backend, caddy 2.10.2. 모두 `restart: unless-stopped`, 데이터는 이름 붙은 볼륨 |
| `deploy/Caddyfile` | HTTPS, HSTS, `/docs`·`/openapi.json` 숨김, 역방향 프록시 |
| `deploy/.env.production.example` | 클라우드 서버 비밀값 키 이름만 |
| `deploy/.env.laptop.example` | 노트북 모드 설정(127.0.0.1, HTTP, 별도 프로젝트 이름) |
| `deploy/backup.sh`, `deploy/restore.sh`, `deploy/qdrant_snapshot.py` | 백업과 복구 |

아래 명령은 서버의 `deploy/` 폴더에서 실행한다. 매번 길게 치지 않도록 별칭을 둔다.

```bash
alias oc='docker compose -f docker-compose.prod.yml --env-file .env.production'
```

## 1. 서버 준비 (한 번)

권장: Ubuntu 24.04 LTS, 메모리 2GB 이상(아래 '사양' 참고).

```bash
# 1) 관리자 계정과 SSH 키. 비밀번호 로그인과 root 로그인을 끈다.
#    끄기 전에 새 터미널 창에서 키로 로그인되는지 먼저 확인한다(잠김 방지). 지금 창은 닫지 않는다.
#    Ubuntu 클라우드 이미지는 /etc/ssh/sshd_config.d/*.conf 를 먼저 읽고 처음 값이 이기므로 그쪽에 둔다.
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/00-orbit.conf
sudo systemctl restart ssh
sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '   # 모두 no 여야 한다

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

**관문: CORS 설정화(4장, `fix/cors-config`)가 들어간 커밋에서만 `oc up` 한다.** 그 전 코드는 `allow_origins=["*"]`라 공개 주소가 생기면 아무 웹페이지나 브라우저에서 API를 두드릴 수 있다. 확인: `grep -n "allow_origins" ../backend/app/main.py`가 `parse_cors_origins(...)`를 보여야 하고 `"*"`가 없어야 한다.

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

### 키 교체

| 키 | 순서 | 영향 |
|---|---|---|
| `POSTGRES_PASSWORD` | 볼륨을 처음 만들 때만 적용된다. env만 바꾸면 backend가 접속하지 못한다. ① `oc exec postgres psql -U orbit -d orbit -c "ALTER USER orbit PASSWORD '<새 값>'"` ② `.env.production` 값 교체 ③ `oc up -d backend` | 없음(몇 초 재시작) |
| `JWT_SECRET` | 값 교체 → `oc up -d backend` | 발급된 모든 토큰 무효, 전원 재로그인. JWT는 30일 무상태라 이것이 유일한 일괄 폐기 수단이다 |
| AI 키 3개(A.X, Friendli, Upstage) | 공급자 콘솔에서 새 키 발급 → env 교체 → `oc up -d backend` → 옛 키 폐기 | 없음 |

### 보안 사고 대응 (유출 의심 시)

1. 무엇이 샜는지 정한다: 서버 접근(SSH), `.env.production`, 백업 사본, 팀원 토큰.
2. 키를 바로 바꾼다: 위 표 순서. `.env.production`이 샜다면 전부, 토큰만 샜다면 `JWT_SECRET`.
3. 서버 접근이 의심되면 공급자 콘솔에서 SSH 키를 교체하고 `last`, `journalctl -u ssh`로 접속 기록을 본다. 확신이 없으면 새 서버에 백업으로 다시 세운다(13장 순서).
4. 팀원에게 공지한다(재로그인 필요, 무엇이 노출됐을 수 있는지). 기록이 노출됐다면 대표가 공지 범위를 정한다.

## 4. CORS, 확장, 구글 로그인

### CORS

허용 출처는 설정값 `CORS_ALLOW_ORIGINS`로 정한다(`backend/app/config.py`의 `parse_cors_origins`).

- 쉼표로 구분한 출처 목록. 기본값은 고정 확장 ID 하나 `chrome-extension://aghgamoeifieijjckhpfkmhiibacnhml`. 값을 비우거나 `*`를 넣어도 `*`로 열리지 않고 이 기본값으로 돌아간다.
- 허용하지 않은 출처의 요청에는 `Access-Control-Allow-Origin` 헤더가 붙지 않는다(`tests/test_cors.py`).
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

- 서버 디스크에만 있으면 서버를 잃을 때 같이 잃는다. 주 1회는 서버 밖(대표 노트북)으로 옮긴다(대표 결정 10-23: 수동 복사).
- `backup.log`는 회전하지 않는다. 한 줄씩이라 커지지 않지만 가끔 비운다.

### 서버 밖 사본은 반드시 암호화한다

백업 한 묶음에는 모든 사용자의 세션, 페이지 본문 발췌, 임베딩이 들어 있다. 평문으로 노트북에 두면 노트북 분실이나 동기화 폴더 하나로 전원의 방문 기록이 샌다. [age](https://github.com/FiloSottile/age)로 암호화한다. 공개키는 서버에, **개인키는 서버에 두지 않고** 대표의 비밀번호 관리자에만 둔다.

```bash
# 한 번(대표 노트북): brew install age && age-keygen -o orbit-backup.key
#   출력의 "public key: age1..." 를 서버 deploy/backup.pub 에 한 줄로 둔다(공개키라 비밀 아님).
#   orbit-backup.key(개인키)는 비밀번호 관리자에 넣고 노트북 파일은 지운다.
# 서버(age 설치: sudo apt-get install -y age):
STAMP=$(ls -1 backups | grep '^2' | tail -1)
tar -C backups -c "$STAMP" | age -R backup.pub > "orbit-$STAMP.tar.age"
# 노트북:
scp <서버>:/opt/orbit/deploy/orbit-<STAMP>.tar.age ~/OrbitBackups/
ssh <서버> rm /opt/orbit/deploy/orbit-<STAMP>.tar.age
```

공급자의 서버 스냅샷 기능을 쓰게 되면 그 스냅샷도 같은 데이터(평문 DB 포함)라는 점을 기억한다.
- 실측: 세션 2만 행 + 4096차원 벡터 1만 개에서 한 묶음이 209MB였다. 벡터가 대부분이다. 14개면 약 3GB이므로 디스크 60GB에서 여유가 있다. 데이터가 크게 늘면 `KEEP`을 줄인다.

복구(지금 데이터를 덮어쓴다):

```bash
./restore.sh backups/20261022T033000Z
```

암호화된 사본으로 복구할 때(서버를 새로 세운 경우 포함):

```bash
# 개인키를 비밀번호 관리자에서 잠깐 꺼내 서버 밖(노트북)에서 풀고, 풀린 묶음만 올린다.
age -d -i orbit-backup.key orbit-<STAMP>.tar.age | ssh <서버> "tar -C /opt/orbit/deploy/backups -x"
rm orbit-backup.key                       # 꺼낸 개인키 파일을 바로 지운다
ssh <서버> "cd /opt/orbit/deploy && ./restore.sh backups/<STAMP>"
```

`restore.sh`는 덮어쓰기 전에 지금 상태를 `pre-restore-<시각>` 묶음으로 한 번 받는다. 정기 정리는 날짜 이름(`2*`) 묶음만 지우므로 이 묶음은 직접 지울 때까지 남는다. 복구가 잘 됐으면 확인 뒤 지운다. 백업 자체가 안 되는 망가진 서버에서만 `SKIP_SAFETY_BACKUP=1`로 건너뛴다.

순서: 안전 백업 → caddy·backend를 내림 → `pg_restore --clean --if-exists` → 백엔드 이미지로 일회성 컨테이너를 띄워 Qdrant 스냅샷 업로드 → backend·caddy 시작(시작할 때 멱등 마이그레이션이 다시 돌아 옛 백업에 없던 컬럼을 채운다). 중간에 실패하면 caddy와 backend를 내린 채로 멈추고 이유를 출력한다. 고친 뒤 다시 돌린다.

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

### 이미지 패치 주기

unattended-upgrades는 호스트 OS만 고친다. 컨테이너 이미지(python, postgres, qdrant, caddy)는 직접 올린다.

- 월 1회(또는 보안 공지 때): 각 이미지의 같은 줄 최신 패치 태그를 확인한다(예: `postgres:16.14` → `16.x`, `caddy:2.10.x`, `python:3.13.x-slim`).
- `./backup.sh` → `docker-compose.prod.yml`/`Dockerfile` 태그 수정 → 로컬 리허설 → 커밋 → 서버에서 `oc pull && oc up -d --build`.
- postgres는 같은 주 버전(16) 안에서만 태그를 올린다. 주 버전 업그레이드는 덤프·복구가 필요한 별도 작업이다.
- qdrant는 백엔드 `qdrant-client`와 호환되는 버전인지 확인한다(클라이언트와 서버 부 버전 차이가 1 이내).

## 7. 로그와 장애 대응

접근 로그는 남기지 않는다. Caddy에 `log` 블록이 없고 uvicorn은 `--no-access-log`로 돈다. `/search?q=`, `/recommendations?current_url=`처럼 검색어와 지금 보는 탭 URL이 쿼리 문자열로 오기 때문이다. 오류와 앱 로그만 남는다. 로그를 채팅이나 이슈에 붙일 때도 URL과 검색어가 섞이지 않았는지 본다. 접근 기록이 꼭 필요해지면 쿼리를 지우는 필터를 넣은 뒤에 켠다.

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
- **공급자 콘솔 세 곳(A.X, Friendli, Upstage)에 월 사용 한도나 사용량 알림을 건다.** 앱에는 사용자별 속도 제한이 없어서 팀원 토큰 하나가 새거나 스크립트가 반복 호출하면 `/ask/stream`, `/search?rerank=true`, `/assistant/route`가 LLM·임베딩을 제한 없이 부른다.

### OAuth 게시 전 안건 (대표 결정 필요, 지금은 하지 않음)

지금 공개 가입을 막는 것은 OAuth 동의 화면의 "테스트" 상태(등록한 테스트 사용자만 토큰을 받음)와 `aud` 검사뿐이다. 팀 단계에서는 이것으로 충분하다. 동의 화면을 "게시"로 바꾸기 전에 다음 둘을 정한다. 둘 다 인증·API 정책 변경이다.

- 서버 쪽 허용 목록: `ALLOWED_EMAILS` 또는 허용 도메인.
- 사용자별 속도 제한: 특히 LLM을 부르는 경로.

## 9. 도메인과 HTTPS 선택지

대표 결정(10-23): 클라우드에서는 무료 주소(sslip.io 또는 DuckDNS)를 쓴다. 절차는 13장.

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
| 클라우드 서버(대표 협업자가 가져옴, 10-23 결정), 고정 IP | 대표·협업자 | — |
| 무료 주소(sslip.io는 설정 없음, DuckDNS는 하위 도메인 생성) | 대표 | 0~10분 |
| SSH 키 전달 | 대표 → CTO | 5분 |
| 1장 서버 준비, 2장 설치, 비밀값 입력, 백업 cron | CTO | 40~60분 |
| 확장 빌드·배포, 팀원 OAuth 테스트 사용자 등록, 로그인 확인 | CTO + 대표(OAuth 콘솔) | 30분 |

서버가 생긴 뒤 운영까지 약 1.5~2시간(DNS 전파 제외).

## 12. 노트북 모드 (클라우드 서버가 오기 전, 대표 결정 10-23)

클라우드 서버가 오기 전까지 대표 노트북의 Docker로 같은 묶음을 띄우고, 여러 구글 계정이 이 서버 하나를 함께 쓴다. **CTO가 "GitHub main 통합본이 로컬 main에 들어갔다"고 알린 뒤, 그 코드로 올린다.** 그 전에는 띄우지 않는다.

대표의 개발 환경과 섞이지 않게 모두 분리했다.

| | 개발 환경(그대로) | 노트북 모드 |
|---|---|---|
| compose 프로젝트 | `orbit`(저장소 루트 docker-compose.yml) | `orbit-laptop` |
| 볼륨 | `orbit_pgdata`, `orbit_qdrantdata` | `orbit-laptop_pgdata`, `orbit-laptop_qdrantdata` |
| 백엔드 주소 | `localhost:8000` | `http://127.0.0.1:8076` (caddy), 백엔드·DB 포트는 밖에 없음 |
| 묶이는 주소 | — | 127.0.0.1 만(같은 Wi-Fi의 다른 기기에서도 닿지 않음) |
| HTTPS | — | 없음(Caddy `:80`, 노트북 안 HTTP) |

피하는 포트: 8000·5200·5201·5203. 노트북 모드는 8076(HTTP)과 8476(쓰이지 않는 HTTPS 자리)만 쓴다.

```bash
cd <통합본 체크아웃>/deploy
cp .env.laptop.example .env.laptop && chmod 600 .env.laptop    # 비밀값 채우기(3장과 같은 규칙, 개발 .env 와 다른 JWT_SECRET)
lsof -iTCP:8076 -iTCP:8476 -sTCP:LISTEN                        # 비어 있어야 한다
alias olap='docker compose -f docker-compose.prod.yml --env-file .env.laptop'
olap up -d --build
curl -s http://127.0.0.1:8076/health                            # {"status":"ok"}
```

- **띄우기 전 디스크 암호화 확인:** 라이브 DB 볼륨과 백업이 모두 노트북 디스크에 평문으로 있으므로 실질 방어는 FileVault다. `fdesetup status`가 `FileVault is On.`이어야 한다. Time Machine을 쓰면 백업 디스크 암호화를 켜거나, `sudo tmutil addexclusion -p ~/OrbitLaptopBackups`로 백업 폴더를 제외한다(Docker 볼륨은 Docker Desktop 디스크 이미지 안에 있다. Time Machine이 그 이미지를 백업하는지는 설정에 따라 다르니 백업 디스크 암호화를 켜는 쪽이 확실하다).
- **`BIND_ADDR`를 바꾸지 않는다.** 다른 기기에서 쓰게 하려고 `0.0.0.0`으로 바꾸면 HTTP라서 Bearer 토큰과 방문 기록이 평문으로 Wi-Fi에 흐른다. 여러 기기·사람이 함께 쓰려면 클라우드(13장)로 간다.
- 프로젝트 이름은 `.env.laptop`의 `COMPOSE_PROJECT_NAME=orbit-laptop`이 정한다. 이 값을 지우거나 `orbit`으로 바꾸지 않는다. 개발 DB 볼륨과 겹친다.
- 확장 빌드: `VITE_API_BASE_URL=http://127.0.0.1:8076 pnpm build`. `127.0.0.1`은 이미 `host_permissions`에 있다. 빌드 뒤 `grep -rl "127.0.0.1:8076" .output/chrome-mv3`로 확인한다.
- **여러 계정:** 같은 노트북에서 크롬 프로필을 계정마다 하나씩 만들고, 각 프로필에 같은 빌드(`.output/chrome-mv3`)를 압축 해제된 확장으로 불러온다. 확장 ID가 고정이라 같은 OAuth 클라이언트로 모두 로그인된다. 쓰는 계정은 모두 Google Cloud Console > OAuth 동의 화면 > 테스트 사용자에 등록한다(최대 100명). 계정마다 데이터는 서버에서 `user_id`로 나뉘고, 팀 기능으로 고른 세션만 함께 본다.
- 노트북이 잠자거나 꺼지면 서버도 멈춘다. Docker Desktop을 다시 켜면 `restart: unless-stopped`라 저절로 다시 뜬다.
- **백업 위치:** 저장소 밖 `~/OrbitLaptopBackups`. 동기화 폴더(iCloud Drive, Dropbox, Google Drive)에는 두지 않는다.

```bash
ENV_FILE=.env.laptop BACKUP_DIR=~/OrbitLaptopBackups ./backup.sh
ENV_FILE=.env.laptop BACKUP_DIR=~/OrbitLaptopBackups ./restore.sh ~/OrbitLaptopBackups/<STAMP>
```

- 노트북 모드도 CORS 설정화가 들어간 코드로 올린다. 노트북에서 연 웹페이지가 127.0.0.1:8076을 부르더라도 확장 출처가 아니면 브라우저가 응답을 막는다.
- 끄기: `olap down`(데이터 유지). `olap down -v`는 데이터를 지우므로 백업 뒤에만 쓴다.

## 13. 클라우드로 옮기기 (무료 주소 sslip.io / DuckDNS, 대표 결정 10-23)

협업자가 클라우드 서버를 가져오면 노트북 모드의 데이터를 그대로 옮긴다.

1. 서버를 준비한다(1장). 고정 IP를 붙인다. IP가 바뀌면 주소도 바뀌기 때문이다.
2. 주소를 정한다.
   - **sslip.io**(설정 없음): 공인 IP가 `203.0.113.10`이면 `203-0-113-10.sslip.io`. DNS 등록이 필요 없다.
   - **DuckDNS**(계정 필요): duckdns.org에서 하위 도메인 `<이름>.duckdns.org`를 만들고 IP를 넣는다. IP가 바뀌어도 이름은 유지된다.
   - 둘 다 Let's Encrypt가 Caddy로 자동 발급된다(9장). 확인: `dig +short <주소>`가 서버 IP를 돌려줘야 한다.
3. 서버에 코드(CORS 설정화가 들어간 커밋, 2장 관문)를 받고 `.env.production`을 채운다. `ORBIT_DOMAIN=<주소>`, `ACME_EMAIL=<대표 메일>`. 비밀값은 노트북 값을 옮겨도 되지만 `JWT_SECRET`을 새로 만들면 모두 한 번 다시 로그인한다.
4. `oc up -d --build` → `curl -s https://<주소>/health`.
5. 노트북 데이터를 옮긴다.
   ```bash
   # 노트북: 마지막 백업 → 암호화 → 서버로
   ENV_FILE=.env.laptop BACKUP_DIR=~/OrbitLaptopBackups ./backup.sh
   STAMP=$(ls -1 ~/OrbitLaptopBackups | grep '^2' | tail -1)
   tar -C ~/OrbitLaptopBackups -c "$STAMP" | ssh <서버> "mkdir -p /opt/orbit/deploy/backups && tar -C /opt/orbit/deploy/backups -x"
   # 서버: 새 서버라 안전 백업은 빈 상태를 받을 뿐이지만 그대로 둔다
   ssh <서버> "cd /opt/orbit/deploy && ./restore.sh backups/$STAMP"
   ```
   ssh 전송은 이미 암호화된 경로다. 서버에 올린 묶음은 정기 백업처럼 KEEP으로 정리된다.
6. 확장을 `VITE_API_BASE_URL=https://<주소>`로 다시 빌드해 각 크롬 프로필에 다시 불러온다. 확장 ID와 OAuth 설정은 그대로다.
7. 서버에서 로그인과 세션이 보이면 노트북 모드를 끈다(`olap down`). 백업 cron을 건다(5장).
8. **이전 2주 뒤 노트북 사본을 지운다.** 그동안 클라우드 백업이 매일 쌓였는지 확인한 뒤 `olap down -v`(노트북 볼륨 삭제)와 `rm -rf ~/OrbitLaptopBackups`(평문 백업 삭제)를 한다. 더 남겨야 하면 5장처럼 age로 암호화한 사본만 남긴다.

주의: sslip.io와 DuckDNS는 남이 운영하는 무료 서비스다. 멈추거나 정책이 바뀌면 주소를 잃는다. 그때는 새 주소로 4·6단계만 다시 하면 된다(데이터는 서버에 그대로 있다).

## 의존성 고정 갱신

`pyproject.toml`을 바꾸면 고정본도 다시 만든다. 로컬 시험 환경과 같은 버전으로 맞추는 것이 원칙이다.

```bash
cd backend
pip freeze > /tmp/local.txt   # 전체 시험이 통과한 환경에서
docker run --rm -v "$PWD:/src:ro" -v /tmp/local.txt:/c.txt:ro python:3.13.17-slim \
  sh -c "cp -r /src /b && cd /b && pip install -q -c /c.txt . && pip freeze --exclude orbit-backend"
# 출력을 requirements.lock 에 넣고(머리 주석은 유지) 이미지를 다시 빌드해 리허설한다
```
