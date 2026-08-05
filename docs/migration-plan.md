# Orbit 마이그레이션 계획 — DB 리셋 · 멱등 ALTER 러너 · 단계별 롤아웃

> 근거: 계획서 확정된 사용자 결정("DB 마이그레이션") + G 구현 순서. 현재 상태(Alembic 부재, `create_all`만 수행)는 `docs/current-state-audit.md` §4·§9 참고. 신규 테이블 정의는 `docs/data-model-v2.md` 참고.

## 1. 확정된 방침

> DB 마이그레이션: **1회 `docker compose down -v` 리셋 + create_all + 멱등 ALTER 러너**(`app/db/migrations.py`, ~25줄). Alembic은 대회 이후.

Alembic처럼 버전 관리되는 마이그레이션 도구를 지금 도입하지 않는 이유: 이번 스키마 변경(신규 5테이블 + `sessions` 컬럼 추가)은 전부 additive-only이고, 로컬/데모 환경의 기존 데이터도 재현 가능한 샘플 데이터이므로 1회 리셋 비용이 Alembic 도입·학습 비용보다 낮다고 판단했기 때문이다(계획서 확정 사항). 다만 이후 배포 환경에서 실데이터가 쌓이기 시작하면 Alembic 도입을 재검토해야 한다(이 문서 §5 위험 참고).

## 2. 1회 리셋 절차

이 리셋은 **개발/데모 환경에서 딱 한 번**만 수행한다. 리셋 이후에는 `app/db/migrations.py`의 멱등 ALTER 러너가 스키마 변경을 흡수하므로 다시 리셋할 필요가 없어야 한다.

### 2.1 사전 팀 공지 (리셋 실행 전 필수)

리셋은 기존 로컬 Postgres/Qdrant 볼륨을 전부 삭제한다. 팀(또는 로컬 데모 사용자) 전원에게 아래 내용을 리셋 실행 전에 공지한다.

- 실행 시각과 사유(Personal Exploration Memory 전환을 위한 스키마 확장)
- **기존에 저장된 세션 데이터가 전부 삭제된다**(로컬 Postgres 볼륨 + Qdrant 컬렉션 전부 초기화)
- 리셋 이후 각자 로컬에서 `docker compose up -d` → 백엔드 재기동이 필요하다는 안내
- 데모/시연용으로 보존해야 하는 세션이 있다면 리셋 전에 별도 백업(예: `GET /sessions` 응답을 파일로 저장) 필요

### 2.2 실행 절차

```powershell
# 1) 백엔드 프로세스 중지 (실행 중이면)
# 2) 볼륨 포함 전체 삭제
docker compose down -v

# 3) 인프라 재기동 (docker-compose.yml: postgres:16 + qdrant)
docker compose up -d

# 4) 백엔드 기동 — lifespan의 init_db()가 create_all로 신규 스키마 전체 생성,
#    init_collection()이 Qdrant 컬렉션 재생성
#    (uvicorn 실행 명령은 backend/README.md 기존 절차 그대로)
```

- `docker-compose.yml`은 `pgdata`/`qdrantdata` 두 named volume을 정의하고 있어(`docker-compose.yml:12-13,19-20`), `down -v`가 정확히 이 두 볼륨을 제거한다 — 호스트의 다른 데이터에는 영향이 없다.
- 리셋 직후에는 `sessions` 테이블이 §2.1의 신규 컬럼까지 포함한 **최종 형태로 한 번에** 생성된다(`create_all`은 현재 모델 정의 기준으로 테이블을 만들기 때문에, 이 시점 이후에는 컬럼 추가용 ALTER가 필요 없다). ALTER 러너는 이 리셋 이후 **추가로 발생하는** 컬럼 변경(M1~M5 진행 중 모델에 컬럼을 더 추가하게 될 경우)을 위한 안전망이다.

## 3. `app/db/migrations.py` 멱등 ALTER 러너 규칙

- **목적**: 이미 기동 중인 환경(리셋을 다시 하고 싶지 않은 환경)에서 새 컬럼이 추가되었을 때, 수동 개입 없이 안전하게 스키마를 따라잡기 위함.
- **규모**: 계획서 기준 약 25줄 — Alembic 같은 버전 관리·다운그레이드 기능은 없다. "컬럼이 없으면 추가한다"만 수행하는 최소 러너.
- **실행 시점**: `init_db()`(`db/session.py:10-13`) 직후, 즉 `create_all` 다음 단계로 호출한다. `create_all`은 테이블이 아예 없을 때만 생성하고 기존 테이블의 컬럼 추가는 하지 않으므로, 컬럼 추가는 이 러너가 전담한다.
- **멱등성 규칙**:
  - 각 ALTER 구문은 `information_schema.columns`(또는 동등한 방법)로 대상 컬럼 존재 여부를 먼저 확인한 뒤에만 실행한다 — 이미 존재하면 건너뛴다. 여러 번 반복 실행해도 동일한 최종 상태에 도달해야 한다(idempotent).
  - 컬럼 추가는 반드시 `NOT NULL` 제약이 필요하면 `DEFAULT`를 함께 지정한다 — 기존 행에 값을 채우지 않고 `NOT NULL`만 추가하면 실패하기 때문이다(`docs/data-model-v2.md` §4의 `sessions` 확장 컬럼이 전부 기본값을 가지는 이유).
  - 컬럼 **삭제·타입 변경·이름 변경은 이 러너의 책임 범위가 아니다** — additive-only 원칙(§5)에 따라 이런 변경이 필요해지면 별도 결정을 거친다.
  - 러너 실패 시 서버 기동을 중단한다(스키마가 코드 기대와 어긋난 채로 서비스가 뜨는 것을 막기 위함) — 단, 실패 원인과 어떤 컬럼에서 실패했는지 로그에 명확히 남긴다.
- **적용 대상**: `docs/data-model-v2.md`에서 정의한 신규 테이블(`exploration_events`, `sync_batches`, `sync_batch_events`, `session_events`, `session_versions`)은 `create_all`이 처리한다(테이블 자체가 없으므로). ALTER 러너는 오직 **기존 `sessions` 테이블에 컬럼을 추가**하는 것만 담당한다.

## 4. 단계별 롤아웃 (M1~M5)

계획서 G의 마일스톤을 그대로 따르되, 이 문서는 "각 단계에서 기존 기능이 깨지지 않았는지 어떻게 확인하는가"에 집중한다. 태스크별 상세 파일/테스트는 `docs/implementation-roadmap.md`를 참고한다.

| 마일스톤 | 핵심 변경 | 기존 기능 무파손 확인 방법 |
|---|---|---|
| M1 — 계약 확정 & 인제스트 | 모델 5개 + `migrations.py` + config, `event_filter.py`, `POST /events`, 익스텐션 설정 마이그레이션, 매니페스트 권한 확장 | 기존 백엔드 테스트 28개 green 유지(`python -m pytest -p no:asyncio`). `POST /sessions`, `POST /sessions/cluster`, `GET/PATCH/DELETE /sessions/{id}`, `GET /search`를 수동으로 한 번씩 호출해 응답 스키마가 기존과 동일한지 확인. Extension `pnpm compile && pnpm build` 통과 — 매니페스트 권한 추가 후에도 기존 사이드패널 화면(세션 목록/검색/설정)이 그대로 로드되는지 확인 |
| M2 — 수집 & 동기화 엔진 | `lib/events/*`(IDB 큐), `collector.ts`, 체류시간 세그먼트, `sync/engine.ts` | 이 단계는 신규 파일만 추가하고 기존 진입점(`background.ts`의 기존 리스너, `App.tsx` 뷰 전환)을 변경하지 않는다 — 기존 "탭 저장 → 클러스터링 → 요약" 플로우가 여전히 동작하는지 수동 확인. SW devtools에서 IndexedDB에 이벤트가 쌓이는지, SW 강제 종료 후에도 큐와 세그먼트가 유지되는지 확인 |
| M3 — 배치 세션화(Auto Session 코어) | `grouper.py`, `vector.py` score 검색, `llm.py` 리미터, `_embed_and_upsert`→`embedding_sync.py` 이동, `intent_analyzer.py`, `session_updater.py`, `sync_pipeline.py`, `api/sync.py` | `_embed_and_upsert` 이동은 "유일한 기존 코드 리팩터"이므로 이동 전/후 동일 동작을 테스트로 고정(기존 `test_sessions.py`의 관련 테스트가 새 위치를 import하도록 갱신하되 검증 내용은 동일). 기존 스냅샷 경로(`POST /sessions/cluster` → `_ai_update` → `_embed_and_upsert`)가 여전히 성공하는지 통합 확인 |
| M4 — Timeline UI & Intent 검색 | TimelineView, `SyncStatusCard`, `GET /sessions/{id}/events`, `GET /search?scope=memory`, `DELETE /events/{id}`, retry-summary origin 분기 | `GET /search`(scope 생략)가 기존과 동일한 응답을 반환하는지 회귀 테스트. 기존 `SessionListView`/`SessionDetailView`/`SettingsView`가 새 `timeline` 뷰 추가 이후에도 동일하게 동작하는지 확인(뷰 전환 로직에 `timeline` 추가만 되어야 하며 기존 케이스 제거 없음) |
| M5 — Analytics·평가·마무리 | `GET /analytics/overview`, 골든셋 + `run_eval.py`, E2E 스모크 | 계획서 "검증" 절의 E2E 스모크(수집 활성화 → 5개 사이트 방문 → 수동 동기화 → 세션 자동 생성 → Timeline 확인 → Intent 검색 → 복원 → Analytics 확인)를 실행하고, 기존 기능(탭 스냅샷 저장·검색·복원)이 별도로 무파손인지 마지막에 재확인 |

각 마일스톤은 "green 후 진행"을 원칙으로 한다 — 이전 단계의 검증(BE 테스트 전체 통과, EXT `pnpm compile`/`pnpm build`, FE `tsc --noEmit && vite build`)이 끝나기 전에 다음 단계로 넘어가지 않는다.

## 5. 위험과 롤백 한계

- **Additive-only가 유일한 안전 장치다**: 이번 마이그레이션 전략은 "컬럼을 추가만 하고 지우거나 바꾸지 않는다"는 전제 위에 서 있다. 만약 구현 중 기존 컬럼의 타입을 바꾸거나 의미를 바꿔야 하는 상황이 생기면, 이 문서의 멱등 ALTER 러너로는 안전하게 처리할 수 없다 — 그 시점에는 별도 사용자 결정(스키마 변경 승인)이 필요하다.
- **버전 관리·다운그레이드 없음**: `migrations.py`는 "앞으로 나아가는" 것만 처리한다. 특정 시점으로 되돌리는 다운그레이드 경로가 없으므로, 배포된 환경에서 문제가 생기면 롤백은 "이전 컬럼을 남겨둔 채 코드만 되돌리는" 방식으로 제한된다(컬럼을 실제로 지우는 롤백은 지원하지 않는다).
- **1회 리셋 이후 재리셋 금지 원칙**: 리셋을 반복하면 그때마다 팀 공지·데이터 유실이 재발하므로, 리셋 이후에는 반드시 ALTER 러너 경로로만 스키마를 진화시킨다. 만약 다시 리셋이 필요한 상황이 생긴다면 그 자체가 "설계를 잘못 예측했다"는 신호로 보고 원인을 먼저 분석한다.
- **로컬/데모 환경 한정**: 이 절차는 로컬 Docker Compose 환경을 전제로 한다. 별도 배포 환경(스테이징/프로덕션)에 실데이터가 존재한다면 `docker compose down -v` 방식의 리셋을 그대로 적용해서는 안 된다 — 배포 환경 보안/운영 구성은 기존 `docs/DecisionLog.md` "열린 결정"에도 남아 있는 별도 논의 대상이다.
- **Alembic 전환 시점**: 대회 이후 실사용자 데이터가 쌓이기 시작하면, 이 문서의 멱등 ALTER 러너 방식에서 Alembic 기반 버전 관리 마이그레이션으로 전환하는 것을 재검토해야 한다(이번 계획서 범위 밖 — 향후 결정 사항으로 `docs/DecisionLog.md`에 남긴다).
