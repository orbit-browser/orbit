# Orbit 작업 기록

작업, 오류, 원인, 해결 과정과 실제 검증 결과를 시간순으로 기록한다.

## 2026-08-07 — 자동병합 사용자 토글(UI 버튼) + 설정 저장소 (feat/merge-suggestions 이어서)

### 요청

"자동병합은 버튼을 만들어 사용자가 선택할 수 있게". env 플래그가 아니라 런타임 UI 토글 필요.

### 변경 (backend — 앱 설정 저장소)

- `app/db/models.py` — `AppSetting`(key-value, JSONB) 신규 테이블. create_all이 생성(마이그레이션 불필요).
- `app/services/app_settings.py`(신규) — `get_bool`/`set_bool` + `is_auto_merge_enabled()`(DB 값 우선, 없으면 env 기본값).
- `app/schemas/settings.py`·`app/api/settings.py`(신규) — `GET /settings`·`PATCH /settings`(auto_merge_enabled 토글).
- `app/main.py` — settings 라우터 등록.
- `app/services/sync_pipeline.py` — 자동병합 게이트를 `settings.auto_merge_enabled`(env 고정) → `await is_auto_merge_enabled()`(런타임 DB 값)로 교체.
- `tests/test_sync_pipeline.py` — `_process_batch` 테스트 2곳에 신규 협력자 `is_auto_merge_enabled` 대역 추가(실 DB 접근 방지).
- `tests/test_app_settings.py`(신규) — get/set bool 6종(기본값·저장값·비-bool 폴백·insert/update).

### 변경 (frontend — 토글 UI)

- `lib/types.ts`·`lib/api.ts` — `AppSettings{autoMergeEnabled}` + `fetchSettings`/`updateSettings`.
- `hooks/useSettings.ts`(신규) — 설정 조회 + 갱신(성공 시 캐시 즉시 setQueryData).
- `components/merge/MergeSuggestionsSection.tsx` — 헤더에 `AutoMergeToggle` 스위치. 켜짐 안내 문구.
  섹션 노출 규칙 변경: 설정 로드 성공 시 노출, 단 "자동병합 OFF + 제안 0"이면 숨김(자동병합 ON이면 끌 수 있게 항상 노출).

### 검증

- **backend**: `pytest -p no:asyncio` **291 passed**. 라우트 `GET/PATCH /settings` 등록 확인.
- **frontend**: `pnpm build`(tsc 포함) 1851 모듈, 타입 에러 0.
- **라이브 브라우저 토글 스모크**: 대시보드에서 토글 클릭 → `GET /settings` `true` + 스위치 [checked] + 안내 문구 노출 →
  다시 클릭 → `false` 복구. 서버 왕복 완전 동작 확인. **자동병합은 OFF 기본값으로 원복하고 종료**(세션 데이터 무변경).

### 남은 일 / TODO

- 자동병합은 이제 UI 토글로 사용자가 켜고 끌 수 있음(기본 OFF). 켜면 다음 동기화 배치에서 명백한 중복만 자동 병합.
- (선택) 임계값(cos 0.80/제목 자카드 0.80)도 UI 노출할지 여부.

## 2026-08-07 — 일괄병합 + gated 자동병합(기본 OFF) (feat/merge-suggestions 이어서)

### 요청

"P4 계속 진행·검증 + 병합 화면에 일괄병합 추가 + 자동병합 제안·위험 고려".

### 판단 (일괄병합 ≠ 자동병합)

- **일괄병합**(사람이 한 번 확인, 가역) → human-in-loop이라 안전 → 구현.
- **자동병합**(배치 후 시스템 실행) → 문서화된 "자동 파괴 금지"(merge-design §2, AGENTS §11)와 충돌 →
  임의로 켜지 않고 **opt-in·기본 OFF·고임계 '명백한 중복'만·로그·가역** 메커니즘만 구현. 사용자 결정 대기.

### 변경 (frontend — 일괄병합)

- `frontend/src/components/merge/MergeSuggestionsSection.tsx` — "모두 병합" 버튼 추가. 순차 병합하되
  한 배치에서 이미 소비된 세션이 다시 등장하면 건너뛰고(stale 충돌 방지), 성공분은 "모두 되돌리기" 토스트로 일괄 undo.

### 변경 (backend — gated 자동병합, 기본 OFF)

- `app/config.py` — `auto_merge_enabled=False`(기본), `auto_merge_floor=0.80`, `auto_merge_title_jaccard=0.80`.
- `app/services/merge_service.py` — `_title_jaccard`, `is_auto_merge_candidate`(순수: cos≥floor AND 제목 자카드≥임계),
  `auto_merge_duplicates(db)`(제안 중 명백한 중복만 병합, 소비 세션 스킵, (survivor,absorbed) 목록 반환).
- `app/services/sync_pipeline.py` — 배치 재요약 뒤 `if settings.auto_merge_enabled: _run_auto_merge()`(기본 OFF라
  평소 비용 0). 병합 생존 세션 재요약 + 흡수 세션 Qdrant 포인트 삭제. 실패해도 배치는 성공 마무리.
- `tests/test_merge_service.py` — 자동병합 후보 판정 5종(제목 자카드·floor·제목상이 거부).

### 검증

- **backend**: `pytest -p no:asyncio` **286 passed**(자동병합 5종 추가). import 순환 없음(sync_pipeline↔merge_service).
- **frontend**: `pnpm build`(tsc 포함) 1850 모듈, 타입 에러 0.
- **자동병합 게이트 실데이터 프리뷰(읽기 전용, 실행 안 함)**: 실 제안 5쌍에 게이트 적용 시 가비아 중복
  (cos 0.847·제목 자카드 1.00)만 AUTO, 나머지(제주항공권·이터널리턴·낭만인프라)는 제목 상이(자카드 0.17~0.60)로 전부 skip.
- **미실시**: 실 브라우저 렌더 스모크 — 실 DB에 두 번째 백엔드를 붙이면 기동 복구 로직이 사용자 실데이터를
  변경할 수 있어 데이터 보호상 보류(격리 시드 환경에서 별도 확인 제안).

### 남은 일 / TODO

- 자동병합 **켤지 여부는 사용자 결정 대기**(현재 OFF). 켜려면 env `AUTO_MERGE_ENABLED=true`.
- (선택) 격리 시드 환경 실 브라우저 E2E 스모크, 배치 후 제안 뱃지, 익스텐션 사이드패널.

## 2026-08-07 — 세션 병합 P4 대시보드 UI + 실데이터 재튜닝 (feat/merge-suggestions 이어서)

### 요청

"P4 진행 + 도그푸딩 실데이터로 한번 더 튜닝".

### 실데이터 재튜닝 (읽기 전용)

- 도그푸딩 실 DB(18세션)+Qdrant 벡터로 153쌍 코사인 + 키워드 게이트를 읽기 전용 측정.
- 실 세션 요약은 골든보다 코사인이 낮게 분포 → 골든값 0.56이면 정답(낭만인프라↔인프라모니터링 0.533,
  이터널리턴강의↔나어나이 0.544)을 놓침. 분리 구간 [0.44, 0.533] 사이 **0.52** 확정.
- 실 orchestrator `find_merge_suggestions`로 최종 확인: floor 0.52에서 제안 5쌍 전부 진짜 과분할
  (가비아 중복·제주항공권 9+3·이터널리턴 2건·낭만인프라). `app/config.py` merge_suggest_floor=0.52.

### P4 — 대시보드 병합 제안 UI (frontend)

백엔드 변경 없음(기존 `GET /merge-suggestions` + `POST /merge`·`/unmerge`를 대시보드가 온디맨드 소비).

- `frontend/src/lib/types.ts` — `MergeSuggestion` 타입.
- `frontend/src/lib/api.ts` — `fetchMergeSuggestions`/`mergeSessions`/`unmergeSessions` + snake→camel 매핑.
- `frontend/src/hooks/useMergeSuggestions.ts`(신규) — react-query 훅(제안 조회 + merge/unmerge mutation,
  성공 시 sessions·merge-suggestions·관련 session 캐시 무효화).
- `frontend/src/store/ui.ts`·`components/Toast.tsx` — 토스트에 선택적 액션(되돌리기) 지원(액션 시 6초 표시).
- `frontend/src/components/merge/MergeSuggestionsSection.tsx`(신규) — 제안 쌍 카드 목록 + 병합 버튼.
  로딩/에러/제안 없음이면 조용히 숨김(AnalyticsSection 방어 패턴). 병합은 confirm() 확인 후 실행,
  성공 시 "되돌리기" 액션 토스트로 unmerge 노출.
- `frontend/src/views/HomeView.tsx` — 세션 목록과 탐색 분석 사이에 `<MergeSuggestionsSection/>` 삽입.

### 검증

- **frontend**: `pnpm build`(tsc --noEmit 포함) — 1850 모듈 변환, 타입 에러 0, 빌드 성공.
- **실 백엔드 경로(읽기 전용)**: additive 마이그레이션(merged_into·merged_from_session_id 컬럼 추가, 멱등·데이터
  미변경) 적용 후 `find_merge_suggestions` 실행 → 실데이터 5쌍 정상 반환(Qdrant get_vector +
  search_similar_with_scores@0.52 + evaluate_pair 전 경로).
- **backend**: `pytest -p no:asyncio` 281 통과 유지.
- 미실시: 실 브라우저 렌더 스모크(양 서버 기동 필요). 실 세션 병합 클릭은 사용자 데이터 보호를 위해 하지 않음.

### 남은 일 / TODO

- (선택) 실 브라우저 E2E 스모크 — 대시보드에서 병합 제안 섹션 렌더/병합/되돌리기 흐름 육안 확인.
- (선택) 배치 후 제안 자동 생성 + 뱃지, 익스텐션 사이드패널 노출은 미구현(대시보드 우선 결정에 따라 보류).
- 실 DB에 additive 컬럼이 적용됨 — main 체크아웃 시에도 무해(미사용 nullable).

## 2026-08-07 — 세션 병합 P2 실행 + P3 undo + floor 튜닝 (feat/merge-suggestions 이어서)

### 요청

"이 브랜치에서 전체 구현 + 테스트 + 튜닝까지". P0+P1에 이어 P2(병합 실행)·P3(undo) 구현 + `merge_suggest_floor` 실측 튜닝.

### 변경

- `app/db/models.py` — `SessionEvent.merged_from_session_id VARCHAR(36) NULL`(undo 복원 기준).
- `app/db/migrations.py` — 러너를 `{table: [(col, ddl)]}` 다중 테이블로 일반화(멱등 유지), session_events 컬럼 추가.
- `app/services/merge_service.py`(신규) — `merge_sessions`/`unmerge_sessions` + 게이트웨이(`_fetch_events_ordered`,
  `_move_event`, `_delete_event`, `_recompute_session_stats`) + 순수 `_union_keywords`. `MergeError(code)`→HTTP 매핑.
- `app/schemas/session.py` — `MergeRequest{absorbed_id}`.
- `app/api/sessions.py` — `POST /sessions/{id}/merge`·`/unmerge`(동기 DB + 백그라운드 재요약/재임베딩),
  `list_sessions`에 `status!='merged'` 필터.
- `app/services/sync_pipeline.py` — `_fetch_candidates` 최종 조회에 `status=='active'` 이중 방어(Qdrant 삭제 실패 대비).
- `app/config.py` — `merge_suggest_floor` 0.6 → 0.56(골든) → **0.52**(실데이터 튜닝 최종).
- `tests/test_merge_service.py`(신규) — merge/unmerge 검증 분기·정상 경로·`_union_keywords` 10종.
- `eval/merge_golden.json`·`eval/tune_merge_floor.py`(신규) — 병합 탐지 골든셋 + 실 임베딩 floor 튜닝 하네스.

### 검증

- `python -m pytest -p no:asyncio` — **281 passed**(P0+P1 15 + P2/P3 10 신규 포함).
- 앱 전체 임포트·라우트 등록 확인(merge/unmerge/merge-suggestions 정상 등록).
- **실 SQL 통합**: 일회용 postgres 컨테이너(포트 55432, 사용자 데이터 미접촉)에 A/B+events 삽입 →
  merge → 검증(A 5건·B 0건·shared dedup·b1/b2 merged_from='B' 태그·재계산·keyword 합집합·B `status='merged'`) →
  unmerge → 검증(A 3건·B 2건·태그 제거·B 재활성화). 전 항목 통과 후 컨테이너 제거.
- **튜닝(골든)**: `python -m eval.tune_merge_floor`(실 Upstage passage 임베딩) — 양성 0.645~0.739, 음성 0.236~0.472,
  완전 분리(gap +0.173) → 밴드 중앙값 0.56.
- **튜닝(실데이터, 최종)**: 도그푸딩 18세션 153쌍 읽기 전용 측정(실 Qdrant 벡터+키워드 게이트) — 실 요약은 코사인이
  더 낮게 분포해 0.56이 정답을 놓침(낭만인프라 0.533, 이터널리턴강의↔나어나이 0.544). 분리 구간 [0.44, 0.533] 사이
  **0.52** 확정. 0.52에서 제안 5쌍 전부 진짜 과분할(가비아 중복·제주항공권 9+3·이터널리턴 2건·낭만인프라).
  실데이터 접근은 읽기 전용(필요 컬럼만 select, 스키마·데이터 미변경).

### 남은 일 / TODO

- P4(배치 후 자동 제안 생성 + 대시보드/사이드패널 UI). UI 위치는 대시보드 우선으로 합의됨.
- 병합 전용 version note는 record_version 시그니처에 없어 미기록(재요약이 새 version 자연 생성) — 필요 시 추후.
- 골든 양성 4개는 curated 소표본 — 실데이터 제안 품질은 P4 노출 후 재측정.

## 2026-08-07 — 세션 병합 P0 스키마 + P1 제안 API (feat/merge-suggestions)

### 요청

merge 구현 착수. 먼저 merge-design §9 열린 결정을 사용자와 합의한 뒤 P0+P1만 구현.

### 결정 (2026-08-07 확정, DecisionLog 참조)

범위=P0(스키마)+P1(읽기 전용 제안), 탐지=벡터 floor AND 키워드 겹침(정밀 우선),
생존=이벤트 많은 쪽(동률 시 이른 started_at→id), UI 위치=웹 대시보드 우선(구현은 P2).

### 조사 / 사실 정정

- 세션 요약 임베딩은 Qdrant `orbit_sessions`(COSINE, dim 4096)에 `embedding_status='done'`일 때만 저장.
  `search_similar_with_scores`로 점수 기반 근접 검색 가능.
- 마이그레이션 러너(`db/migrations.py`)는 sessions 테이블 컬럼 추가만 담당(멱등 ALTER).
- **[정정]** merge-design §5의 "list API는 status='active'만 반환" 가정은 **틀림** —
  `list_sessions`에 status 필터가 없다. 이번 범위(merged 세션 미생성)에서는 무해하나 **P2에서 필터 필수**.
- FastAPI 라우트 순서상 `/sessions/merge-suggestions`를 `/sessions/{session_id}`보다 먼저 등록해야 함.

### 변경

- `app/db/models.py` — `Session.merged_into VARCHAR(36) NULL` 추가(P0, 기록은 P2부터).
- `app/db/migrations.py` — `_SESSIONS_COLUMNS`에 `merged_into` 멱등 ALTER 추가.
  `session_events.merged_from_session_id`는 이벤트 이전이 실제 일어나는 P2로 연기(러너 일반화 필요·현재 미사용).
- `app/config.py` — `merge_suggest_floor`(기본 0.6, 미측정 잠정값), `merge_suggest_max_pairs`(50).
- `app/db/vector.py` — `get_vector(session_id)` 추가(저장 벡터 조회, 실패/부재 시 None).
- `app/services/merge_suggester.py`(신규) — 순수 판정 함수(`evaluate_pair`, `keyword_overlap`,
  `_pick_survivor`) + 오케스트레이터(`find_merge_suggestions`, 읽기 전용).
- `app/schemas/session.py` — `MergeSignal`, `MergeSuggestion` 추가.
- `app/api/sessions.py` — `GET /sessions/merge-suggestions`(읽기 전용, `/{session_id}`보다 먼저 등록).
- `tests/test_merge_suggester.py`(신규) — 순수 함수 15종(floor 경계·AND 미충족·생존자 tie-break·제목 fallback).
- `docs/Plan.md` — merge P0+P1 계획으로 갱신.

### 검증

- `python -m pytest -p no:asyncio` — **271 passed**(기존 256 + 신규 15).
- 라우트 등록 순서 확인: `/sessions/merge-suggestions`가 `/sessions/{session_id}` 앞에 등록됨.
- 오케스트레이터(Qdrant/DB 의존)는 단위 테스트 미대상 — 로직을 순수 함수에 집중(AGENTS §12).

### 남은 일

- `merge_suggest_floor` 골든/실데이터 튜닝 후 DecisionLog 갱신.
- P2(병합 실행 API + `list_sessions` status 필터 + `merged_from_session_id`), P3(undo), 대시보드 UI.

## 2026-08-06 — 메일 노이즈 규칙 title 보강 + 세션 병합 설계 (feat/subcluster-append-gating 이어서)

### 요청

실데이터 검수 후속: (1) gmail·naver 받은편지함 스침이 세션에 새어드는 문제를 노이즈 규칙으로 보강,
(2) 같은 주제 과분할·중복 세션에 대한 merge 설계.

### 조사

- 새어든 메일 이벤트 실 URL 확인: gmail `/mail/u/1/#inbox`→정규화 `/mail/u/1/`(경로에 inbox 신호 소멸),
  naver 루트 `mail.naver.com/`(folders 경로 아님). 둘 다 **title은 "받은편지함/받은메일함"으로 시작**.
  개별 메일 읽기는 title이 메일 제목이라 구분 가능. naver `/v2/folders/0/all`는 기존 folders 경로 규칙으로
  이미 discard(그래서 root 1s만 샜음).
- merge: models에 merge 필드 없음. 기존 원칙 "자동 병합 금지 + 사용자 확인 UI"(improvement-report,
  ProjectContext) 확인 → 제안+확인+가역 방향으로 설계.

### 변경

- `app/services/noise_filter.py` — `_MAIL_LIST_TITLE_RE`(`^(받은편지함|받은메일함)`) 추가,
  `_is_mail_list_view(host, path, title)`로 시그니처 확장(목록 경로 OR 받은편지함 title). `is_noise`가 title 전달.
- `tests/test_noise_filter.py` — `_event`에 title 파라미터, 신규 테스트 3종(gmail/naver 받은편지함 noise,
  개별 읽기 보존). 기존 `test_gmail_root_ambiguous_survives`(title 없음)는 그대로 통과.
- `eval/golden/mail_inbox_refresh_is_noise.json` — gmail `/mail/u/1/#inbox`·naver 루트 케이스 2건 추가.
- `docs/merge-design.md`(신규) — 세션 병합 설계(제안+확인+가역, 다중 신호 탐지, soft-delete+undo,
  스키마·API 3단계·로드맵·열린 결정).

### 검증

- `pytest tests/test_noise_filter.py` 통과, 전체 **259 passed**.
- 골든 `mail_inbox_refresh_is_noise` 단독 실행: 노이즈 제외율 100%, 실패 0(gmail/naver 루트 discard 확인).

### 남은 일

- merge는 설계만. `merge-design.md` §9 열린 결정(임계값·생존 선택·노출 시점·UI) 합의 후 P1(읽기 전용 제안)부터 착수.

## 2026-08-06 — 그룹 내 서브클러스터링 + append 게이팅 (feat/subcluster-append-gating)

### 요청

Auto Session 재세션화의 "그룹 간 과잉 append" 구조적 불안정을 1+2(임베딩 서브클러스터링 +
append 게이팅)로 해결. 계약부터 잡고 골든셋으로 검증.

### 조사

- `_process_group` 흐름 확인: 그룹 전체 1회 임베딩 → 후보검색 → analyze(그룹 전체) → apply.
  다주제 그룹이 한 임베딩·한 LLM 호출로 들어가 뭉침 여지. `search_similar_with_scores`는 score를
  계산하나 `_fetch_candidates`가 버림(게이팅에 재활용 가능).
- numpy 2.2.6 사용 가능, Upstage 임베딩 배열 입력(배치) 가능 확인.
- 골든 이벤트 임베딩 코사인 분포 실측(진단 스크립트) → subcluster_threshold 안전 밴드 도출.

### 변경

- `app/services/subclusterer.py`(신규) — average-linkage 응집 서브클러스터링 순수 함수.
- `app/ai/embedding.py` — `embed_many`(배열 배치 임베딩, 순서 보존) 추가.
- `app/services/sync_pipeline.py` — `_process_group` 재작성(embed_many→subcluster→클러스터별
  후보검색/analyze/게이트→collect-then-apply). `_event_embedding_text`·`_centroid`·`_gate_appends`·
  `_append_blocked` 추가. `_fetch_candidates`/`_sessions_to_candidates`가 벡터 score 노출.
  `_process_group` 반환을 모델 목록으로 변경, `_process_batch`가 이를 카운트.
- `app/config.py` — `subcluster_threshold`(0.31)·`append_score_floor`(0.35)·`append_max_age_days`(3).
- `eval/run_eval.py` — 서브클러스터링 경로 반영(embed_many+subcluster, 클러스터별 analyze),
  임베딩 record/replay 추가(call_key에 cluster_index), `_scenario_paths`가 `_`접두 파일 제외.
- `tests/test_subclusterer.py`·`test_embedding.py`(신규), `test_sync_pipeline.py`(게이트·하드스플릿·
  score 케이스 갱신).

### 오류와 해결

- **replay `KeyError('name')`**: 기록 파일을 `eval/golden/`에 저장했더니 시나리오 glob(`*.json`)이
  기록 파일을 시나리오로 로드하려다 실패. 원인=파일 위치와 glob 충돌. 해결=`_scenario_paths`가
  `_`접두 파일(기록 산출물)을 제외(docstring의 `_recorded.json` 컨벤션과 일치).

### 설계 결정

- 조건부 하드 스플릿(사용자 승인): 클러스터 2개 이상일 때만 분리 → 뭉침 구조적 차단, 단일주제 그룹은
  호출 1회 유지. collect-then-apply로 재병합 방지.
- subcluster_threshold=0.31: 골든 코사인 실측 안전 밴드 [0.30,0.32] 중앙(과분할 경고 존중).
- 게이트는 append→create 강등만(순수 함수), 실패 시 session_updater fallback 제목 사용.

### 검증

- `python -m pytest -p no:asyncio` → **256 passed**.
- 골든 11개(실 LLM+임베딩): Assignment/Purity/Coverage **100%**, 노이즈 94.1%, New-vs-Existing 81.8%.
  mixed_topics가 travel/coding 2 클러스터로 정확 분리(교차주제 메가 뭉침 소멸).
- New/existing 2건 미스매치는 서브클러스터링 회귀 아님을 실증: 단일 클러스터라 LLM 입력이 기존과 동일,
  재실행 시 append↔create 뒤집힘(비결정성) + EXAONE create-bias. 클러스터링 품질 지표는 100% 유지.
- 백엔드 전용 변경이라 extension/frontend 무영향.

### 실데이터 검증 (재세션화 2회, 사용자 승인)

- 대상: 라이브 DB 이벤트 150개(2026-08-05). 사전 DB 백업(pg_dump 463KB, 복구용). 이벤트 pending 복귀
  + event-origin 세션 삭제 + 단일 배치 재구성을 2회 반복(각 배치 후 남은 hold는 드레인 배치로 해소).
- **핵심 개선 확인**: before의 메가 뭉침("여행 계획 및 항공권 검색" 18개가 항공권+브랜드로고+여름음악
  +맥미니+행성궤도를 흡수, "이터널 리턴" 33개)이 **두 run 모두에서 재발하지 않음**. 여행/항공권이
  무관 주제를 흡수하지 않고, 여름음악(2)·맥미니(2)·행성궤도(2)·Tailscale(13)·강의(2)가 독립 세션으로
  안정 재현. 150개 전부 처리(0 pending, discarded 16~19).
- **잔여 변동(경미)**: 하나의 일관된 주제 영역 *내부* 세분화가 run별로 다름(이터널리턴 20+12+2+1 ↔ 32+2,
  항공권 6+5 ↔ 9+3). 교차주제 오염이 아니라 클러스터 내 LLM 판단 + EXAONE create-bias(중복 제목
  "나어나이 이터널 리턴" 2건) — merge(후순위) 영역.
- **게이트는 이 데이터셋에서 사실상 미발동**: 전부 같은 날(08-05)이라 배치 내 새 세션은 recent-24h
  경로(score None)로 후보에 올라 유사도 게이트를 우회하고 age(3일)도 0일이라 안 걸린다. 즉 이번 개선은
  거의 전부 서브클러스터링 효과이며, append 게이트(유사도 하한/시간 근접)의 실효 검증은 교차-일(cross-day)
  ·오래된 후보가 있는 데이터가 필요하다(현재는 단위 테스트로만 검증).
- **부수 관측(기존 취약점, 본 작업 무관)**: 일부 배치에서 EXAONE serverless rate limit(→A.X 폴백) 다발 +
  `extract_json`의 greedy `_JSON_OBJ_RE`가 JSON 뒤 추가 텍스트에 "Extra data"로 실패→그룹 hold. 재시도
  (다음 배치)로 자연 해소돼 최종 결과에는 영향 없음. 파서 강건화(raw_decode)는 별도 소과제 후보.

### 남은 일

- append 게이트 임계값 실효 검증·튜닝은 cross-day/오래된 후보가 있는 실데이터 필요(단일일 데이터로는 미발동).
- EXAONE create-bias 중복 세션(같은 주제 재생성)은 merge(후순위) 영역 — 별도 결정.
- (선택) `extract_json` raw_decode 강건화로 "Extra data" hold 감소.
- 현재 DB는 재세션화 결과 상태(17 세션). 원상복구가 필요하면 scratchpad의 백업 SQL로 복원 가능.

## 2026-07-12 — 필수 프로젝트 문서 초기 세팅

### 요청

`AGENTS.md`를 읽고 해당 규칙에 필요한 파일을 세팅한다.

### 조사

- `AGENTS.md` 전체를 확인했다.
- `docs/`에는 `improvement-report.md`만 존재했다.
- `README.md`, `IMPLEMENTATION.md`, `ppt.md`, 개선점 리포트에서 프로젝트 목표와 현재 구현을 확인했다.
- 작업 시작 시 사용자 변경 파일은 `CLAUDE.md`, `docs/improvement-report.md`, 새 `AGENTS.md`였다.

### 변경

- 필수 문서 10종의 초기 버전을 생성했다.
- 프로젝트 목표, 정보 구조, 사용자 시나리오, 페르소나를 분리해 기록했다.
- 확인된 기술 결정과 아직 사용자 결정이 필요한 항목을 구분했다.
- 작업 프로세스와 완료 체크리스트를 추가했다.

### 오류와 해결

- 없음.

### 검증

- 필수 문서 10종의 존재 여부를 확인했다: 모두 존재.
- 각 문서의 최상위 Markdown 제목을 확인했다: 모두 존재.
- `git diff --check`를 실행했다: 오류 없음.
- 애플리케이션 코드를 변경하지 않아 테스트와 빌드는 실행하지 않는다.

## 2026-07-12 — 1차 안정화

### 요청

개선 리포트의 1차 안정화 항목을 구현하고 리포트를 읽기 쉽게 갱신한다.

### 변경

- AI 요약 오류와 빈 overview를 실패 상태로 전파했다.
- pending 폴러가 목록과 상세 캐시를 함께 갱신하도록 수정했다.
- Backend 전체 장애를 검색 빈 결과와 구분해 표시했다.
- 실제 국내 금융/결제 도메인을 보강하고 `.or.kr` 전면 차단과 미사용 `bookmarks` 권한을 제거했다.
- 기동 복구 작업을 참조가 유지되는 단일 순차 task로 변경했다.
- PATCH 제목의 최대 길이를 100자로 검증했다.
- 개선 리포트를 완료 상태와 다음 우선순위 중심으로 재구성했다.

### 오류와 해결

- 첫 검증 명령이 잘못된 작업 디렉터리와 PowerShell 실행 정책 때문에 실패했다. 저장소 루트와 `pnpm.cmd`를 사용하도록 수정했다.
- 시스템 Python에 `qdrant_client`가 없어 테스트 수집이 실패했다. `python -m pip install -e 'backend[dev]'`로 선언된 의존성을 설치했다.
- 설치된 pytest 9와 전역 pytest-asyncio 0.23.3이 충돌했다. 테스트가 `asyncio.run()` 기반이라 `-p no:asyncio`로 불필요한 플러그인을 제외했다.
- Extension에 선언된 Readability 패키지가 로컬에 설치되지 않아 타입 검사가 실패했다. lockfile 기준으로 의존성을 설치하고 재실행했다.

### 검증

- `python -m pytest -p no:asyncio`: 20 passed.
- `pnpm.cmd compile` (`extension/`): 통과.
- `pnpm.cmd build` (`extension/`): 통과.
- `pnpm.cmd build` (`frontend/`): 통과.
- 대표 민감 URL 5개와 일반 URL 2개의 `isSensitiveUrl` 판정: 통과.
- `git diff --check`: 최종 변경 후 통과.

## 2026-07-12 — P2 검색 정확도 및 오류 계약

### 요청

1차 안정화를 커밋하고 P2 검색 정확도 개선을 진행한다.

### 변경

- 1차 안정화 변경을 `930a5ce`로 커밋했다.
- Qdrant 검색에 설정 가능한 score threshold를 추가하고 기본값을 `0.35`로 정했다.
- 저장 임베딩 입력에 세션 제목을 포함했다.
- 검색 임베딩 timeout, 연결, upstream 상태, 응답 형식 오류를 504/503/502로 구분했다.
- Qdrant 검색 장애를 내부 상세가 없는 503 응답으로 변환했다.
- threshold 전달, 제목 임베딩 텍스트, 검색 오류 매핑 테스트를 추가했다.

### 제한과 후속 작업

- `0.35`는 초기 기본값이며 실제 골든셋 실측 후 조정해야 한다.
- 기존 Qdrant 포인트는 자동 재색인되지 않아 신규·재처리 세션부터 제목 임베딩이 적용된다.

### 검증

- `python -m pytest -p no:asyncio`: 28 passed.
- `pnpm.cmd compile` (`extension/`): 통과.
- `pnpm.cmd build` (`extension/`): 통과.
- `pnpm.cmd build` (`frontend/`): 통과.
- `git diff --check`: 최종 변경 후 통과.

## 2026-08-03 — M2 수집기 & 로컬 큐 & 동기화 엔진 (`feat/auto-session`)

### 요청

`docs/Plan.md` M2(6~10단계) — 상시 방문 이벤트 수집, IndexedDB 기반 Persistent Queue,
체류시간 세그먼트, 본문 부착, 4트리거 동기화 엔진을 구현한다. M1에서 준비된
`lib/settings.ts`와 매니페스트 권한(webNavigation/alarms/idle)을 그대로 사용한다.

### 변경

- `extension/lib/events/types.ts`(신규): 로컬 `ExplorationEvent`(camelCase) ↔ 서버
  `WireEvent`(snake_case) 변환 경계. `toWire()`가 `source: 'browser'` 고정, `domain`
  제외(서버가 인제스트 시 재계산).
- `extension/lib/events/db.ts`(신규): `idb`로 `orbit` DB(`events` 스토어, `by-status`/
  `by-visitedAt` 인덱스)를 여는 lazy 싱글턴.
- `extension/lib/events/queue.ts`(신규): 상태 기계(open→pending→syncing→synced) 전이
  전체 — `addEvent`/`attachContent`/`addDwell`/`finalizeOpenEvent`/`finalizeAllOpen`/
  `claimPending`/`markSynced`/`releaseToPending`(지수 백오프)/`resetStaleSyncing`/
  `prune`(48h)/`evictIfOver`(5000, synced 우선). 모든 뮤테이션 후 `orbit:syncStatus`
  (`pendingCount`/`todayCount`/`lastSyncAt`/`lastError`/`droppedCount`)를
  `chrome.storage.local`에 갱신.
- `extension/lib/events/collector.ts`(신규): `webNavigation.onCommitted`/
  `onHistoryStateUpdated`(SPA, 500ms 디바운스)/`tabs.onUpdated`(title)/
  `tabs.onActivated`/`windows.onFocusChanged`/`idle.onStateChanged`/`tabs.onRemoved`를
  `initCollector()`에서 동기적으로 등록. 탭 상태·활성 세그먼트는 `chrome.storage.session`
  (SW 종료 생존). 3초 미만 리다이렉트는 URL 치환, 그 외에는 새 이벤트 생성. 모든 큐 호출은
  fail-open(try/catch로 감싸 브라우징을 막지 않음).
- `extension/lib/sync/engine.ts`(신규): `navigator.locks`(`ifAvailable`) 뮤텍스로
  `requestDrain(reason)`을 직렬화. 50개씩 `postEventBatch` 전송, 성공 시 `markSynced`
  반복, 실패 시 `releaseToPending(backoff)` + `orbit-retry` 1회성 알람 예약 후 중단.
- `extension/lib/sync/triggers.ts`(신규): 수동(`SYNC_NOW` 메시지)/주기(`orbit-sync`
  알람, 설정 반응형)/개수(`countThreshold` 이상 시)/유휴 4트리거를 `requestDrain`으로
  수렴. SW 시작 시 `resetStaleSyncing(5분)` + `prune` + `evictIfOver` 실행.
- `extension/entrypoints/background.ts`: 컴포지션 루트화 — `initCollector()`/
  `initTriggers()` 호출 추가. 기존 `TABS_CHANGED`/`GET_CURRENT_TABS`/`GET_PAGE_CONTENT`
  동작은 무변경. `PAGE_CONTENT_READY` 핸들러가 기존 캐시 갱신에 더해
  `handlePageContentReady`(큐 부착)도 호출.
- `extension/lib/api.ts`: `postEventBatch` 추가(기존 `enrichTabs`/세션 API는 무변경).
- `extension/lib/messages.ts`(죽은 코드 부활): 기존 메시지 + `SYNC_NOW`/
  `GET_SYNC_STATUS`를 포함한 타입드 유니온으로 갱신(현재 실사용처는 아직 없음 — M4
  사이드패널에서 소비 예정).
- `extension/package.json`: `pnpm add idb`로 `idb@8.0.3` 의존성 추가.
- `extension/entrypoints/content.ts`: 변경 없음 — 기존 `EXTRACT_CONTENT` 핸들러가
  매 호출마다 현재 DOM을 새로 파싱해 응답하므로, SPA 온디맨드 pull에 그대로 재사용 가능해
  추가 변경이 불필요했다.

### 계약과 다르게 구현한 부분 (이유)

- `ExplorationEvent`에 계약 명세에 없는 `syncingStartedAt: string | null` 필드를
  추가했다(`toWire()`에서는 제외). `resetStaleSyncing(olderThanMs)`이 "오래 syncing에
  머문" 이벤트를 판별하려면 syncing 전환 시각이 필요한데, 명세된 필드만으로는 이 값을
  알 수 없었다.
- `WireEvent.content_excerpt`를 `string`(non-null)으로 정의하고 `toWire()`에서
  `null → ''`로 치환한다. `backend/app/schemas/event.py`의 `ExplorationEventIn`이
  `content_excerpt: str = ""`로 선언돼 있어(널 불허) `docs/api-design-v2.md`의
  `"content_excerpt": null` 예시와 실제 스키마가 어긋났다 — 과제 지시대로 스키마 파일을
  최종 근거로 따랐다.
- 유휴 트리거를 "idle.onStateChanged==='idle'이면 즉시 requestDrain"이 아니라,
  idle 진입 시 `settings.idleSyncMin`분짜리 1회성 `chrome.alarms`를 예약하고 active
  복귀 시 취소하는 방식으로 구현했다. `chrome.idle.setDetectionInterval(60)`(체류시간
  세그먼트용, 60초)과 별개로 "유휴가 idleSyncMin(기본 10분) 지속되면 동기화"라는
  `target-architecture.md` §4의 트리거 정의를 만족시키려면 60초 단위 idle 신호와
  실제 동기화 시점을 분리해야 했다. `setTimeout`은 MV3 SW가 유휴 중 종료되면 유실되므로
  쓰지 않고 `chrome.alarms`(SW 재시작에도 생존)로 구현했다.
- 개수 트리거(`pending ≥ countThreshold`)는 `queue.ts`가 `sync/triggers.ts`를 직접
  참조하지 않도록, `setPendingChangeListener` 콜백 훅으로 느슨하게 연결했다(모든
  뮤테이션 후 재계산된 `pendingCount`를 리스너에 전달).

### 검증

- `pnpm compile` (`extension/`): 통과.
- `pnpm build` (`extension/`): 통과. `.output/chrome-mv3/manifest.json`에
  `webNavigation`/`alarms`/`idle`/`tabs`/`storage`/`sidePanel` 권한이 모두 유지됨을 확인.

### 수동 검증이 필요한 항목 (브라우저 실행 불가로 이번 세션에서는 확인하지 못함)

- SW devtools 강제 종료 후 `chrome.storage.session`의 탭 상태·활성 세그먼트 생존, 재시작
  직후 `resetStaleSyncing`이 고아 `syncing` 이벤트를 되돌리는지.
- YouTube/Maps 등 SPA 폭주 사이트에서 500ms 디바운스가 충분한지, 짧은 리다이렉트(<3초)
  치환이 실제로 이벤트 수를 줄이는지.
- 체류시간 세그먼트: 탭 전환/창 포커스 아웃/유휴/탭 종료 각 케이스에서 dwell이 정확히
  마감되고 30분 상한이 적용되는지.
- 유휴 트리거: `idleSyncMin` 경과 후 실제로 `requestDrain('idle')`이 호출되고, 중간에
  active로 돌아오면 알람이 취소되는지.
- 동기화 엔진: 백엔드 다운 상태에서 지수 백오프(최대 30분) 후 `orbit-retry` 알람으로
  재시도되는지, 회복 후 `duplicates` 카운트로 중복 전송이 없는지.
- 큐 상한(5,000) 초과 시 `synced` 우선 정리 → 최고령 `pending` 퇴출 → `droppedCount`가
  사이드패널에 노출 가능한 형태로 쌓이는지(사이드패널 UI 자체는 M4 범위).

## 2026-08-03~04 — Personal Exploration Memory 전환 종합 (M0~M5, `feat/auto-session`)

### 요청과 배경

열린 탭을 분류·요약해 저장하는 것 자체는 지속적인 사용자 가치가 아니고, 탐색 중
사고의 흐름(Context)이 시간이 지나면 사라지는 문제가 더 근본적이라는 판단에 따라
(`docs/DecisionLog.md` 2026-08-03 "제품 방향 전환" 항목) Orbit을 "탭 스냅샷 분류"
도구에서 "상시 이벤트 수집 + 배치 세션화" 기반 Personal Exploration Memory로
전환했다. 기존 요약(`generate_summary`)·임베딩 검색(Qdrant)·복원·민감 도메인 필터는
새로 만들지 않고 그대로 재사용하는 것을 전제로, M0(설계 문서) → M1(이벤트 인제스트) →
M2(수집기·로컬 큐·동기화 엔진) → M3(배치 세션화 파이프라인) → M4(Timeline·Intent 검색) →
M5(Analytics·평가 하네스) 순으로 진행했다. M2는 별도 항목(위 "M2 수집기 & 로컬 큐 &
동기화 엔진")으로 이미 기록되어 있어 여기서는 전체 마일스톤 관점에서 6개 커밋과
전체 검증 결과를 종합한다.

### 마일스톤별 커밋과 범위

- `71d5344` (M0, docs) — `product-direction-v2`/`current-state-audit`/
  `target-architecture`/`data-model-v2`/`api-design-v2`/`migration-plan`/
  `evaluation-plan`/`implementation-roadmap` 신규 작성, `ProjectContext`/
  `DecisionLog`(2026-08-03 결정 6건)/`Plan`/`Personas`/`IA`/`UserScenarios` 갱신.
- `866fea9` (M1, feat(events)) — `exploration_events`/`sync_batches`/
  `sync_batch_events`/`session_events`/`session_versions` 모델과 `sessions` additive
  컬럼 9개, 멱등 ALTER 러너(`app/db/migrations.py`), `event_filter.py`(URL 정규화·
  시스템 URL 거부·민감 도메인 판정·검색어 추출), `POST /events`, Extension
  `lib/settings.ts`(chrome.storage 기반 공용 설정)와 매니페스트 신규 권한
  (webNavigation/alarms/idle).
- `9afec1d` (M2, feat(collector)) — IndexedDB 기반 Persistent Queue와 이벤트 상태
  기계(open→pending→syncing→synced), `webNavigation` 방문 감지·체류시간 세그먼트,
  `navigator.locks` 기반 동기화 엔진과 4트리거(수동/주기/개수/유휴). 상세는 위 M2
  항목 참고.
- `c14d023` (M3, feat(sync)) — 배치 내 중복 병합·시간 그룹화(`grouper.py`), LLM 의도
  분석(append/create/hold/discard, `intent_analyzer.py`), 세션 생성/갱신
  (`session_updater.py`), `asyncio.Lock` 직렬화 배치 파이프라인(`sync_pipeline.py`),
  `POST /sync`/`GET /sync/status`. A.X-K1 전역 0.5초 최소 호출 간격 리미터 추가.
- `c09f73b` (M4, feat(timeline)) — `GET /sessions/{id}/events`·`/versions`,
  `GET /search?scope=memory`(세션+관련 이벤트 통합), `GET /events?date=`,
  `DELETE /events/{id}`. Extension `TimelineView`를 사이드패널 기본 홈으로,
  `SyncStatusCard`(opt-in 온보딩), `SettingsView` 수집·동기화 섹션 추가.
- `397189a` (M5, feat(analytics)) — `GET /analytics/overview`(순수 SQL 집계, AI
  호출 없음), `backend/eval`(골든셋 3개 + `run_eval.py`, 지표 5종), 웹 대시보드
  `HomeView` 탐색 분석 섹션, 미참조 죽은 코드 9파일 삭제.

### 검증

- `python -m pytest -p no:asyncio`: 204 passed (이번 문서 갱신 세션에서 재실행해
  재확인).
- Extension `pnpm compile` / `pnpm build`, Frontend `pnpm build`: 각 커밋 시점에
  통과(커밋 메시지 기준. 최종 상태 재확인은 이번 세션에서 다시 실행하지 않았다).
- 실환경 E2E 스모크(실 Postgres/Qdrant/LLM, 커밋 메시지 기록 기준): M3에서 이벤트
  4개 인제스트(멱등성·필터) → 배치 → 'RTX 5070 구매 분석' 단일 세션 자동 생성 →
  `session_events` 순서/버전 기록 → 벡터 검색 히트까지 확인. M4에서 timeline/versions/
  memory 검색 실 DB 스모크(UTF-8 정상) 확인. M5에서 analytics 실 DB 스모크 확인.
- 세션 분류 평가 하네스(`backend/eval/run_eval.py`, 실 LLM 1회 실행, 커밋 메시지
  기록 기준): Assignment Accuracy·Purity·Coverage·New-vs-Existing 4개 지표 100%,
  노이즈 제외율(noise exclusion rate) 50%. 원인: 골든셋의 노이즈 이벤트(체류시간이
  짧은 SNS 방문 등)를 의도 분석이 discard로 제외하지 않고 별도 세션으로 새로
  생성(create)한 사례가 있었다 — 프롬프트 개선이 필요한 항목으로 식별되었다.

### 남은 일

- 크롬 실기기 수동 검증: 위 M2 항목에 정리된 SW 강제 종료 생존/디바운스/체류시간/
  유휴 트리거/동기화 백오프·복구/큐 상한 목록에 더해, M4~M5에서 추가된 TimelineView·
  SyncStatusCard 온보딩·SearchView 2그룹 렌더·Analytics 대시보드도 실제 Chrome에서
  아직 수동으로 확인하지 못했다.
- 노이즈 제외율 50%의 원인이 된 의도 분석 프롬프트의 discard 판단 기준 보강.
- 검색 score threshold(`0.35`, `docs/DecisionLog.md` 2026-07-12 항목) 실측 튜닝 —
  골든셋을 더 늘려 임계값 조정 여부를 재평가해야 한다.

### 완료 게이트 (fresh-eyes 교차 검토, 2026-08-04)

요구사항 원문과 diff만 보는 무맥락 리뷰어가 확인 결함 5건을 보고했고 전부 수정했다.

- [Critical] 수동/주기/유휴 동기화가 이벤트 전송만 하고 서버 배치 세션화를 호출하지
  않음 — "지금 저장"을 눌러도 세션이 생성되지 않는 결함. `sync/engine.ts`의 drain
  성공 후 `POST /sync`를 트리거 타입과 함께 호출하도록 연결(`triggerServerSync`,
  409/200은 정상 흐름 처리).
- [High] hold 판정 이벤트가 `processing`에 갇혀 재판단 불가(사실상 유실) —
  `session_updater.py` hold 분기에서 강제 create 대상이 아닌 이벤트를 `pending`으로
  명시 복귀 + 이를 검증하는 테스트 2건 보강.
- [High] SPA 연속 라우팅 시 다른 페이지 본문이 직전 이벤트에 부착될 수 있음 —
  `queue.attachContent`에 `status === 'open'` 가드 추가(finalize된 이벤트에는 부착 안 함).
- [Medium] Timeline 세션 배지가 '오늘' 외 날짜에서 표시되지 않음 — 서버 조회를
  로컬 synced 이벤트가 걸친 날짜별(최대 3일)로 확장(`fetchEventsByDate`).
- [Low] memory 검색 이벤트 타입이 실제 wire 형태와 불일치(`relevance_score`/
  `match_reason` → 실제는 `matched_by`/`session_title`/`active_duration_ms`) — 타입·매퍼 정정.

리뷰어가 지적한 6번째 항목(extension lib/events·lib/sync 단위 테스트 부재)은 이번
범위에서 테스트 프레임워크 도입 없이 수동 검증 목록으로 유지한다 — vitest 등 도입은
사용자 결정 필요 항목(신규 dev 의존성)으로 남긴다.

수정 후 재검증: backend 테스트 205개 통과, extension compile/build 통과.

## 2026-08-05 — AGENTS.md 실환경 정합 및 CLAUDE.md 단일화

### 요청

프로젝트 CLAUDE.md를 검토하고 개선점을 반영한다.

### 조사

- CLAUDE.md와 AGENTS.md가 바이트 단위 동일한 복사본 2개로 존재했다(드리프트 위험).
- 16장 환경 규칙의 테스트 명령(`.venv\Scripts\python.exe -m unittest discover -s tests`)이
  실제와 불일치 — 백엔드는 pytest(`pyproject.toml`의 `[tool.pytest.ini_options]`),
  `.venv`는 루트/backend 어디에도 없고 dev.sh는 `backend/.venv` 자동 감지 후 시스템
  Python 폴백, dev_conda.sh는 프로젝트 로컬 `.conda`를 사용한다.
- 문서 전체가 범용 프로세스 규칙뿐이라 모노레포 구조·파트별 검증 명령 등 프로젝트
  특화 정보가 없었다. docs/의 v2 설계 문서 4종도 문서 지도에 빠져 있었다.

### 변경

- `AGENTS.md` — "프로젝트 개요와 공식 명령" 섹션 신설(3파트 구조, dev 스크립트,
  파트별 검증 명령, eval 하네스 비용 경고). 2장에 큰 변경 기준 미만의 작은 변경은
  Plan.md 생략 가능 예외 추가. 5장에 v2 설계 기준 문서 4종 지도 추가. 16장을 실제
  환경(pytest, bash 전용 스크립트, Python 환경 감지 순서)에 맞게 교체.
- `CLAUDE.md` — 동일 복사본을 `@AGENTS.md` import 한 줄로 전환해 단일 소스 유지.

### 오류와 해결

- 없음.

### 검증

- `cd backend && python -m pytest -p no:asyncio --collect-only -q` — 205개 테스트
  정상 수집(문서화한 명령이 이 머신에서 동작함을 확인). 전체 테스트 실행과
  extension/frontend 빌드는 코드 변경이 없어 실행하지 않았다.

## 2026-08-05 — M6 검증: vitest 도입 + Playwright E2E 스모크

### 요청

남은 검증을 진행한다. Playwright MCP 설치와 vitest 도입을 사용자가 승인했다.

### 변경

- **Playwright MCP 등록** — `claude mcp add playwright`(cmd /c npx @playwright/mcp@latest,
  로컬 스코프). 연결 확인 완료. MCP 도구는 다음 Claude Code 세션부터 대화형으로 사용
  가능하며, 이번 세션 E2E는 스크래치패드의 Playwright 스크립트로 수행했다(저장소에
  E2E 코드 미포함).
- **vitest 도입** (`extension/`) — `vitest@4.1.10` + `fake-indexeddb` devDependency,
  `vitest.config.ts`, `tests/setup.ts`(fake-indexeddb/auto + `wxt/testing` fakeBrowser를
  chrome 전역에 설치), `tests/helpers.ts`, `package.json`에 `test: vitest run` 스크립트.
  WxtVitest 플러그인은 쓰지 않았다(DecisionLog 2026-08-05 참조).
- **단위 테스트 31개 신규** — `tests/unit/types.test.ts`(wire 변환·null 본문 치환·
  로컬 필드 제외), `tests/unit/queue.test.ts`(상태 기계: finalize/attachContent open
  가드/claim 순서·limit·백오프 대기 제외/markSynced/백오프 2^n·30분 상한/stale-syncing
  리셋/48h prune/evict synced 우선·droppedCount/개수 트리거 리스너),
  `tests/unit/engine.test.ts`(drain: manual 선마감, 50개 배치 반복, threshold→event_count
  매핑, 빈 큐 시 manual만 세션화 트리거, 실패 시 pending 복귀+재시도 알람+세션화
  미트리거, 세션화 트리거 실패 무해성).

### E2E 스모크 결과 (Playwright, 실 Chromium + 실 백엔드 + 실 LLM 1배치)

빌드 산출물(`.output/chrome-mv3`)을 launchPersistentContext로 로드, docker
postgres/qdrant(기존 가동) + uvicorn으로 백엔드 기동. **9/9 PASS**:

1. 확장 SW 기동 및 확장 ID 확인
2. 수집 기본 off(opt-in) — 온보딩 카드 렌더 스크린샷 확인
3. 실제 방문 3건(example.com/example.org/wikipedia) 이벤트 수집
4. 마지막 방문 open 유지, 이전 방문 finalize→pending 전이
5. SYNC_NOW 수동 동기화 → 전량 synced
6. syncStatus lastSyncAt/todayCount 기록
7. 서버 배치 세션화로 Auto Session 자동 생성 — "웹 브라우저 및 도메인 정보 탐색"
8. 동기화 후 사이드패널: 수집 상태 카드(3 방문/0 미처리/마지막 동기화), 타임라인
   이벤트 3건 + 세션 배지, 주간 탐색 분석 카드 렌더 확인(스크린샷)
9. 브라우저 재시작 후 IndexedDB 큐 생존(3건 유지)

관찰: example.org 이벤트는 세션 배지 없이 "동기화됨"으로 표시 — 의도 분석이 해당
이벤트를 세션에 미포함한 것으로 보임(노이즈 처리 경로 동작). 세션별 탐색 시간이
"0분"으로 표시(체류 수 초를 분 단위 반올림) — 표시 정책 검토 후보.

### 검증

- `pnpm test` (extension): 31 passed (3 files)
- `pnpm compile` (extension): 통과 (테스트 파일 포함 타입 검사)
- `pnpm build` (extension): 통과
- E2E 스모크: 9/9 PASS (위 상세)
- backend pytest는 이번 변경과 무관해 재실행하지 않았다.

### 오류와 해결

- Git Bash에서 `claude mcp add ... cmd /c`의 `/c`가 `C:/`로 경로 변환됨 —
  `MSYS_NO_PATHCONV=1`로 재등록.
- 첫 `pnpm compile`에서 테스트 타입 오류 2건 — mock 응답에 `EventBatchResponse`
  필수 필드(filtered/pending_total) 누락 보강, fakeBrowser alarms.create 타입이
  단일 인자 오버로드만 선언해 2인자 호출 검증부를 명시 캐스팅.

### 남은 일 (이전 목록 갱신)

- ~~수동 동기화·큐 생존·Timeline/SyncStatusCard/Analytics 렌더 수동 검증~~ → E2E로 확인 완료.
- 실기기 미검증 잔여: SW 강제 종료 시 체류시간 세그먼트 생존, 유휴/주기 트리거 실시간
  동작, SearchView 2그룹 렌더, 백엔드 다운 시 백오프 실기기 동작(로직은 단위 테스트로 커버).
- 노이즈 제외율 50% 원인인 의도 분석 discard 기준 보강(프롬프트).
- 검색 score threshold(0.35) 실측 튜닝 — 골든셋 확대 후 재평가.
- 세션별 탐색 시간 "0분" 표시 정책 검토(분 미만 반올림).

## 2026-08-05 — M6 검증(계속): SW 강제 종료 생존 + 유휴 트리거 E2E

### 요청

남은 실기기 검증 항목 중 SW 강제 종료와 유휴 트리거를 이어서 검증한다.

### 방법

Playwright E2E 스크립트 2탄(스크래치패드, 저장소 미포함). 새 프로필에 빌드 확장 로드,
uvicorn + 기존 docker로 백엔드 기동. SW 종료는 브라우저 레벨 CDP
`Target.closeTarget`으로 수행하고 종료 후 SW 타깃 부재를 재조회로 확인했다.

### 결과 — 14/14 PASS

**SW 강제 종료 생존:**
- 방문 A 후 활성 세그먼트가 `chrome.storage.session`(`orbit:activeSegment`)에 열림
- 8초 체류 후 SW 강제 종료 → 세그먼트가 동일 값(activeSince/eventId)으로 생존
- 방문 B로 SW 재기동 → A finalize(pending) + **체류시간 11.8초 정산** — 세그먼트
  열림→SW 사망 구간→B 방문까지 벽시계(14.8초) 내 전 구간 반영, 유실 없음
- 탭 상태(`orbit:tabState`)도 생존 — B가 A를 previousEventId/referrerUrl로 정확히 체이닝

**유휴 트리거:**
- SW 재기동 인스턴스에서 `idle.onStateChanged`/`alarms.onAlarm` 리스너 등록 확인
- collector가 유휴 진입 시 예약하는 것과 동일한 `orbit-idle-drain` 1회성 알람을 30초
  뒤로 예약 → 실제 chrome.alarms 발화 → `drain('idle')` 실행 → pending(A)만 synced,
  open(B)은 finalize되지 않음(설계 일치), 알람 소진(재예약 없음), lastSyncAt 갱신

**검증 한계(정직 고지):** 실제 OS 유휴(60초 무입력)로 `idle.onStateChanged`가 발화하는
구간은 사용 중인 기기에서 자동화 불가 — 리스너 등록 확인 + 알람→drain 체인 실발화로
대체했고, "idle 진입 → 알람 예약" 10줄 리스너는 코드 리뷰로 갈음했다. 완전한 확인이
필요하면 idleSyncMin=1로 두고 기기를 약 2.5분 방치하는 수동 테스트로 가능하다.

### 오류와 해결

- 1차 실행에서 "SW 종료 후 세그먼트 생존" FAIL — 테스트 스크립트가 SW를 죽이기 전에
  `chrome://serviceworker-internals` 탭을 열어 `tabs.onActivated`가 세그먼트를 먼저
  정산(제품의 정상 동작). CDP 전용 kill(탭/포커스 무변화)로 스크립트를 수정해 재실행,
  제품 결함 아님.

### 남은 일

- SearchView 2그룹 렌더 실기기 확인(다음 세션에서 Playwright MCP로 가능).
- 노이즈 제외율 50% — 의도 분석 discard 기준 프롬프트 보강.
- 검색 score threshold(0.35) 실측 튜닝.
- 세션별 탐색 시간 "0분" 표시 정책 검토.

## 2026-08-05 — SearchView E2E + 의도 분석 discard 프롬프트 보강

### 요청

SearchView 2그룹 렌더 검증을 마치고 discard 프롬프트를 보강한다.

### SearchView E2E — 5/5 PASS

Playwright로 사이드패널 Ask AI 탭에서 "웹 브라우저 탐색하던 기록" 검색(실 임베딩 호출):
결과 상태("관련 결과 5개"), 그룹1 "세션"(SessionCard 2개 + 복원 버튼), 그룹2 "관련
기록"(TimelineItem 3개) 렌더를 스크린샷과 함께 확인. 이로써 실기기 검증 목록의 마지막
항목이 완료됐다.

### discard 프롬프트 보강 (intent_analyzer.py, PROMPT_VERSION v1→v2)

증상: 노이즈 제외율 50% — 골든셋의 노이즈 이벤트 2개(Instagram 15초/20초) 중 하나를
discard하지 않고 별도 세션으로 create.

반복 실험 과정(각 라운드 실 LLM 평가):
1. discard 기준에 "짧은 스침 방문(SNS 등)" 추가 → noise 100%가 됐지만 과교정 —
   여행 흐름의 Google 번역(1.5분)까지 discard(accuracy 86.7%).
2. 도구성 방문 보호 지침 추가("번역기·지도 등이 주제 흐름에 속하면 포함") →
   1회차 전 지표 100%. 그러나 재실행에서 noise 50%, MDN→여행 그룹핑 오류 재발 —
   temperature 미지정(0.3)의 실행 간 변동성 확인.
3. temperature=0.0 고정 → 완전 결정적(3회 동일)이지만 나쁜 greedy 경로에 고정:
   여행+코딩 인터리브 이벤트를 세션 하나로 뭉침(coverage 0.75, noise 50%).
4. "서로 다른 주제는 assignment 분리" 지침 + JSON 예시를 다중
   assignment(append/create/discard 3건)로 확장 → greedy 경로 교정.

최종 결과(temp 0, 3회 실행): accuracy 100/100/100, purity 100/95/100,
coverage 100/100/100, noise **100/50/100**(기준선: 항상 50), new_vs_existing 100×3.
잔여 변동은 temp 0에서도 남는 API 측 비결정성(또는 primary→fallback 모델 전환).

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed (temperature 파라미터 추가 후 재실행)
- 평가 하네스 총 9회 실행(실 LLM) — 위 라운드별 수치 참조

### 남은 일

- 노이즈 제외를 결정적으로 만들려면 서버측 사전 필터(예: 체류 30초 미만 + SNS 도메인
  → LLM 무호출 discard) 도입 검토 — 데이터 처리 정책 변경이라 사용자 결정 필요.
- 검색 score threshold(0.35) 실측 튜닝, 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- 골든셋 확대(현재 노이즈 이벤트 2개뿐이라 노이즈 지표가 50%p 단위로만 움직임).

## 2026-08-05 — 평가 골든셋 확대 (3→7개 시나리오, 노이즈 2→9개)

### 요청

노이즈 사전 필터는 열린 결정으로 남기고(DecisionLog 표에 등록), 골든셋을 확대한다.

### 변경

`backend/eval/golden/`에 시나리오 4개 추가:

- `job_search_with_sns_checks.json` — 이직 준비 탐색 사이에 습관적 스침 3개
  (Instagram 12초, 네이버 홈 9초, X 홈 18초). 인터리브 노이즈의 discard 검증.
- `trip_flow_with_tool_visits.json` — 여행 준비 흐름 속 짧은 도구성 방문
  (구글 지도 45초, 번역 40초, 검색어 있는 30초 방문). 노이즈 0개 — discard
  과교정을 잡는 가드 시나리오.
- `existing_session_with_noise.json` — 기존 세션 append와 discard 혼합
  (YouTube Shorts 14초, 다음 홈 8초 + React 상태관리 학습 이어가기).
- `shopping_with_ad_and_error_noise.json` — 광고 배너 랜딩(5초, utm 파라미터)과
  404 오류 페이지(4초) 노이즈. 유형별 discard 기준 검증.

이벤트 id ↔ expected.assignments 키 일치를 스크립트로 확인했다.

### 평가 결과 (프롬프트 v2 + temp 0, 전체 7개 시나리오 42이벤트)

- 3회 연속 전체 실행: **5개 지표 모두 100% × 3회** (assignment/purity/coverage/
  noise/new_vs_existing).
- 노이즈 지표 해상도가 이벤트 2개(50%p 단위) → 9개(11%p 단위)로 개선.
- 단, 단일 시나리오 예비 실행 1회에서 낮은 점수(accuracy 0.4) 후 재실행 정상 —
  temp 0에서도 API 측 변동성이 잔존함을 재확인. 평가는 단일 실행이 아니라 3회
  이상 반복으로 판단해야 한다.

### 검증

- 골든셋 무결성 검사(7파일 전부 events↔expected 키 일치) 통과
- `python -m eval.run_eval` 전체 3회 실 LLM 실행 — 위 수치
- 코드 변경 없음(데이터 추가만) — backend pytest 재실행 생략

### 남은 일

- 검색 score threshold(0.35) 실측 튜닝 — 골든셋이 확대됐으므로 이제 착수 가능.
- 평가 반복 실행 자동화(`--runs N` 플래그 등)는 CLI 변경이라 필요 시 별도 결정.
- 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- main 병합.

## 2026-08-05 — 검색 score threshold 실측 튜닝 (0.35 → 0.28)

### 요청

골든셋 확대에 이어 검색 threshold 튜닝을 진행한다.

### 변경

- `eval/golden_retrieval.json` 신규 — 세션 요약 10개(분류 골든셋 7개 주제 + 요리/
  세금/캠핑 distractor 3개), 긍정 질의 14개(SearchView 사용 문체), 음성 질의 5개.
- `eval/run_retrieval_eval.py` 신규 — 실제 파이프라인과 동일한 passage 텍스트
  구성(`build_embedding_text`)과 비대칭 임베딩(passage/query)으로 코사인 점수 행렬을
  만들고 threshold 0.20~0.60 스윕(Recall@1/@3, 음성 차단율). Qdrant Cosine 점수와
  동일 값이라 별도 컬렉션 없이 측정 가능.
- `app/config.py` — `search_score_threshold` 기본값 0.35 → 0.28 (근거 주석 포함).
- `eval/README.md` — 검색 평가 사용법 추가.

### 실측 결과

| threshold | R@1 | R@3 | 음성 차단 |
|---|---|---|---|
| 0.25 | 100% | 100% | 80% |
| **0.28** | **100%** | **100%** | **100%** |
| 0.30 | 92.9% | 92.9% | 100% |
| 0.35(기존) | 85.7% | 85.7% | 100% |

- 분리 구간: 음성 최고 0.2648 < 정답 최저 0.2888. 기존 0.35는 짧은 자연어
  질의("리트코드 문제 풀던 세션" 등) 2건을 유실하고 있었다.
- Recall@1 = Recall@3 전 구간 동일 — 랭킹 자체는 정확하고 threshold가 유일한 병목.

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed (기본값 변경 후)
- `python -m eval.run_retrieval_eval` 2회 실행(임베딩 결정적 — 두 실행 점수 일치)
- 0.28 단독 검증: 정답 통과 100%, 음성 차단 100%

### 남은 일 / 주의

- 분리 폭이 0.024로 좁다 — 검색 골든셋을 확대하면 재검증 필요(스크립트로 재실행만 하면 됨).
- 세션별 탐색 시간 "0분" 표시 정책 검토(기존 항목 유지).
- main 병합.

## 2026-08-05 — LLM 재배정 (클러스터링=EXAONE, 요약·의도분석·리랭킹=A.X)

### 요청

사용자 자체 평가 결과에 따라 클러스터링은 LG EXAONE, 세션 요약·채팅·리랭킹은 SK
A.X를 쓰도록 재배정한다. 확인 질의로 결정: A.X는 기존 A.X-K1 유지, 의도분석도 A.X
유지, 폴백은 상호 폴백(A.X ↔ EXAONE).

### 변경

- `app/config.py` — FriendliAI 설정 3종 추가(friendli_api_key/base_url/exaone_model),
  Solar 채팅 모델 설정 제거(Upstage는 임베딩 전용).
- `app/ai/llm.py` — `chat_completion_light`: EXAONE 우선 → A.X-K1 폴백.
  `chat_completion(_with_meta)`: A.X-K1 우선 → EXAONE 폴백. EXAONE 호출에
  `chat_template_kwargs.enable_thinking=false` 상시 전달(아래 실측 참조), 감사용
  모델명은 `exaone/<endpoint id>` 라벨.
- `app/ai/reranker.py` — light → `chat_completion`(A.X 경로) 전환, temperature 0.1 유지.
- `tests/test_reranker.py` — monkeypatch 대상 갱신.
- `.env.example` — FriendliAI 항목 추가, SEARCH_SCORE_THRESHOLD 0.28 정정.
  실 키는 `backend/.env`에만 추가(커밋 안 됨).

### 실측과 발견

- EXAONE 4.0은 hybrid reasoning 모델 — thinking을 끄지 않으면 max_tokens를 추론
  트레이스에 소모하고 `message.content`가 null로 온다. `enable_thinking=false`로 해결.
- **엔드포인트 지연 문제(미해결)**: FriendliAI dedicated endpoint가 웜 상태 연속
  4회 호출에서 57~62초/호출. 25초 타임아웃에 걸려 클러스터링이 항상 A.X로 폴백된다
  (시스템은 정상 동작하나 EXAONE 미활용 + 호출당 25초 낭비). 콜드스타트가 아님을
  확인(연속 호출 동일). FriendliAI 콘솔에서 인스턴스 사양/sleep 설정 확인 필요 —
  DecisionLog 열린 결정 등록.

### 검증

- backend `python -m pytest -p no:asyncio`: 205 passed
- 실호출 스모크: A.X primary 정상, EXAONE 타임아웃 → A.X 폴백 정상(fail-open),
  A.X 강제 다운 → EXAONE 폴백 시도 확인(현재는 지연으로 타임아웃)
- README 기술 스택 표·핵심 기능 서술 갱신

## 2026-08-05 — EXAONE serverless 전환 (속도 재측정 결과)

### 요청

EXAONE 엔드포인트 속도를 재측정한다.

### 측정

- dedicated 재측정 5회: 54~70초/호출 — 변화 없음. 타이밍 분해로 원인 확정:
  DNS 0.02초/연결 0.08초/TLS 0.14초/**첫 바이트 55.1초** → 전부 서버측 지연.
- 같은 토큰의 serverless 모델 목록에서 `LGAI-EXAONE/K-EXAONE-236B-A23B` 발견
  ($0.2/$0.8 per M). 3회 측정: **0.34~0.53초** + enable_thinking=false 정상 동작.
- 사용자 결정: serverless 전환.

### 변경

- `app/config.py` — friendli_base_url 기본값 serverless로, exaone_model 기본값
  `LGAI-EXAONE/K-EXAONE-236B-A23B`(공개 모델명이라 코드 기본값 가능).
- `backend/.env` — dedicated endpoint ID 제거(기본값 사용). `.env.example` 정리.

### 검증

- backend pytest 205 passed
- 실배선 스모크: EXAONE light 3회 0.38~2.27초(첫 호출만 클라이언트 초기화 포함),
  A.X with_meta 0.52초, A.X 강제 다운 → EXAONE 폴백 3.25초 성공
  (`model=exaone/LGAI-EXAONE/K-EXAONE-236B-A23B` 감사 라벨 확인).
- 관찰: serverless는 버스트 rate limit 있음 — 테스트 연속 호출 중 429 1회, 45초 후
  회복. 전역 0.5초 리미터로 통상 트래픽은 문제없다고 판단, DecisionLog에 기록.

## 2026-08-05 — 클러스터링 실경로 스모크 (EXAONE 전환 후)

### 요청

main 병합 전, LLM 재배정에서 유일하게 실측이 빠졌던 스냅샷 클러스터링 경로를 검증한다.

### 검증

- 클러스터러 직접 호출 2회(여행 3탭 + React 3탭 혼합): 1.1~2.5초, 두 번 모두 주제별
  2그룹 정확 분리, 폴백 경고 없음(EXAONE serverless가 직접 응답).
- `POST /sessions/cluster` 전체 경로(실 서버·docker): HTTP 201, 4.1초에 세션 2개
  생성 — "상태 관리 전략 분석", "오사카 여행 준비". 요약(A.X) 둘 다 done, 서버
  로그에 폴백/오류 없음.

이로써 재배정된 모든 LLM 경로(클러스터링=EXAONE, 요약·의도분석·리랭킹=A.X, 상호
폴백)가 실측 검증됐다. 다음: main 병합.

## 2026-08-05 — 도그푸딩 1차 피드백 수정 (세션 최신성·후보 recency·골든셋 실데이터화)

### 요청

도그푸딩 첫날 사용자 보고 2건을 조사·수정한다: ① 항공권 세션에 무관 방문(대학 포털
로그인·Kaggle 홈)이 섞임 ② 새로 만들어진 세션이 옛 테스트 세션들 밑에 깔림. 조사 후
사용자 승인으로 4개 항목(정렬 수정·후보 recency 컷·골든셋 확장·테스트 세션 삭제)을
모두 진행했다.

### 조사 결과

- "밑에 깔린 새 세션"의 정체: 새 세션이 아니라 **7/3 테스트 세션에 append**된 것.
  벡터 유사 후보에 시간 제한이 없어 한 달 전 세션이 후보로 올라갔고 LLM이 append했다.
  목록 정렬·표시가 `created_at` 기준이라 append된 세션이 옛 날짜로 아래에 묻혔다
  (`last_activity_at`은 정상 갱신되고 있었으나 정렬·표시에 미사용).
- `DELETE /sessions/{id}`가 자식 행(`session_events`, `session_versions`)을 지우지
  않아 버전이 있는 세션 삭제 시 FK IntegrityError가 나는 잠재 결함 발견(테스트 세션
  삭제에 필요해 함께 수정).
- 실데이터 체류시간은 골든셋 가정(분 단위)과 달리 초 단위(항공권 42s·5s, 검색 5s)로
  훨씬 마진이 얇았다.

### 변경

- `backend/app/api/sessions.py` — 목록 정렬 `coalesce(last_activity_at, created_at) desc`,
  `_to_detail`에 last_activity_at 포함, delete_session이 자식 행 정리 후 삭제.
- `backend/app/schemas/session.py` — `SessionDetail.last_activity_at`(nullable) 추가.
- `backend/app/services/sync_pipeline.py` — 후보 세션에 recency 컷 7일 적용
  (벡터 후보 포함, `_CANDIDATE_MAX_AGE_DAYS`), 후보 dict에 `last_activity_days_ago`.
- `backend/app/services/intent_analyzer.py` — 후보 프롬프트 라인에 "마지막 활동:
  오늘/N일 전" 표기(없으면 생략, 골든셋 하위호환), PROMPT_VERSION v2→v3.
- `backend/eval/golden/` — 실데이터 시나리오 2개 추가:
  `flight_rebooking_with_stray_visits`(주제 맞는 후보 존재), 
  `flight_search_vs_generic_candidate`(일반 제목 후보만 존재 — 라이브 실패 재현).
- `extension/lib/api.ts`, `frontend/src/lib/api.ts` — timeLabel을
  `last_activity_at ?? created_at` 기준으로. `SessionDetailView` 라벨 "저장"→"활동".
- 테스트: `test_sync_pipeline.py` 후보 포맷 갱신, `test_intent_analyzer.py`에
  후보 라인 표기/생략 테스트 추가.

### 프롬프트 보강 시도와 반려 (중요 발견)

- discard 예시 확대("사이트 홈·로그인 화면")와 "스침 방문 끼워넣기 금지" 지침을 각각
  시도 → 둘 다 job_search 시나리오를 무너뜨림(정확도 100%→40%, 후자는 2회 재현).
  **두 보강 모두 반려**하고 v3는 후보 최신활동 표기만 유지.
- **A.X-K1은 temperature 0에서도 실행 간 판정이 흔들린다** — 같은 프롬프트로 전체
  골든셋이 100% ↔ 실패 2건을 오감(서버측 비결정성). 특히 초 단위 체류의 경계 이벤트
  (스침 방문)는 discard/hold/세션 혼입 사이를 오간다. 배정 정확도는 안정적으로 높음
  (97~100%), 노이즈 제외율만 변동(0~100%). → 프롬프트 미세조정으로 해결 불가.
  구조적 해법(노이즈 사전 필터)의 우선순위를 상향해 열린 결정에 반영.
- 최종 확정 평가(9개 시나리오): 배정 정확도 97.4%, purity 97.9%, coverage 100%,
  new/existing 100%, 노이즈 제외 69.2%(변동 구간).

### 데이터 정리 (사용자 삭제 승인)

- 테스트 세션 21개 삭제: 7/3 세션 17개 + 오늘 스모크 4개(example.com 3개 +
  클러스터링 스모크 "상태 관리 전략 분석"). 수정된 DELETE로 FK 오류 없이 완료.
- 항공권 실이벤트 5건 재세션화: LLM 재배치를 2회 시도했으나 매번 다른 형태로 뒤섞임
  (1차: GitHub 세션에 전부 append, 2차: 한밭대가 GitHub 세션에 붙고 세션 제목까지
  "한밭대 포털 로그인"으로 오염, 42초 핵심 방문은 discard). **LLM 재배치 중단** 후
  결정적 수술로 복구: 한밭대(2건)·Kaggle 이벤트 분리·discard, 항공권 3건을 한 세션
  ("제주 항공권 검색")으로 통합(오폐기 42초 방문은 `assigned_by='user'`로 복원),
  `_resync_tabs`·통계 재계산·retry-summary로 마무리.
- 최종 상태: 실사용 세션 3개(브라우저 탐색/가비아/제주 항공권 검색)만 남음.
- 관찰: 배치가 discard로 마킹한 이벤트의 session_events 행이 남아 있는 사례 1건 발견
  (원인 미상 — 재발 시 apply_assignments 트랜잭션 검토 필요).

### 검증

- backend `python -m pytest -p no:asyncio`: 207 passed
- extension `pnpm test`(31 passed) + `pnpm compile` + `pnpm build`: 통과
- frontend `pnpm build`(tsc 포함): 통과
- 평가 `python -m eval.run_eval`: 위 "프롬프트 보강" 절 참조(사용자 승인 하 실행)
- 라이브 확인: 세션 목록이 마지막 활동 기준 정렬로 반환, last_activity_at 필드 노출,
  DELETE 자식 정리 21회 무오류

## 2026-08-05 — 노이즈 사전 필터 (결정적 규칙) + discarded 이벤트 Timeline 뱃지

### 요청

프롬프트로 못 잡는 스침 방문 혼입을 결정적 규칙으로 차단한다(직전 세션의 "프롬프트
추가 보강 반려" 후속). 사용자 승인 사항: 규칙은 추천안(로그인·습관성 60초/고립 루트
30초)대로, discarded 이벤트는 Timeline에 "제외됨" 뱃지로 계속 노출.

### 설계 핵심

실데이터에서 의미 있는 탐색도 5~42초였다는 게 설계 제약이었다 — 체류시간 단독 컷은
탐색 본체를 날린다. 그래서 "짧으면 버린다"가 아니라 **구제 조건(검색어/도메인 반복/
체류 미측정) 우선 + 짧음이 특정 신호(로그인 경로·습관성 도메인·고립 루트)와 겹칠
때만 좁게 버린다"** 로 설계했다.

### 변경

- `backend/app/services/noise_filter.py` — 신규 순수 함수 모듈. `split_noise(group)`,
  `is_noise(event, domain_counts)`, `is_short_stray(event)`.
- `backend/app/services/sync_pipeline.py` — `_process_group`에서 is_system_url 재검사
  직후 `split_noise` 적용, 걸린 이벤트를 discarded로.
- `backend/app/services/session_updater.py` — hold 상한 도달 시 짧은 스침은 강제
  create 대신 discard(`is_short_stray`).
- `backend/app/api/events.py` + `schemas/event.py` — `GET /events?date=`가 discarded도
  반환, `EventListItem.excluded` 추가(sync_status=='discarded').
- `backend/eval/run_eval.py` — 실 파이프라인과 동일하게 LLM 전 `split_noise` 적용.
- `extension/` — `TodayEvent.excluded`, api 매퍼, `TimelineBadge`에 'excluded' 종류
  추가, `SessionBadge`에 "제외됨" muted 뱃지, useTimeline 매핑.
- 테스트: `test_noise_filter.py` 신규(15), `test_session_updater.py` hold 정책 갱신 +
  스침 discard 케이스 추가, `test_events_api.py` excluded 플래그 테스트 추가.

### 오류와 해결

- `test_events_api.py`의 SimpleNamespace 이벤트 픽스처에 `sync_status`가 없어
  `event.sync_status == "discarded"`에서 AttributeError → 픽스처 3개에 sync_status 추가.
- hold 정책 변경으로 기존 forced-create 테스트 2개가 깨짐(기본 이벤트가 1초/검색어
  없음 → 이제 스침으로 분류되어 discard) → 테스트를 긴 체류(120초) 이벤트로 수정하고
  스침 discard 전용 테스트 추가.

### 검증

- backend `python -m pytest -p no:asyncio`: **224 passed**
- extension `pnpm test`(31) + compile + build: 통과
- frontend build: 통과
- 골든셋 평가 2회(사용자 승인 범위): **노이즈 제외율 69%(변동) → 100%(결정적)**,
  배정 정확도·purity·coverage 100% 고정, 실패 0건. 남은 new/existing 변동(88.9%↔100%)은
  append vs create LLM 판단으로 이 필터 범위 밖.

## 2026-08-05 — AI 챗 대화 URL 정규화 + 노이즈 필터 진입화면 규칙 + 재세션화

### 요청

세션에 이질 주제가 뒤섞이는 도그푸딩 2차 피드백("여름 음악에 명함") 조사·수정.
사용자 승인: ①(AI 챗 URL 정규화)+③(노이즈 필터 보강) 후 재세션화.

### 조사 결과

- `chatgpt.com/c/<id>` 대화 하나가 SPA nav로 최대 5~6개 이벤트로 수집됨. 같은
  normalized_url인데도 여러 배치에 흩어져 dedup을 못 거쳐 여러 세션으로 파편화.
- 노이즈 필터 "도메인 반복" 구제가 `chatgpt.com/`(진입 화면)을 살려버림.
- **추가 발견(범위 밖)**: LLM이 시간 인접한 이질 주제(음악·맥미니 구매·브랜딩)를
  한 세션에 뭉치고, 그룹 간 append로 확산. 이건 ①③으로 해결 안 되는 별개 문제.

### 변경

- `backend/app/services/event_filter.py` — `_AI_CHAT_HOSTS` 상수·`_is_ai_chat_host`,
  normalize_url이 AI 챗 도메인은 query를 통째로 제거(휘발성 messageId 등 제거).
- `backend/app/services/noise_filter.py` — AI 챗 진입 화면(대화 id 없는 루트·/new)을
  도메인 반복 구제보다 우선해 discard(검색어·체류 미측정 구제는 유지).
- 테스트: `test_event_filter.py` 정규화 4케이스, `test_noise_filter.py` 진입화면 4케이스.

### 재세션화

- 오염 세션(event-origin 4개) 삭제, 전체 이벤트 normalized_url 재계산·pending 복귀
  후 수동 sync 1배치. **주의**: 1차 시도는 구코드 서버(b05cbaa)로 돌아 진입화면
  규칙이 미적용됐다 — 서버를 현재 코드로 재기동 후 재실행해 바로잡음.

### 검증

- backend `python -m pytest -p no:asyncio`: **231 passed**
- 골든셋 평가 1회: 전 지표 100%, 실패 0건(회귀 없음)
- 재세션화 결과:
  - ✅ 대화 파편화 해소: 6a6b4e7b 5→1, 6a73028c 6→1 이벤트로 dedup.
  - ✅ `chatgpt.com/`(31s) 진입 화면 discard됨(구코드에선 생존했던 것).
  - ✅ 항공권 세션은 08:49·11:02 방문이 깔끔히 한 세션으로.
  - ❌ **미해결**: LLM이 "여름 음악 및 맥미니 구매"(음악+구매+브랜딩+명함 9개),
    "메일 및 브라우저 분석"(메일+로고+옛 위키 6개)처럼 이질 주제를 여전히 뭉침.
    노이즈 필터는 스침만 제거하고 주제 분리는 LLM 몫인데 A.X가 실패 — 별도 과제.
  - 잔여: 옛 테스트 이벤트(example.com, Web browser Wikipedia 06:45)가 재유입돼 오염.

## 2026-08-05 — 의도분석 EXAONE-primary 하이브리드 전환 + v4 프롬프트 + 실데이터 검증

### 요청

공정 재평가에서 EXAONE(튜닝)이 A.X와 대등함을 확인한 뒤, 사용자 결정: "EXAONE을 메인으로,
너무 오래 대기하면 A.X로 fallback, 실데이터로 검증."

### 변경

- `app/ai/llm.py` — `chat_completion_intent(system, user) -> (content, model)` 신설.
  EXAONE primary → A.X-K1 fallback. 핵심: FriendliAI 클라이언트를 `max_retries=0` +
  `timeout=12s`로 만들어 429/지연 시 내부 백오프 없이 **즉시** A.X로 폴백(오래 대기 방지).
  기존 `chat_completion_with_meta`(A.X primary)는 `chat_completion`(요약·리랭킹)이 감싸므로
  건드리지 않고 별도 함수로 분리.
- `app/services/intent_analyzer.py` — `chat_completion_intent` 사용, PROMPT_VERSION v3→v4.
  v4 = 공정 재평가에서 EXAONE 과분할을 잡은 튜닝 프롬프트: 시스템 프롬프트에 "같은 주제는
  하나로 묶어라" 원칙, 유저 템플릿에 "[매우 중요 — 과분할 금지]" 블록(WRONG/RIGHT 예시 +
  title·purpose 강제).
- `tests/test_intent_analyzer.py`, `eval/run_eval.py` — 목/패치 대상 함수명 갱신.

### 검증

- backend pytest: **231 passed**
- 골든셋 하이브리드 end-to-end: 배정·순도·커버리지·노이즈 100%, 실패 0건(무회귀).
- **실데이터 재세션화(139개 이벤트)**:
  - EXAONE 폴백 **3건만** 발생(나머지 그룹은 EXAONE 처리) — fair_eval의 429 폭주와 달리
    실제 배치는 그룹 간 임베딩·DB·0.5초 스로틀로 호출이 벌어져 EXAONE이 대부분 통과.
    max_retries=0 덕에 폴백도 즉시(20~40초 대기 없음). 배치 오류 0.
  - **주제 분리 대폭 개선**: 기존 "여름 음악 + 맥미니 + 브랜딩" 한 덩어리 →
    "맥미니 M4 구매"(6) / "여름 플레이리스트"(2) / "AI 기반 디자인"(3)으로 정확히 분리.
  - 139개 → 12개 응집 세션 + 8개 discard(노이즈 필터). 예: "이터널 리턴 플레이어 분석"
    33개 전부 dak.gg 단일 주제로 깔끔.
  - **잔여 한계**: "항공권 예약 및 결제 확인"(16)은 항공권 + 확인 메일 여러 개가 뭉쳐 있음
    (예약→확인메일 흐름으로 볼 여지도 있으나 nangman.cloud 메일 9건·github는 과포함).
    v4로 최악의 뭉침은 사라졌으나 flight+mail류 잔여 뭉침은 남음.

### 알려진 이슈(경미)

- `SyncBatch.model` 감사 필드가 그룹별 사용 모델 집합에서 임의 1개만 기록(`next(iter(...))`)해
  이번 배치가 EXAONE 위주였는데도 "A.X-K1"로 표기됨. 폴백률 관측을 위해 향후 개선 여지.

## 2026-08-05 — 잔여 뭉침(flight+mail) 개선(프롬프트 v5) + 배치 감사 필드 개선

### 요청

하이브리드 전환 후 남은 flight+mail 뭉침을 개선하고, 폴백률이 안 보이던 감사 필드를 개선.

### 조사

"항공권 예약 및 결제 확인"(16개)을 뜯어보니 항공권(08:49~08:50)과 메일 확인
(11:04~11:23, 약 2.5시간 뒤)이 한 세션. 원인은 그룹 내 뭉침이 아니라 **그룹 간 과잉
append** — 나중 메일 그룹 처리 시 방금 만든 항공권 세션이 후보로 잡혀 LLM이 "결제 확인"
으로 append. 나망 받은편지함 8건은 대부분 1~6초 습관성.

### 변경

- `app/services/intent_analyzer.py` — PROMPT_VERSION v4→v5. "받은편지함·메일 목록 같은
  일반 메일 확인은 특정 작업의 확인 메일이 명백하지 않으면 무관한 세션에 append하지 말고
  별도 '메일 확인' 세션(create)으로, 스침이면 discard" 지침 추가.
- `app/services/sync_pipeline.py` — `_summarize_models()` 신설. 배치 `model` 감사 필드를
  그룹별 사용 모델 카운트 요약으로 기록(예: `exaone:12,A.X-K1:3`). EXAONE 긴 라벨은
  "exaone"으로 축약, String(50) 상한. `_process_batch`가 Counter로 집계.
- `eval/golden/mail_browsing_not_appended_to_flight.json` — 신규. 항공권 후보 + 업무 메일
  읽기(명확한 활동) → 별도 mail_check 세션으로 분리(항공권에 append 금지) 검증.
- 테스트: `test_summarize_models_counts_and_shortens` 추가, `_process_batch` 모델 단언 갱신.

### 검증

- backend pytest: **232 passed**
- 골든셋 전체(10개): 배정·순도·커버리지·노이즈 100%, 실패 0건. 신규 메일 시나리오 단독
  2회 모두 100%(항공권에 안 붙고 별도 세션). (초기 시나리오는 15~26초 스침이라 noise/hold
  경계로 불안정 → 명확한 메일 읽기 활동으로 개정해 안정화.)
- **실데이터 재세션화(139개, v5)**:
  - 감사 필드 `exaone:3,A.X-K1:1` — 4개 그룹 중 EXAONE 3 / A.X 폴백 1 관측 가능.
  - flight+mail 뭉침 해소: 항공권 2세션(전부 flight.naver), 나망 메일 9건 → 독립 세션,
    네이버 메일 2건 → 독립 세션, gmail/github 각각 분리. 15개 세션 모두 응집 도메인.

### 남은 한계(경미)

- 항공권이 시간 버스트에 따라 2세션으로 분리됨(둘 다 flight, 오분류 아님·경미한 과분할).
- 나망 받은편지함 세션 제목이 내용 기반 "이메일 마케팅 자동화 분석"으로 다소 부정확(분리는
  성공). 습관성 짧은 inbox 스침의 세션화 vs discard 경계는 추후 노이즈 필터 확장 후보.

## 2026-08-05 — 메일 목록 보기 노이즈 규칙(C안: 실제 읽은 메일만 기억)

### 요청

사용자 결정: 받은편지함·폴더 목록 새로고침은 기억 안 함, 실제로 읽은 메일만 세션화.

### 변경

- `app/services/noise_filter.py` — 웹메일 목록/폴더 보기 규칙 추가. `_MAIL_HOST_RE`
  (mail.*/outlook.*), `_MAIL_LIST_PATH_RE`(inbox/folders/sent/…), `_MAIL_MESSAGE_PATH_RE`
  (message/read/msg/view). `_is_mail_list_view`: 웹메일 호스트 + 목록 경로 + 개별 메일
  읽기 아님 → discard. is_noise에서 체류·도메인 반복과 무관하게 최우선 적용(받은편지함
  버스트가 도메인 반복 구제에 걸리지 않도록). gmail은 정규화 후 /mail/u/N/ 하나라
  목록/읽기 구분 불가 → 규칙에 안 걸려 보존(LLM 판단).
- `eval/golden/mail_inbox_refresh_is_noise.json` — 신규(목록 보기 4건 → 전부 noise).
- 테스트: test_noise_filter에 목록 discard·메일 읽기 보존·gmail 보존·도메인 반복 우회 6건.

### 검증

- backend pytest: **237 passed**
- 골든셋 11개: 배정·순도·커버리지·노이즈 100%, 실패 0건(무회귀). mail_inbox_refresh 노이즈
  100%, mail_browsing(개별 읽기) 세션화 100%.
- 실데이터 재세션화(139개): 나망 받은편지함 목록 보기 전부 discard, "이메일 마케팅 자동화
  분석" 잡동사니 세션 소멸. 세션에 남은 메일은 gmail 루트·네이버 루트(구분 불가, 의도적 보존)뿐.

### 이번 run에서 재확인된 구조적 문제(메일 규칙과 무관)

- "여행 계획 및 항공권 검색"(18개)이 항공권+브랜딩(ChatGPT 명함·로고)+맥미니 구매+여름
  플레이리스트+github을 흡수한 메가 뭉침 발생. 원인은 **그룹 간 과잉 append** — 직전 run은
  잘 분리됐으나 이번엔 뭉침(LLM 변동). 재세션화 품질이 run마다 출렁이는 근본 원인.
- 프롬프트 튜닝(v4 과분할 금지, v5 메일)은 특정 케이스는 잡지만 그룹 간 append 불안정을
  구조적으로 못 잡는다. append 게이팅(벡터 유사도 하한+시간 근접) 또는 그룹 내 임베딩
  서브클러스터링이 필요 — DecisionLog "LLM 주제 뭉침" 열린 결정과 연결.
