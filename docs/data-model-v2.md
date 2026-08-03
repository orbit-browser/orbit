# Orbit 데이터 모델 v2 — Memory Store 확장

> 근거: 계획서 B-2. 신규 테이블 5개 + 기존 `sessions` 확장. 원본 이벤트(사실)와 AI 해석(세션)을 분리한다 — 이벤트가 Memory의 기본 단위이고, 세션은 그 위의 파생 뷰다.
> 현재 스키마는 `docs/current-state-audit.md` §4 참고. 마이그레이션 절차는 `docs/migration-plan.md` 참고. DDL은 Postgres 16 기준이며, 실제 구현은 SQLAlchemy 모델(`backend/app/db/models.py`)로 옮겨진다 — 아래는 그 계약을 고정하기 위한 DDL 수준 정의다.
> 구현 노트: 아래 DDL의 `UUID` 컬럼은 실제 모델에서 기존 코드베이스 컨벤션(`sessions.id = String(36)`, Qdrant point id 문자열)에 맞춰 **`VARCHAR(36)` UUID 문자열**로 구현한다. 값 형식은 UUID로 동일하며, JSON 직렬화·비교 시 `uuid.UUID`↔`str` 변환 계층을 없애기 위한 선택이다.

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
    content_excerpt      VARCHAR(5000),
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
- `content_excerpt` 5000자 캡은 요약 프롬프트(`services/summarizer.py`의 `_MAX_CHARS_PER_TAB=2000`)보다 넉넉하게 잡아 원본을 보존하고, 실제 LLM 전송 시점에 별도로 자른다(§target-architecture.md §6 "LLM 전송 전 제외" 참고).
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
```

- `origin='snapshot'`: 기존 `POST /sessions`/`POST /sessions/cluster` 경로로 만들어진 세션(기본값 — 기존 데이터와 신규 스냅샷 세션 모두 여기 해당).
- `origin='events'`: Auto Session(배치 파이프라인)이 `action: create`로 새로 만든 세션.
- 기존 프론트/검색/임베딩 코드가 참조하는 `summary`/`tabs` JSONB는 그대로 유지한다 — 형식을 바꾸지 않아야 `_to_detail()`(`api/sessions.py:39-65`), 프론트 매퍼(`extension/lib/api.ts`, `frontend/src/lib/api.ts`)가 무변경으로 동작한다.

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
