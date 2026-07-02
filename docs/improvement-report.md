# Orbit 개선점 리포트

> 작성일: 2026-07-02 · 기준 커밋: `5d0eb1f` (Redesign)
> 분석 범위: backend/app 전체, extension(sidepanel/lib/entrypoints), frontend/src, 문서(README, IMPLEMENTATION, MENTOR_QUESTIONS, ppt.md)

---

## A. 기술적 갭 & 코드 품질

### A1. [A] AI 요약 실패 시 사일런트 무한 스피너

- **현재 상태**: `backend/app/api/sessions.py:80-81` — `_ai_update` 실패 시 `logger.warning`만 남기고 세션은 `"N개 탭 세션"` 임시 overview로 영구 잔존. Extension 폴러(`useSessions.ts:78-81`)는 임시 overview 정규식(`/^\d+개 탭 세션$/`)으로 완료를 판정하므로 실패 시 절대 완료되지 않음. `SessionCard.tsx:32-33`, `SessionDetailView.tsx:31-32`도 같은 휴리스틱으로 "AI가 주제 분류 및 요약 중…"을 무한 표시.
- **문제/리스크**: LLM 양쪽(A.X-K1, solar-pro3) 모두 실패하거나 서버가 백그라운드 작업 중 재시작되면, 사용자·심사위원에게는 **영원히 도는 스피너**만 보이고 실패 알림이 없다. 데모 중 발생 시 가장 치명적인 실패 모드. 완료 판정이 문자열 휴리스틱이라 LLM이 우연히 "5개 탭 세션" 형식의 overview를 생성해도 오판한다.
- **개선 방안**:
  1. `Session` 모델에 `summary_status: pending | done | failed` 컬럼 추가, `_ai_update` 성공/실패 시 갱신, 응답 스키마에 포함. 폴러·카드 UI는 status 기반으로 전환 (휴리스틱 제거).
  2. `failed` 상태 UI: "요약 생성 실패 — 다시 시도" 버튼 (재요약 엔드포인트는 `_ai_update` 재호출로 간단).
  3. `main.py` lifespan에 기동 시 `pending` 세션 재처리 로직 추가 → 서버 재시작 유실을 Redis 큐 없이 복구.
- **우선순위**: **High** · 반나절~1일

### A2. [A] "민감 도메인 제외" 토글 실동작 구현 (기지식 갭 1 해결안)

- **현재 상태**: 기지식 — `excludeSensitive`는 `store/settings.ts`, `SettingsView.tsx`에서만 참조됨(grep으로 재확인). 저장 경로(`extension/lib/api.ts:93-108` `enrichTabs`)는 이 설정을 읽지 않는다.
- **문제/리스크**: 기본값 on인 토글이 시연대에 올라가는데 실제로는 아무것도 필터링하지 않음. 심사위원이 은행 탭을 열고 시연을 요청하는 시나리오에서 그대로 본문이 Upstage API로 전송된다 (MENTOR_QUESTIONS Q11에서 팀 스스로 지적한 리스크).
- **개선 방안**: **Extension 단 URL 도메인 필터가 정답.** 백엔드 텍스트 기반(LLM 분류) 방식은 이미 기기 밖으로 전송된 후라 개인정보 보호 취지에 어긋나고, 비용·지연·오탐도 크다. 구현:
  1. `extension/lib/sensitive-domains.ts` — 은행·증권·정부(`*.go.kr`)·의료 도메인 목록 + `/login`, `/signin`, `/checkout` 등 URL 패턴.
  2. `enrichTabs`에서 `useSettingsStore.getState().excludeSensitive` 확인 → 매칭 탭은 `text_content: ''`, `excerpt: null`로 전송. **탭 자체(제목·URL)는 유지**해 세션 복원은 가능하게 — "본문만 수집 제외"임을 `SettingsView` 설명문에 명시.
  3. 심사 어필: "민감 데이터는 기기를 떠나지 않는다"는 설계 원칙으로 한 줄 설명 가능.
- **우선순위**: **High** · 반나절

### A3. [A] A.X-K1 연결 장애 시 solar-pro3 fallback을 타지 않음

- **현재 상태**: `backend/app/ai/llm.py:88-95` — fallback 트리거가 `RateLimitError`(429)와 `APIStatusError`(404/503/5xx)뿐. `APIConnectionError`/`APITimeoutError`(DNS 실패, 연결 거부, 타임아웃)는 그대로 raise → `summarizer.py:81`의 except가 잡아 **solar-pro3를 건너뛰고 곧장 규칙 기반 제목으로 강등**된다.
- **문제/리스크**: 대회 제공 엔드포인트(`awf-gw.adot.ai`)가 데모 당일 네트워크 레벨로 죽으면 — 상태코드조차 못 받는 장애가 실제로 가장 흔한 유형 — Upstage가 멀쩡해도 모든 AI 요약이 무력화된다. "Upstage 활용" 데모의 단일 장애점.
- **개선 방안**: fallback except를 `(RateLimitError, APIStatusError, APIConnectionError, APITimeoutError)`로 확장 (4xx 클라이언트 오류는 현행대로 raise 유지). `_TIMEOUT = 60.0`(llm.py:9)도 데모 기준 과함 — 요약 전체 파이프라인이 폴링 UX라 20~30초로 줄여 fallback 진입을 앞당기는 편이 낫다.
- **우선순위**: **High** · 1시간

### A4. [A] 검색 오프라인 fallback이 "AI 정렬 완료"로 거짓 표시

- **현재 상태**: `extension/lib/api.ts:158-169` — 백엔드/Qdrant 실패 시 조용히 로컬 substring 필터링으로 fallback. `SearchView.tsx:103-107`은 결과만 있으면 `rerankEnabled` 기준으로 "(AI 정렬 완료)"를 표시.
- **문제/리스크**: (1) 백엔드가 죽은 상태에서 단순 문자열 매칭 결과에 AI 라벨이 붙음 — 품질 낮은 결과에 AI 이름이 붙는 역효과. (2) 자연어 질문형 쿼리("어제 보던 여행 탭")는 substring 매칭이 거의 항상 0건 → "관련 세션을 찾지 못했어요"만 표시되고 **진짜 원인(서버 다운)이 은폐**됨.
- **개선 방안**: `searchSessions`가 `{ sessions, degraded: boolean }`을 반환하도록 변경 → degraded 시 UI에 "간단 검색 결과 (백엔드 미연결)" 표시하고 AI 라벨 억제. Settings의 health check(`checkHealth`)가 이미 있으므로 그 상태를 SearchView에서 함께 활용해도 됨.
- **우선순위**: **Medium** · 2~3시간

### A5. [A] 임베딩/Qdrant 부분 실패 시 세션이 검색에서 영구 누락

- **현재 상태**: `backend/app/api/sessions.py:71-78` — 요약 DB 커밋 **후** embed→upsert 실행. 이 단계 실패는 바깥 except(:80)가 통째로 삼킨다. 요약은 이미 저장돼 UI는 완전히 정상으로 보임.
- **문제/리스크**: 세션 카드·상세는 멀쩡한데 검색만 안 되는, 발견이 가장 어려운 실패 유형. 재시도 없음. 데모 중 "방금 저장한 세션을 검색으로 복원" 시연이 실패할 수 있다.
- **개선 방안**: A1의 status에 임베딩 성공 여부를 포함(`done` 판정을 upsert 성공까지로)하거나, 기동 시 Qdrant에 포인트 없는 세션을 재임베딩하는 복구 로직을 A1-3과 함께 구현. 요약 저장과 임베딩의 try를 분리해 실패 지점을 로그에서 구분.
- **우선순위**: **Medium** · A1과 묶어 처리

### A6. [A] 계약·스키마 정리 (경미한 불일치 모음)

- **현재 상태**:
  - `saved_at`(schemas/session.py:19) — 요청으로 받지만 `sessions.py` 어디서도 사용 안 함. 저장 시각은 서버 `_utcnow`로 대체돼 클라이언트 전송 시각은 버려짐.
  - `SaveSessionResponse`(:47), `SessionListItem`(:54) — 정의만 있고 미사용 (grep 확인).
  - `useSaveSession`/`saveSession`(단일 저장) — Extension에서 미사용 dead path. UI 진입점은 `CurrentSessionCard`의 clustered 저장뿐 (grep 확인).
  - `TabItemResponse.id ← tab_id` 기본값 `""`(sessions.py:31) — tab_id 누락 클라이언트가 생기면 React key 중복 가능 (현재 Extension은 항상 채우므로 잠재 이슈).
  - `pyproject.toml` — `alembic`, `beautifulsoup4` 미사용 의존성 (grep 확인).
- **문제/리스크**: 즉각적 버그는 아니나, 계약이 코드와 어긋난 채 남으면 다음 협업자(2인 팀)가 오독. CLAUDE.md의 dead code 제거 원칙에도 어긋남.
- **개선 방안**: 미사용 스키마·훅·의존성 제거. `saved_at`은 제거하거나 `created_at`으로 저장하거나 한쪽으로 통일.
- **우선순위**: **Low** · 1~2시간

### A7. [A] 테스트 전무 상태에서 최소 커버 지점

- **현재 상태**: 기지식 — 테스트 0개. 다만 사일런트 실패의 마지막 방어선이 전부 순수 함수라 테스트 비용이 낮다.
- **문제/리스크**: LLM 응답 파싱·인덱스 검증 로직이 깨지면 fallback이 조용히 삼켜서 증상이 "품질 저하"로만 나타남 — 데모 전 회귀를 잡을 방법이 없다.
- **개선 방안**: 가성비 순으로 4곳만:
  1. `_extract_json` — `summarizer.py:52`와 `clusterer.py:35`에 **동일 구현 중복** + `reranker.py:51-52`에 변형. `app/ai/json_utils.py`로 통합하면서 케이스 테스트(펜스 유무, 앞뒤 잡담, 잘린 JSON).
  2. `clusterer.cluster_tabs`의 인덱스 검증·누락 탭 회수·overflow 로직(:63-92) — LLM이 잘못된 인덱스를 반환하는 케이스.
  3. `reranker.rerank`의 인덱스 복원(:55-61).
  4. `rule_based_title`(:41-46).
  - E2E/UI 테스트는 대회 일정상 스킵이 합리적 — 수동 검증 시나리오 문서로 대체.
- **우선순위**: **Medium** · 반나절 (json_utils 통합 포함)

### A8. [A] Alembic 도입 여부 판단 (기지식 갭 2 해결안)

- **현재 상태**: 기지식 — `create_all` 임시 운용.
- **판단**: **현행 유지가 합리적.** 단일 테이블, 데모 DB는 재생성 가능, 파괴적 마이그레이션 없음. alembic은 실서비스 전환 시점의 일. 단 주의: A1에서 `summary_status` 컬럼을 추가하면 `create_all`은 기존 테이블에 컬럼을 추가하지 않으므로 **로컬 DB 볼륨 리셋(`docker compose down -v`) 필요** — 팀원과 공유할 것.
- **개선 방안**: pyproject에서 alembic 제거(A6에 포함), `db/session.py:11`의 "Alembic 도입 전 임시" 주석은 유지.
- **우선순위**: **Low** · A6에 포함

---

## B. 아키텍처/설계 리스크

### B1. [B] 저장 경로 이원화 — UI 일관성은 문제없음, payload만 낭비

- **현재 상태**: Extension UI는 항상 `/sessions/cluster`만 호출(`CurrentSessionCard.tsx:27`). 탭 4개 미만이면 백엔드가 단일 그룹으로 처리(`clusterer.py:53-54`)하므로 사실상 단일 저장과 동일하게 동작. `/sessions`(단일)는 API 레벨에만 존재.
- **문제/리스크**: 경로 자체는 일관됨. 다만 `enrichTabs`가 모든 탭의 본문 8000자를 실어 보내는데 클러스터링 단계는 제목+URL만 사용(`clusterer.py:43-48`) — 탭 30개면 ~240KB가 클러스터링 응답을 기다리는 동기 요청에 실림. 클러스터링 LLM 호출이 요청 경로에서 동기 실행(`sessions.py:120`)되어 저장 버튼 후 수 초 대기가 발생하나, "주제 분류 중…" 카드로 UX 처리가 이미 되어 있어 수용 가능.
- **개선 방안**: 데모 규모에선 현행 유지 권장. 여유가 있다면 저장을 2단계로(1차: 제목+URL로 클러스터+저장, 2차: 본문은 background로 전송) 나눌 수 있으나 대회 전 투자 대비 효과 낮음.
- **우선순위**: **Low** · 현행 유지

### B2. [B] BackgroundTasks 유실 — Redis 없이 해결 가능

- **현재 상태**: 기지식 — 서버 재시작 시 진행 중 요약 유실. Redis는 정의만 존재.
- **판단**: 데모 규모(순차 저장, RPS 3 제한)에서 Redis 큐 도입은 과설계 — 오히려 BackgroundTasks 순차 실행이 RPS 제한에 유리하다. 유실 문제의 본질은 큐가 아니라 **상태 추적 부재**이므로, A1의 status 필드 + 기동 시 pending 재처리로 해결하는 것이 맞다.
- **개선 방안**: A1-3과 동일. docker-compose에서 redis 서비스를 제거하거나 "후속 확장용" 주석 명시.
- **우선순위**: A1에 흡수

### B3. [B] Qdrant + LLM 리랭킹 — 과설계 아님, 유지하되 두 가지 손질

- **현재 상태**: 벡터 검색(`vector.py`) + 옵트인 리랭킹(`search.py:20-24`, 설정 토글로 분리). 세션 수십 개 규모.
- **판단**: 세션 수만 보면 LLM 단독 검색(Q7)도 가능하지만, 이미 구현 완료 + Upstage embedding 활용 어필 + 토글로 잘 분리돼 있어 **제거할 이유가 없다.** "규모에 안 맞는 과설계"가 아니라 "심사 포인트용 계층화"로 설명 가능한 구조.
- **개선 방안** (선택적 품질 손질):
  1. **비대칭 임베딩**: 저장 시 임베딩하는 텍스트는 요약문(passage 성격)인데 `embedding-query`로 통일 중(`embedding.py:11`). `embed(text, model=...)`로 파라미터화해 저장 시 `embedding-passage` 사용 — 코드 1~2줄, MENTOR_QUESTIONS Q1의 정석 답. 검색 품질 효과는 실측 필요(확인 필요).
  2. 리랭킹 입력이 제목+overview 60자뿐(`reranker.py:36-43`) — `purpose`를 포함하면 판단 근거가 늘어남.
- **우선순위**: **Medium** · 각 1시간 내

### B4. [B] 웹 대시보드(frontend)에 pending 개념 없음

- **현재 상태**: `frontend/src/hooks/useSessions.ts:10-12` — 폴링 없음. `SessionDetailPanel.tsx`는 `isTempOverview` 처리 없이 `"3개 탭 세션"` 임시 요약을 그대로 렌더링.
- **문제/리스크**: 대시보드를 데모 화면에 띄우는 경우, Extension으로 저장한 직후의 세션이 임시 요약 그대로 노출되고 새로고침 전엔 갱신 안 됨.
- **개선 방안**: 대시보드를 데모에 쓴다면 Extension의 임시 overview 판정 + `refetchInterval`을 이식 (A1의 status 필드가 생기면 그걸 쓰는 게 정석). **데모에 안 쓴다면 무시.**
- **우선순위**: **Medium**(대시보드 데모 시) / 무시 가능 · 2시간

---

## C. 대회 심사 관점

### C1. [C] 발표 자료(ppt.md)와 실제 구현의 불일치 — 심사 Q&A 리스크

- **현재 상태**: `ppt.md:93-95` "탭 클러스터링 — HDBSCAN, cosine similarity" / `ppt.md:106` "Structured Output 방식으로 안정적으로 처리" ↔ 실제 구현: **LLM(solar-mini) 프롬프트 클러스터링**(`clusterer.py`), JSON은 프롬프트 지시 + 정규식 파싱이며 `response_format`/tool calling 미사용 (grep으로 확인).
- **문제/리스크**: 심사 Q&A에서 아키텍처 질문이 나왔을 때 발표 자료와 코드가 다르면 기술 신뢰도에 직접 타격. 특히 HDBSCAN은 구체적 알고리즘명이라 "실제로 어떻게 클러스터링했나"는 단골 질문.
- **개선 방안**: 발표 자료를 실제 구현으로 갱신하고, **전환 이유를 어필 포인트로 역이용**:
  - "탭 수십 개 규모에서 HDBSCAN은 파라미터에 민감하고 불안정 → LLM 클러스터링은 그룹핑과 동시에 주제명까지 생성하며, 모델 티어링(solar-mini)으로 비용·속도 해결" — 설계 판단 과정 자체가 스토리가 된다.
  - Structured Output: solar-pro3의 `response_format` JSON 모드 지원 여부 확인(확인 필요 — 멘토 Q3와 연결) 후 지원하면 적용(반나절), 미지원이면 현행 "프롬프트 강제 + 정규식 + 규칙 기반 fallback 3중 방어"를 정직하게 설명.
- **우선순위**: **High** · 자료 수정 2~3시간

### C2. [C] Upstage 활용 스토리 — 구조는 이미 강함, 정리만 필요

- **현재 상태**: solar-mini(클러스터링·리랭킹, 실패 시 solar-pro3) / A.X-K1(요약, 429·5xx 시 solar-pro3) / embedding-query + Qdrant(RAG 검색). 계획(IMPLEMENTATION.md)에 없던 clusterer·reranker가 추가되며 작업 복잡도별 모델 티어링이 자연스럽게 형성됨.
- **판단**: "단순 호출"이 아니라 **복잡도별 모델 선택 + 장애 대비 2단 fallback + RAG 파이프라인**이라는, MENTOR_QUESTIONS Q4·Q12가 묻던 것의 실전 답이 이미 코드에 있다. 문제는 이게 어디에도 한 장으로 정리돼 있지 않다는 것.
- **개선 방안**: 파이프라인 다이어그램 1장 (탭 수집 → mini 클러스터링 → K1/pro3 요약 → embedding-query → Qdrant → mini 리랭킹, 각 화살표에 fallback 표기). Q6(Document Parse) 질문 대비: "Extension 내 Readability 추출이 구조상 맞고, 개인정보를 원문 HTML째 보내지 않는 설계"로 답변 준비.
- **우선순위**: **Medium** · 2~3시간 (발표 자료 작업과 병행)

### C3. [C] 데모 시나리오 뒷받침 현황과 리허설 체크리스트

- **현재 상태**: MENTOR_QUESTIONS Q13의 시나리오 3종 — ① 요약+이름 자동 생성 ✅ ② 자연어 검색+복원 ✅ ③ 목적/미완료/다음 행동 표시 ✅ — 모두 구현으로 뒷받침됨.
- **문제/리스크**: 기능이 아니라 **실패 모드**가 리스크의 전부다: (1) A.X-K1 장애 → 무한 스피너(A1·A3), (2) 검색 0건 — 임베딩 누락(A5) 또는 쿼리·요약 표현 불일치(HyDE, Q8), (3) 민감 도메인 토글 시연 요청(A2).
- **개선 방안**:
  - 데모용 세션 5~10개를 사전 저장하고, 시연할 검색 쿼리를 실제로 돌려 결과 순위를 리허설 — 표현 불일치로 원하는 세션이 안 나오면 쿼리를 조정하거나 rerank 토글 활용.
  - HyDE(Q8)는 리허설에서 검색 품질이 충분하면 도입하지 않는 것을 권장 — 구현 복잡도 대비 데모 효과 낮음.
  - **무시해도 되는 것**: alembic(A8), Redis(B2), frontend 폴링(B4, 대시보드 데모 제외 시), 미사용 스키마(A6)는 심사에 영향 없음.
- **우선순위**: **High**(리허설 자체) · 반나절

---

## 지금 당장 해야 할 Top 3

| # | 항목 | 이유 | 소요 |
|---|---|---|---|
| 1 | **AI 실패 모드 제거** — A1(status 필드 + 기동 시 재처리) + A3(connection error도 fallback) | 데모 중 발생 가능한 유일한 치명적 시나리오. 나머지는 품질 문제지만 이건 "고장난 제품"으로 보임 | 1일 |
| 2 | **민감 도메인 필터 실동작** — A2 (Extension 단 도메인 목록, 본문만 제외) | UI가 약속하는 기능이 동작하지 않는 상태로 심사대에 오르는 리스크 + 개인정보 설계 원칙 어필로 전환 가능 | 반나절 |
| 3 | **발표 자료 ↔ 구현 정합화** — C1 (HDBSCAN→LLM 클러스터링 스토리, Structured Output 설명 정리) | 코드 수정 없이 심사 Q&A 신뢰도 리스크를 제거하고 설계 판단 스토리를 얻는 최고 가성비 작업 | 2~3시간 |

**확인 필요로 남긴 것**: solar-pro3의 `response_format` JSON 모드 지원 여부(C1), `embedding-passage` 전환의 실측 검색 품질 효과(B3) — 둘 다 Upstage 문서/멘토에게 확인 후 결정.
