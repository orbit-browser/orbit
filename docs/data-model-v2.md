# Orbit 데이터 모델 v2 — Memory Store 확장

> 근거: 계획서 B-2. 신규 테이블 5개 + 기존 `sessions` 확장. 원본 이벤트(사실)와 AI 해석(세션)을 분리한다 — 이벤트가 Memory의 기본 단위이고, 세션은 그 위의 파생 뷰다.
> 현재 스키마는 `docs/current-state-audit.md` §4 참고. 마이그레이션 절차는 `docs/migration-plan.md` 참고. DDL은 Postgres 16 기준이며, 실제 구현은 SQLAlchemy 모델(`backend/app/db/models.py`)로 옮겨진다 — 아래는 그 계약을 고정하기 위한 DDL 수준 정의다.
> 구현 노트: 아래 DDL의 `UUID` 컬럼은 실제 모델에서 기존 코드베이스 컨벤션(`sessions.id = String(36)`, Qdrant point id 문자열)에 맞춰 **`VARCHAR(36)` UUID 문자열**로 구현한다. 값 형식은 UUID로 동일하며, JSON 직렬화·비교 시 `uuid.UUID`↔`str` 변환 계층을 없애기 위한 선택이다.
> Qdrant 구현 노트: `orbit_sessions` 포인트 payload는 `session_id`, `user_id`(세션 소유자), `title`, `overview`, `purpose`를 갖는다. 모든 벡터 검색은 `user_id` payload 필터를 적용하고 `init_collection()`이 `user_id` keyword 인덱스를 보장한다. 기동 시 `backfill_user_ids()`가 `user_id` 없는 기존 포인트를 SQL의 세션 소유자로 채우고 세션이 없는 포인트는 삭제한다(멱등).

## 1. `exploration_events` — Memory의 원자 단위

```sql
CREATE TABLE exploration_events (
    id                  UUID PRIMARY KEY,              -- 클라이언트가 생성(멱등 전송의 기준)
    user_id             VARCHAR(64)  NOT NULL DEFAULT 'local',  -- 인증 미도입, 추후 실사용자 ID로 대체
    device_id           VARCHAR(64),
    source              VARCHAR(20)  NOT NULL DEFAULT 'browser', -- §4 참고: bookmark/chatgpt 등 확장용
    url                 TEXT         NOT NULL,
    normalized_url      TEXT         NOT NULL,          -- 중복 병합 키(§5)
    title               VARCHAR(500),
    domain              VARCHAR(255),
    search_query        TEXT,                           -- §5 검색어 추출 규칙 참고
    visited_at          TIMESTAMPTZ  NOT NULL,
    ended_at            TIMESTAMPTZ,
    active_duration_ms  INTEGER,
    tab_id              INTEGER,
    window_id           INTEGER,
    previous_event_id   UUID,   -- 소프트 참조(FK 없음): 대상이 필터 제외/미동기화일 수 있어 FK 시 배치 인제스트가 깨짐
    referrer_url        TEXT,
    event_type          VARCHAR(20)  NOT NULL DEFAULT 'visit',  -- visit | spa_nav (§4 확장 설계)
    content_excerpt      VARCHAR(16000),
    content_hash        VARCHAR(64),                    -- 중복 병합 키(§5)
    sync_status         VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending|processing|processed|discarded
    hold_count          INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_exploration_events_user_id       ON exploration_events (user_id);
CREATE INDEX ix_exploration_events_sync_status   ON exploration_events (sync_status);
CREATE INDEX ix_exploration_events_visited_at    ON exploration_events (visited_at);
CREATE INDEX ix_exploration_events_domain        ON exploration_events (domain);
CREATE INDEX ix_exploration_events_normalized_url ON exploration_events (normalized_url);
```

- PK가 클라이언트 생성 UUID인 이유: 인제스트 삽입을 `ON CONFLICT (id) DO NOTHING`으로 멱등 처리하기 위함(전송 후 SW가 죽어도 재전송이 중복 레코드를 만들지 않음).
- `content_excerpt` 16,000자 캡(2026-10-19, 이전 5,000자 — 확장은 4,000자에서 잘랐다)은 확장 `MAX_CONTENT_EXCERPT_LENGTH`, 인제스트 `_MAX_EXCERPT_LEN`과 같은 값이다. 실제 사이트 55페이지를 공백 정규화 후 재 보니 중앙값 3,574자·p90 11,760자였고, 4,000자에서는 57%만 온전히 남아 예방접종 가격·FAQ 같은 뒷부분 사실이 빠졌다. 16,000자면 94%가 온전히 남고(12,000자 91%), 평균 저장 길이는 4,824자, Ask의 700자 조각은 페이지당 평균 7.4개다. 요약·Ask 프롬프트는 LLM 전송 시점에 따로 자른다(§target-architecture.md §6 "LLM 전송 전 제외" 참고). 기존 DB는 기동 마이그레이션(`db/migrations.py` `_VARCHAR_WIDTHS`)이 현재 길이가 작을 때만 `ALTER COLUMN ... TYPE VARCHAR(16000)`으로 넓힌다(Postgres varchar 확장은 테이블을 다시 쓰지 않는다).
- 본문은 확장 content script가 Readability로 뽑고, 500자 미만이면 same-origin iframe 문서의 Readability(네이버 블로그) → 화면 전체 텍스트(`innerText`) 순으로 폴백한다. 공백·빈 줄은 접어서 저장한다(`extension/lib/page-text.ts`).
- `event_type`은 Stage 1에서 `visit`/`spa_nav` 두 값만 쓰지만, 문자열 컬럼으로 열어 두어 Stage 2·3(북마크/PDF/GitHub/ChatGPT) 소스별 고유 이벤트 유형을 스키마 변경 없이 추가할 수 있게 한다(§4).

### 1.1 상태 전이도 (`sync_status`)

```
        ┌───────────┐
 POST   │  pending  │◄─────────────┐
/events └─────┬─────┘               │ 배치 실패/재시작 시 복구
              │ 배치가 claim         │
              ▼                     │
        ┌───────────┐               │
        │processing │───────────────┘
        └─────┬─────┘
              │ 의도 분석 결과
       ┌──────┴──────┐
       ▼             ▼
 ┌───────────┐ ┌───────────┐
 │ processed │ │ discarded │
 └───────────┘ └───────────┘
```

`hold`로 판정된 이벤트는 `pending`에 남고 `hold_count`만 증가한다(별도 상태 아님). `hold_count ≥ 3`이면 다음 배치가 강제로 `create`를 적용해 무한 보류를 차단한다.

## 2. `sync_batches` — 배치 실행 기록

```sql
CREATE TABLE sync_batches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        VARCHAR(64) NOT NULL DEFAULT 'local',
    trigger_type   VARCHAR(20) NOT NULL,       -- manual | periodic | event_count | idle
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    status         VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | completed | failed
    model           VARCHAR(50),
    prompt_version VARCHAR(20),
    event_count    INTEGER,
    error_message  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `status='running'` 행은 배치 동시 실행 방지의 재시작 안전망 역할을 겸한다(모듈 레벨 `asyncio.Lock`과 이중 방어). 서버 재시작 시 `running` 상태로 남아있던 배치는 `failed`로 전이시킨다.
- `model`/`prompt_version`/`event_count`/소요시간(`completed_at - started_at`)/`error_message`는 계획서 §13이 요구하는 평가·운영 지표(평균 동기화 시간, 배치당 비용 추적)의 원천 데이터를 겸한다.

## 3. `sync_batch_events` — 배치-이벤트 연결

```sql
CREATE TABLE sync_batch_events (
    batch_id UUID NOT NULL REFERENCES sync_batches(id),
    event_id UUID NOT NULL REFERENCES exploration_events(id),
    PRIMARY KEY (batch_id, event_id)
);
```

어떤 배치가 어떤 이벤트를 처리했는지의 감사 로그. 배치 재시작 시 "이 이벤트를 이미 이 배치가 claim했는지"를 판별하는 데도 쓰인다.

## 4. `sessions` 확장 (기존 테이블 — additive-only)

기존 컬럼(`id`, `title`, `tabs`, `summary`, `tab_count`, `summary_status`, `embedding_status`, `created_at`, `updated_at`)은 **변경하지 않는다**. 아래 컬럼을 추가한다.

```sql
ALTER TABLE sessions ADD COLUMN user_id                VARCHAR(64) NOT NULL DEFAULT 'local';
ALTER TABLE sessions ADD COLUMN origin                  VARCHAR(20) NOT NULL DEFAULT 'snapshot'; -- snapshot | events
ALTER TABLE sessions ADD COLUMN status                  VARCHAR(20) NOT NULL DEFAULT 'active';   -- active | archived
ALTER TABLE sessions ADD COLUMN started_at              TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN last_activity_at        TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN total_active_duration_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN event_count             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN keywords                JSONB NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN confidence              REAL;
ALTER TABLE sessions ADD COLUMN alias                   VARCHAR(100);            -- 사용자 표시 이름. NULL=title 사용
```

- `alias`: 사용자가 붙인 표시 이름. **`title` 은 사용자 편집으로 바뀌지 않는다** — `title` 은
  임베딩 텍스트, 병합 게이팅의 제목 Jaccard, 추천 term 추출의 기준이고 배치 세션화가 매번
  다시 만들어 내므로 사용자 작명을 실으면 저장된 벡터와 어긋나고 배치가 덮어쓴다.
  응답 경계에서만 `coalesce(alias, title)` 로 합쳐 내보낸다(`session_display_title`).
- `origin='snapshot'`: 기존 `POST /sessions`/`POST /sessions/cluster` 경로로 만들어진 세션(기본값 — 기존 데이터와 신규 스냅샷 세션 모두 여기 해당).
- `origin='events'`: Auto Session(배치 파이프라인)이 `action: create`로 새로 만든 세션.
- extension 검색/임베딩 코드가 참조하는 `summary`/`tabs` JSONB는 그대로 유지한다 — 형식을 바꾸지 않아야 `_to_detail()`(`api/sessions.py:39-65`)과 extension 매퍼(`extension/lib/api.ts`)가 무변경으로 동작한다.

### 4.1 `tabs` JSONB 하위 호환 규칙

- 이벤트 기반 세션(`origin='events'`)도 `tabs` 컬럼에 **대표 페이지 top-20**을 채운다 — 기존 목록/검색/복원 UI가 `tabs` 필드만 보고 동작하므로, 이벤트 기반 세션도 이 필드를 채워야 화면단 변경 없이 그대로 렌더링된다.
- **단일 작성자 원칙**: 세션 생성 이후 `tabs` 필드를 갱신하는 주체는 `session_updater.py` 하나로 제한한다. 기존에는 `create_session`/`create_sessions_clustered`(`api/sessions.py`)가 최초 생성 시 `tabs`를 쓰지만, 그 이후 어떤 경로도 `tabs`를 직접 덮어쓰지 않았다(수정 API가 `title`만 지원 — `PatchSessionRequest`). Auto Session 도입 이후에도 이 불변식은 유지한다: 최초 생성은 각자의 생성 경로(스냅샷 API 또는 `session_updater`)가 담당하고, **생성 이후의 갱신은 오직 `session_updater`만 수행**한다. 두 작성자가 동시에 같은 세션의 `tabs`를 갱신하는 경로를 만들지 않음으로써 경쟁 조건과 덮어쓰기 유실을 원천 차단한다.
- 대표 페이지 선정 기준(top-20): `session_events.relevance_score` 내림차순 + `sequence_order`를 tie-breaker로 사용한다(상세 알고리즘은 `session_updater.py` 구현 단계에서 확정 — 이 문서는 "무엇을 기준으로 줄이는가"의 계약만 고정한다).

## 5. `session_events` — Session Timeline 저장 구조

```sql
CREATE TABLE session_events (
    session_id      VARCHAR(36) NOT NULL REFERENCES sessions(id),
    event_id        UUID        NOT NULL REFERENCES exploration_events(id),
    relevance_score REAL,
    sequence_order  INTEGER     NOT NULL,
    assigned_by     VARCHAR(20) NOT NULL DEFAULT 'llm',  -- llm | rule | user
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, event_id)
);

CREATE INDEX ix_session_events_session_sequence ON session_events (session_id, sequence_order);
```

- `assigned_by='llm'`: 의도 분석(`intent_analyzer.py`)의 `assignments`가 배정한 경우(기본 경로).
- `assigned_by='rule'`: 규칙 기반 fallback(LLM 실패 시)이 배정한 경우 — `assignment` 자체가 실패하면 이벤트는 `hold` 처리되지만, 향후 규칙 기반 보조 배정을 추가할 여지를 남긴다.
- `assigned_by='user'`: MVP 범위 밖(수동 재배정 UI 없음)이지만, 스키마에 값만 예약해 향후 사용자가 직접 이벤트를 다른 세션으로 옮기는 기능을 추가할 때 마이그레이션 없이 확장 가능하게 한다.
- `GET /sessions/{id}/events`(`api-design-v2.md` 참고)가 이 테이블을 `sequence_order` 순으로 반환해 Session Timeline을 구성한다.

## 6. `session_versions` — 요약 이력

```sql
CREATE TABLE session_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id     VARCHAR(36) NOT NULL REFERENCES sessions(id),
    version        INTEGER NOT NULL,
    title          VARCHAR(100),
    overview       TEXT,
    purpose        TEXT,
    highlights     JSONB NOT NULL DEFAULT '[]',
    todos          JSONB NOT NULL DEFAULT '[]',
    next_actions   JSONB NOT NULL DEFAULT '[]',
    prompt_version VARCHAR(20),
    model          VARCHAR(50),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, version)
);
```

- 스냅샷 경로(`_ai_update`)도 요약이 성공할 때마다 이 테이블에 버전을 기록한다 — 공용 함수 `record_version()`을 통해 Auto Session 경로와 스냅샷 경로가 같은 이력 테이블을 공유한다(계획서 B-2 "스냅샷 경로도 성공 시 버전 기록").
- `version`은 세션당 1부터 증가하는 정수(`UNIQUE(session_id, version)`)로, 이력 조회 시 정렬 기준이자 "몇 번째 갱신인지"를 사용자에게 보여주는 값이다.
- `GET /sessions/{id}/versions`(§api-design-v2.md)가 이 테이블을 조회한다.

## 7. `source` / `event_type` — Memory 확장 설계

Stage 1(이번 MVP)은 `source='browser'` 고정, `event_type ∈ {visit, spa_nav}`만 사용한다. 두 컬럼을 문자열로 열어 둔 이유는 계획서 H(Stage 2·3)에서 스키마 변경 없이 새 소스를 흡수하기 위함이다.

| 단계 | `source` 값(예정) | `event_type` 활용 방향 | 비고 |
|---|---|---|---|
| Stage 1(MVP) | `browser`(고정) | `visit`(일반 방문) / `spa_nav`(SPA 내 라우팅) | 이번 문서가 구현하는 범위 |
| Stage 2 | `bookmark` / `pdf` / `github` | 소스별로 `event_type`에 고유 값 사용 가능(예: `pdf_open`, `commit_view`) — `event_filter.py`에 소스별 정규화 로직 추가 예정 | 파이프라인/검색/Timeline은 무변경으로 새 소스를 흡수(설계상 소스 불문) |
| Stage 3 | `chatgpt` | `content_excerpt`에 질문/응답 요약 저장 | 대화와 방문이 한 세션 Timeline에 병렬 표시. 이벤트 단위 임베딩 도입은 이때 재검토 |

이 표는 계획서 H를 스키마 관점에서 재정리한 것이며, Stage 2·3은 이번 MVP에서 구현하지 않는다(`docs/product-direction-v2.md` §7, `docs/implementation-roadmap.md` §H 참고).

## 8. `search_query` 추출 규칙

검색 엔진 결과 페이지 URL에서 검색어를 추출해 Intent 검색 보강과 반복 검색 분석(`GET /analytics/overview`)에 사용한다. `event_filter.py`(신규, 아직 미구현)가 `normalized_url` 계산과 함께 다음 규칙으로 `search_query`를 채운다.

| 검색 엔진 | URL 패턴 | 추출 대상 파라미터 |
|---|---|---|
| Google | `google.*/search?...` | `q` |
| Naver | `search.naver.com/search.naver?...` | `query` |
| YouTube | `youtube.com/results?...` | `search_query` |
| Bing | `bing.com/search?...` | `q` |

- 위 패턴에 해당하지 않는 URL은 `search_query = NULL`.
- 이 규칙은 계획서 B-2("구글/네이버/유튜브/빙 URL의 검색어 추출")를 실제 파라미터 이름 수준으로 구체화한 것이며, `event_filter.py` 구현 시점(M1)에 코드로 확정한다. 위 4개 엔진 외 확장은 이번 문서 범위 밖(확인 필요 — 추가 검색엔진 지원 여부는 구현 단계에서 결정).

## 9. `folders` — 사용자 폴더 (신규 테이블)

사용자가 직접 만드는 세션 그룹. 폴더 자체는 사용자만 만들고, 새 세션은 사용자 폴더 안에서 확실할 때만 자동
배정된다(§9.4).

```sql
CREATE TABLE folders (
  id         VARCHAR(36) PRIMARY KEY,
  user_id    VARCHAR(64) NOT NULL,
  name       VARCHAR(60) NOT NULL,
  hue        VARCHAR(20) NOT NULL,   -- 캔버스 중심 노드·궤도 색. 생성 시 팔레트 순환 배정
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_folders_user_position ON folders (user_id, position);

ALTER TABLE sessions ADD COLUMN folder_id VARCHAR(36);  -- NULL = 미정리
CREATE INDEX ix_sessions_folder_id ON sessions (folder_id);
ALTER TABLE sessions ADD COLUMN folder_assigned_by VARCHAR(10);  -- user | auto | NULL(미결정)
```

신규 테이블이라 `create_all`이 생성하고, `sessions.folder_id`·`folder_assigned_by`만 §3의 멱등 ALTER
러너(`app/db/migrations.py`)가 추가한다.

### 9.1 단일 소속

세션은 폴더 하나에만 속한다(`sessions.folder_id`). 배정은 곧 이동이며, 다른 폴더에
있던 세션도 그대로 옮겨온다. 다중 소속(태그형)은 범위 밖이다 — 드래그가 "이동"인지
"복사"인지 모호해지고 폴더에서 빼는 UI가 따로 필요해진다.

### 9.2 FK를 걸지 않는 이유

`sessions.folder_id`에는 외래키 제약을 걸지 않는다. 이 컬럼은 기존 테이블에 ALTER로
추가되고, 폴더 삭제는 애플리케이션이 같은 트랜잭션에서 `folder_id`를 NULL로 되돌려
처리한다. 조회 측(백엔드·확장 모두)은 **존재하지 않는 폴더 id를 미정리로 간주해**
방어한다 — 다른 기기에서 폴더가 지워졌는데 세션 목록이 먼저 도착하면 그 세션이
어디에도 보이지 않게 되기 때문이다.

### 9.3 병합과의 관계

병합으로 흡수된 세션(`status='merged'`)은 목록에서 빠지므로 폴더 소속을 따로
정리하지 않는다. 생존 세션의 폴더는 그대로 유지되고, `session_count` 집계에서만
흡수된 세션을 제외한다.

### 9.4 `folder_assigned_by` — 소속을 정한 주체

| 값 | 의미 | 바뀌는 경우 |
|---|---|---|
| `NULL` | 아무도 정하지 않음. 기능 이전에 폴더에 넣은 세션도 여기에 해당(사용자가 넣은 것으로 본다) | 새 세션, 폴더 삭제로 미정리가 된 세션 |
| `user` | 사용자가 정함 | 폴더 배정·폴더에서 빼기·제안 닫기 |
| `auto` | 자동 분류가 넣음 | 배치 끝 자동 배정 |

자동 분류와 제안은 `folder_id`와 `folder_assigned_by`가 모두 NULL인 세션만 다룬다. 사용자가 뺀 세션은
`folder_id=NULL, folder_assigned_by='user'`로 남아 다시 들어가지 않는다. 자동 배정 세션은 다른 세션을
분류하는 근거에서 빠진다 — 잘못 넣은 세션이 다음 판단을 끌고 가지 않게 한다.


## 10. 팀 워크스페이스 (신규 테이블 3개)

1단계는 세션 공유형이다. 기존 테이블에는 컬럼을 추가하지 않고, 공유를 원본 세션에 대한 관계 행으로
표현한다(라이브 참조). 신규 테이블이라 `create_all`이 생성한다.

```sql
CREATE TABLE workspaces (
  id                VARCHAR(36) PRIMARY KEY,
  name              VARCHAR(60) NOT NULL,
  hue               VARCHAR(20) NOT NULL,
  invite_code_hash  VARCHAR(64),          -- 초대 코드 SHA-256. 재발급하면 바뀐다
  invite_expires_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_workspaces_invite_code_hash ON workspaces (invite_code_hash);

CREATE TABLE workspace_members (
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  user_id      VARCHAR(64) NOT NULL,
  role         VARCHAR(20) NOT NULL,     -- 'owner' | 'member'
  joined_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ix_workspace_members_user_id ON workspace_members (user_id);

CREATE TABLE workspace_sessions (
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  session_id   VARCHAR(36) NOT NULL REFERENCES sessions(id),
  shared_by    VARCHAR(64) NOT NULL,     -- 공유는 소유자만 하므로 곧 세션 소유자
  shared_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, session_id)
);
CREATE INDEX ix_workspace_sessions_session_id ON workspace_sessions (session_id);
```

### 10.1 정리 규칙

FK에 ON DELETE가 없다(`session_events`와 같다). 정리를 빠뜨리면 조용한 고아 행 대신 삭제 오류로
드러나게 하려는 것이다. 애플리케이션이 같은 트랜잭션에서 먼저 지운다.

- 세션 삭제: 그 세션의 `workspace_sessions`를 먼저 지운다.
- 팀 삭제: `workspace_sessions` → `workspace_members` → `workspaces` 순.
- 탈퇴·내보내기: 그 사람이 그 팀에 건 `workspace_sessions`(`shared_by`)와 멤버십을 지운다.
  개인 세션은 남는다. 내보내기는 `invite_code_hash`·`invite_expires_at`도 비운다.
- 읽는 쪽은 `workspace_members`를 `(workspace_id, shared_by)`로 조인해 **공유한 사람이 아직 멤버인
  공유만** 센다. 탈퇴와 같은 순간 들어온 공유 행이 남아도 팀에 보이지 않는다.

### 10.2 병합과의 관계

공유된 세션이 흡수되면(`status='merged'`) 팀 목록·팀 검색·팀원의 단건 조회에서 빠지고 공유 행은
남겨 둔다 — 되돌리면 그대로 다시 보인다. 흡수한 생존 세션은 자동으로 공유하지 않는다. 자동병합은 공유 중인 세션을
건너뛴다. 사용자 모르게 팀에 보이는 범위가 바뀌지 않게 하기 위해서다.

### 10.3 팀 수집 모드 (2단계, `docs/team-collect-mode.md` §4)

기존 표에 열 4개(멱등 러너 `_TABLE_COLUMNS`), 신규 표 1개(create_all), 인덱스 3개(러너 `_INDEXES`, `pg_indexes` 확인 후 생성).

```sql
ALTER TABLE exploration_events ADD COLUMN workspace_id VARCHAR(36);       -- 서버 판정을 통과한 팀 수집 방문. NULL=개인
ALTER TABLE exploration_events ADD COLUMN collect_window_id VARCHAR(36);  -- 판정에 쓴 수집 창(빼기·되돌리기 기준)
ALTER TABLE sessions ADD COLUMN collect_workspace_id VARCHAR(36);         -- 팀 수집 스트림. NULL=개인
ALTER TABLE workspaces ADD COLUMN collect_allowed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE workspace_collect_windows (
  id VARCHAR(36) PRIMARY KEY, workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  user_id VARCHAR(64) NOT NULL, device_id VARCHAR(64) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,   -- 최대 8시간
  ended_at TIMESTAMPTZ, ended_reason VARCHAR(20), withdrawn_at TIMESTAMPTZ
);
CREATE INDEX ix_collect_windows_lookup ON workspace_collect_windows (workspace_id, user_id, device_id, started_at);
CREATE UNIQUE INDEX ux_collect_windows_open ON workspace_collect_windows (user_id, device_id) WHERE ended_at IS NULL;
CREATE INDEX ix_exploration_events_stream ON exploration_events (user_id, workspace_id, sync_status, visited_at);
CREATE INDEX ix_exploration_events_collect_window ON exploration_events (collect_window_id) WHERE collect_window_id IS NOT NULL;
CREATE INDEX ix_sessions_collect_workspace_id ON sessions (collect_workspace_id) WHERE collect_workspace_id IS NOT NULL;
```

- 공유 행(`workspace_sessions`)은 "팀에 보이는가", `collect_workspace_id`는 "어느 스트림의 방문을 받는가"다. 수동 공유한 개인 세션은
  팀에 보여도 개인 스트림이다. 배치는 claim·후보·반영 세 곳에서 같은 스트림만 다룬다.
- 열에 FK가 없다. 팀 삭제·탈퇴 정리가 같은 트랜잭션에서 창을 먼저 잠가 닫고 → 방문 표시 → 세션 스트림 → 공유 행 → (팀 삭제면) 창·멤버·팀 순으로 지운다.
- 배치 반영 직전 재판정은 멤버십·가입 시각·방문 표시만 다시 본다. `collect_allowed`는 인제스트 판정 조건이라 반영 때 다시 보지 않는다
  (허용을 끄기 전 창 안에서 받은 방문은 팀 기록으로 남는다).
- 세션 주인은 owner가 공유를 푼 수집 세션도 되돌리기(`restore`)로 다시 공유할 수 있다(1단계 재공유와 같은 권한, CTO 결정 2026-10-23).
- 데이터 이관 없음: 기존 행은 NULL = 개인, 기존 팀은 허용 꺼짐. 되돌리기: 열은 남아도 옛 코드는 읽지 않는다.
- Qdrant payload에 `collect_workspace_id`(keyword index)를 싣는다. 개인 세션은 필드가 없다(백필 불필요). 배치 후보의 recall 필터일 뿐 경계는 SQL이다.
- `user_settings` 키: `team_collect_excluded_domains`(문자열 배열), `team_collect_consented`(`{workspace_id: {version, at}}`).

## 11. `user_settings` — 사용자별 설정 (신규 테이블)

```sql
CREATE TABLE user_settings (
  user_id    VARCHAR(64) NOT NULL,
  key        VARCHAR(64) NOT NULL,       -- 'auto_merge_enabled', 'auto_folder_enabled'
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);
```

단일 사용자 시절의 전역 `app_settings` 테이블을 대체한다. 그 테이블은 DB에 남지만 코드가 더는 읽지
않는다 — 그 값은 누군가의 opt-in이라 다른 사용자에게 물려주면 파괴적 기능인 자동병합이 동의 없이
켜진다. 기존에 자동병합을 켜 둔 사용자는 한 번 다시 켜야 한다.

## 12. Qdrant payload `user_id`

세션 포인트 payload에 `user_id`를 싣고 keyword index를 둔다. 개인 검색·배치 후보·병합 제안·추천은
이 payload로 Qdrant 단계에서 범위를 좁히고(recall), 팀 검색은 공유 세션 id 목록(`HasIdCondition`)으로
좁힌다. **보안 경계는 그대로 SQL 조건**이다.

기동 시 `user_id`가 없는 기존 포인트를 세션 테이블에서 찾아 채운다(멱등, 실패 시 다음 기동에 재시도).
두 갈래가 따로 만든 백필 두 개가 차례로 돈다. 앞(`embedding_sync.backfill_owner_payload`)은 소유자를 채우고,
뒤(`vector.backfill_user_ids`)는 그래도 남은 DB에 없는 세션의 고아 포인트를 지운다. Ask 후보 검색(점수 포함)도
팀 범위에서는 공유 세션 id로만 좁힌다 — user 필터를 같이 걸면 다른 멤버가 공유한 세션이 빠진다.
