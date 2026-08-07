# Orbit 목표 아키텍처 — Auto Session / Personal Exploration Memory

> 근거: 계획서 B, C, E. 이 문서는 백엔드·익스텐션을 관통하는 이벤트 흐름과 상태 기계를 정의한다. 테이블 DDL은 `docs/data-model-v2.md`, API 스펙은 `docs/api-design-v2.md`, UI 화면 구조는 extension 새 탭·사이드패널을 따르며 이 문서는 그 전제가 되는 파이프라인을 다룬다.

## 1. 전체 흐름도

```
[Extension — Event Stream]
webNavigation.onCommitted ─┐
onHistoryStateUpdated(SPA) ─┤→ collector.ts → 필터(시스템URL/리다이렉트/opt-in) → IndexedDB 큐(open)
tabs/windows/idle 이벤트 ───┘         체류시간 세그먼트: chrome.storage.session (SW 종료 생존)
content.ts(기존 재사용) → PAGE_CONTENT_READY → 이벤트에 본문 발췌 부착 (민감 도메인 = 본문만 제외, 기존 정책 유지)

트리거(수동 버튼 / chrome.alarms 주기 / pending≥20 / idle 10분) → sync/engine.ts (navigator.locks 뮤텍스)
  → 50개씩 POST /events → 2xx 시 synced 마킹 → 실패 시 지수 백오프(최대 30분) + 재시도 알람

[Backend — Session Builder + Memory Store]
POST /events → 인제스트 필터(시스템 URL 거부·민감 본문 제거·URL 정규화·검색어 추출) → exploration_events(pending)
POST /sync (또는 주기 루프 / 개수 임계) → sync_pipeline.run_batch:
  pending 이벤트 claim(≤150) → 중복 병합(content_hash/normalized_url) → 시간 간격 그룹화(30분 gap)
  → 그룹별: 그룹 임베딩 → Qdrant로 기존 세션 후보 검색(top3, thr 0.35) + 최근 24h 활성 세션(≤5)
  → LLM 의도 분석 1회: {assignments:[{event_indices, action: append|create|hold|discard, target|title, relevance}]}
    (split은 한 그룹이 여러 assignment로 갈리는 것으로 자연 지원, merge는 후순위 — 스키마만 예약)
  → session_updater: 세션 생성/갱신 + session_events + tabs JSONB 대표 페이지 top-20 동기화(하위 호환)
  → 변경된 세션: generate_summary(재사용) → session_versions 기록 → _embed_and_upsert(재사용)
```

이 파이프라인은 `Event Stream(수집) → Session Builder(그룹화+의도분석+세션갱신) → Memory Store(exploration_events/sessions/session_events/session_versions) → Embedding(기존 재사용) → Timeline/Search/Analytics(조회 계층)` 6단계로 구성된다. Timeline·Search·Analytics는 Memory Store를 읽기만 하는 조회 계층이며, 쓰기는 Session Builder(배치)와 인제스트(이벤트 최초 저장) 두 지점으로 한정된다.

## 2. 상태 기계

### 2.1 익스텐션 이벤트 상태 (로컬 큐, IndexedDB)

```
open → pending → syncing → synced
```

- `open`: `collector.ts`가 방문/체류를 감지해 방금 만든 이벤트. 아직 전송 대상 목록에 편입되지 않은 찰나의 상태(생성 직후 바로 `pending`으로 넘어감을 전제로 설계하되, 본문 부착 등 비동기 후처리 중임을 구분하기 위해 유지).
- `pending`: 동기화 대상. `sync/engine.ts`가 트리거 발생 시 이 상태의 이벤트를 최대 50개씩 배치로 읽어 전송한다.
- `syncing`: 전송 중(요청 인플라이트). 응답 전 SW가 죽으면 이 상태로 남을 수 있으므로, 엔진 시작 시 "stale-syncing 리셋"(오래 `syncing`에 머문 이벤트를 `pending`으로 되돌림)이 필요하다.
- `synced`: 서버가 2xx로 accepted 처리한 이벤트. 48시간 후 prune(로컬 큐에서 삭제) 대상.
- 사용자는 동기화 전(`open`/`pending`) 이벤트를 Timeline에서 개별 삭제할 수 있다.
- 큐 상한 5,000개 — 초과 시 `synced`부터 정리하고, 그래도 부족하면 최고령 `pending`을 퇴출하며 `droppedCount`를 UI에 노출한다(무음 데이터 유실 금지).

### 2.2 서버 이벤트 상태 (`exploration_events.sync_status`)

```
pending → processing → processed | discarded
```

- `pending`: 인제스트 직후 기본 상태.
- `processing`: 배치가 `claim`한 상태(동시 배치 실행 방지와 결합).
- `processed`: 어떤 세션에 `append`/`create`로 반영 완료.
- `discarded`: 의도 분석이 노이즈로 판단해 제외(`action: discard`).
- 실패(배치 도중 예외 등) 시 `pending`으로 복귀 — 다음 배치가 자동 재시도한다. 명시적인 `failed` 최종 상태는 두지 않고, `hold_count`로 무한 보류만 방지한다.
- `hold_count`: 의도 분석이 `action: hold`(판단 보류)를 반환할 때마다 증가. `hold_count ≥ 3`이면 다음 배치는 강제로 `create`를 적용해 같은 이벤트가 영원히 보류 루프에 갇히는 것을 막는다.

## 3. Persistent Queue (익스텐션)

- **저장소**: IndexedDB + `idb`(약 1.2KB, 이번 전환의 유일한 신규 프런트 의존성). 사이드패널이 SW를 깨우지 않고 같은 DB를 직접 열람할 수 있어, Timeline의 미동기화 이벤트 렌더링에 그대로 쓰인다.
- **체류시간 세그먼트**: `chrome.storage.session`에 저장한다 — 이 스토리지는 브라우저를 완전히 종료하기 전까지는 유지되면서도 SW가 유휴 종료되었다가 재시작해도 값이 살아있어, "현재 탭에 머문 시간"처럼 SW 생명주기보다 오래 지속돼야 하는 임시 상태에 적합하다. `onActivated`/`onFocusChanged`/`idle`/`onRemoved` 이벤트에서 세그먼트를 갱신하고 30분 캡을 둔다(비정상적으로 긴 체류시간이 기록되는 것을 방지).
- IndexedDB(큐)와 `chrome.storage.session`(체류 세그먼트)의 역할을 분리하는 이유: 큐는 "동기화가 끝나야 지워지는 사실 기록"이고 세그먼트는 "아직 확정되지 않은 진행 중 상태"이기 때문이다.

## 4. 동기화 트리거 4종

| 트리거 | 조건 | 비고 |
|---|---|---|
| 수동 | 사용자가 `SyncStatusCard`의 "지금 저장" 버튼 클릭 | 즉시 실행, 데모/시연에 유용 |
| 주기 | `chrome.alarms`로 15/30/60분 중 설정값 | 사용자가 설정에서 변경 가능(§C-1 SettingsView) |
| 개수 | `pending` 이벤트 수 ≥ 20 | 활발한 탐색 세션 중 큐가 과도하게 쌓이는 것 방지 |
| 유휴 | `idle` 상태 10분 지속 | 탐색이 일단락된 시점을 동기화 적기로 간주 |

4개 트리거는 모두 동일한 `sync/engine.ts` 진입점으로 수렴하며, `navigator.locks`로 뮤텍스를 잡아 동시에 여러 트리거가 겹쳐도 중복 전송이 일어나지 않게 한다.

## 5. 동기화 프로토콜과 실패 복구

- **전송 단위**: `pending` 이벤트를 50개씩 배치로 `POST /events`에 전송.
- **성공**: 응답이 2xx면 전송한 이벤트를 로컬에서 `synced`로 마킹.
- **실패**: 지수 백오프(최대 30분)로 재시도 알람을 예약. 브라우징 자체는 절대 막지 않는다(fail-open) — 수집 실패가 사용자의 정상적인 브라우징을 방해해서는 안 된다는 원칙을 collector 단계부터 동기화 단계까지 일관 적용한다.
- **배치 동시 실행 방지(서버)**: 모듈 레벨 `asyncio.Lock` + `sync_batches.status='running'` 행을 재시작 안전망으로 사용한다. 서버 재시작 시 복구 로직(`recover_pending_sessions` 확장)이 `running`이던 배치는 `failed`로, `processing`이던 이벤트는 `pending`으로 되돌린다 — 기존 `recover_pending_sessions`(요약/임베딩 복구)와 동일한 "재시작 시 중단된 작업을 안전 상태로 되돌리는" 패턴을 이벤트 파이프라인에도 그대로 적용한 것이다.
- **멱등성**: 이벤트 `id`는 클라이언트가 생성한 UUID이자 PK이며, 서버는 `on_conflict_do_nothing`으로 삽입한다. 응답의 `accepted`/`duplicates` 카운트로 클라이언트가 로컬 큐를 정리한다 — SW가 응답을 받기 전에 죽어도, 다음 재전송이 같은 UUID로 들어오므로 서버에 중복 레코드가 쌓이지 않는다.
- **A.X-K1 3 RPS 대응**: 배치 파이프라인의 LLM 호출은 전부 순차 실행하고, `llm.py`에 전역 최소 호출 간격(~500ms) 리미터를 추가해 스냅샷 경로(`POST /sessions/cluster`)와 공유한다. 배치 소요 시간이 2~5분으로 늘어날 수 있으므로 `/sync/status`로 진행 상황(현재 배치/처리량)을 노출한다.

## 6. 개인정보 보호 구조

계획서 E(§11 요구 매핑)를 그대로 인용한다.

| 요구 | 구현 |
|---|---|
| 수집 명시적 opt-in | `collectionEnabled` 기본 **off**, SettingsView 마스터 토글 + `SyncStatusCard` 원탭 활성화(데모 대비) |
| 민감 도메인 제외 | 기존 `sensitive-domains.ts` 재사용(본문만 제외, URL/제목 유지 — 기존 DecisionLog 정책 승계) + **서버측 이중 방어**: `event_filter.py`에 동일 정규식 포팅, 인제스트·배치 양쪽 재검사 |
| 시스템 URL 제외 | 수집 시 + 인제스트 시 이중 거부(`chrome:`/`about:`/확장 페이지/새 탭/3초 미만 리다이렉트) |
| 이벤트/세션 삭제 | 동기화 전: Timeline에서 IDB 직접 삭제. 동기화 후: `DELETE /events/{id}`. 세션 삭제는 기존 유지 |
| 로컬/서버 범위 구분 | 이벤트는 로컬 큐 선저장 → 동기화 시에만 서버 전송. 본문 저장 여부는 `contentCapture` 토글 |
| LLM 전송 전 제외 | 의도 분석 프롬프트에 본문 미포함(제목/도메인/체류만), 본문은 요약 프롬프트에서만 기존 2000자/10개 캡 |
| 수집 상태 상시 표시 | `SyncStatusCard` 활성/일시정지 인디케이터 |

이 표는 "무엇을 수집하는가"보다 "언제·어디까지 사용자 통제가 미치는가"를 기준으로 설계되어 있다 — 로컬 큐 단계에서는 사용자가 전량 열람·삭제 가능하고, 서버로 넘어간 뒤에도 개별 이벤트 삭제가 가능하도록 대칭적으로 설계했다.

## 7. 조회 계층과의 관계

- **Timeline**: Memory Store(`exploration_events`, `session_events`)를 시간 역순으로 읽는 조회 계층. 미동기화 이벤트는 서버를 거치지 않고 IndexedDB에서 직접 읽어 렌더링한다(SW를 깨우지 않기 위함).
- **Search**: 세션 임베딩(Qdrant, 기존 그대로) + 이벤트 텍스트 매칭(`title`/`search_query`/`domain` ILIKE)의 조합. 이벤트 단위 임베딩은 MVP에서 도입하지 않는다(세션 임베딩+키워드로 골든셋 평가 후 결정).
- **Analytics**: 순수 집계 쿼리(`GET /analytics/overview`)로 AI 호출이 없는 계층. Session Builder가 이미 계산해 둔 `total_active_duration_ms`/`keywords` 등을 재사용해 실시간 재계산 비용을 낮춘다.

세 조회 계층 모두 Session Builder가 쓴 데이터를 읽기만 하며, 조회 경로에서 새로운 LLM 호출이나 쓰기가 발생하지 않는다 — "방문 이벤트마다 LLM을 호출하지 않는다"는 핵심 원칙이 조회 계층에도 일관되게 적용된다.
