# Orbit 개선점 리포트

> 작성일: 2026-07-05 · 기준 커밋: `a7e3eda` (fix: AI 요약 실패 처리, 민감 도메인 필터링, 검색 안정성 개선)
> 분석 범위: backend/app 전체, extension(entrypoints/lib), frontend/src, 인프라(docker-compose, dev 스크립트), 문서(README, IMPLEMENTATION, ppt.md)
> 이전 버전(2026-07-02, 기준 `5d0eb1f`)의 항목별 반영 여부를 코드로 재검증하고 신규 발견을 추가한 개정판.

---

## 0. 이전 리포트 반영 현황 (검증 결과)

| 항목 | 상태 |
|---|---|
| A1 요약 상태 추적 + 재시도 UI | 구조는 반영 — 단 **H1로 사실상 무력화** (요약 실패가 `done`으로 기록됨) |
| A2 민감 도메인 필터 | 반영 (`enrichTabs`가 설정을 읽고 본문만 제외) — 단 도메인 목록 갭 (H4) |
| A3 연결 장애 fallback / 타임아웃 단축 | 반영 완료 (`llm.py:103-105`, `_TIMEOUT = 25.0`) |
| A4 검색 degraded 플래그 | 부분 반영 — 백엔드 완전 다운 시 재발 (H3) |
| A5 임베딩 실패 복구 / B2 재시작 복구 | 반영 (`sessions.py:247-271`) — 단 동시 실행 폭주 문제 (M1) |
| A6·A8 dead code/의존성 정리 | 반영 (alembic·bs4·redis·미사용 스키마 제거) — 새 dead code 발생 (L3) |
| A7 테스트 | 15개 추가. json_utils 5개 통과 확인. 나머지 3파일은 시스템 Python에 `openai` 미설치로 수집 실패 — 환경 문제이며 코드 문제 아님 (프로젝트 env에서 `pip install -e .[dev]` 필요) |
| B1 저장 payload | 현행 유지 (이전 판단대로 데모 규모 수용 가능) |
| B3 비대칭 임베딩 + 리랭커 입력 보강 | 반영 완료 (`embedding-passage` 분리, purpose·탭 제목 포함) |
| B4 대시보드 pending 이식 | 반영 (3초 폴링 + 재시도 UI) — 단 검색 쪽 drift (M5) |
| **C1 발표자료 정합화 / C2 다이어그램 / C3 리허설** | **미착수** — H5로 재수록 |

---

## A. High — 데모/심사에서 터질 수 있는 것

### H1. [A] 요약이 완전 실패해도 `summary_status`가 `"done"`으로 기록 — A1 수정의 취지가 한 층 아래에서 무너짐

- **현재 상태**: `backend/app/services/summarizer.py:68-73` — `generate_summary`가 모든 예외를 삼키고 규칙 기반 더미 요약(`"N개 탭 세션"`)을 반환. 따라서 `backend/app/api/sessions.py:96`의 `_ai_update`는 두 LLM(A.X-K1, solar-pro3)이 모두 실패해도 `summary_status = "done"`을 기록한다.
- **문제/리스크**:
  1. `"failed"` 상태는 탭 데이터 검증 오류·DB 장애 같은 희귀 경로에서만 도달 가능 → Extension 재시도 버튼(`SessionCard.tsx`, `summaryStatus === 'failed'` 조건)과 `POST /sessions/{id}/retry-summary` 엔드포인트가 **사실상 죽은 기능**. README의 "실패 시 재시도 UI 제공" 약속과 코드 불일치.
  2. 더미 요약이 `sessions.py:109`를 타고 `embedding-passage`로 **Qdrant에 그대로 임베딩**되어 검색 인덱스를 오염시킨다.
- **개선 방안**: `generate_summary`의 catch-all except를 제거해 예외를 전파시키고, `_ai_update`의 except에서 `failed` 마킹. 저장 시 만든 임시 요약이 이미 있으므로 UI 공백은 없고, 임베딩도 자연히 스킵된다. `rule_based_title`은 저장 직후 즉시 응답용으로만 유지.
- **우선순위**: **High** · 30분

### H2. [A] 상세 화면 무한 스피너 재발 — 폴러가 상세 쿼리를 무효화하지 않음

- **현재 상태**: `extension/entrypoints/sidepanel/hooks/useSessions.ts:55-58` — 폴러가 요약 완료 시 `['sessions']`만 무효화하고 `['session', id]`는 남겨둠. 상세 쿼리(`useSession`)는 폴링이 없음. 바로 아래 `useRetrySummary`(:76-78)는 둘 다 무효화하고 있어 폴러만 누락된 비일관.
- **문제/리스크**: pending 세션의 상세 화면을 열어둔 채 요약이 완료되면 상세 캐시가 `pending`으로 남아 "AI 요약 중…" 스피너가 계속 돈다. A1이 없애려던 무한 스피너의 상세 화면 경로 재발.
- **개선 방안**: 폴러 완료 분기에 `queryClient.invalidateQueries({ queryKey: ['session', id] })` 1줄 추가.
- **우선순위**: **High** · 5분

### H3. [A] 백엔드 완전 다운 시 검색이 "관련 세션을 찾지 못했어요"로 원인 은폐 (A4 부분 재발)

- **현재 상태**: `extension/lib/api.ts:181-192` — degraded fallback 내부의 `fetchSessions()`(:183)가 백엔드 다운이면 다시 throw → `{ degraded: true }` 반환에 도달하지 못하고 예외가 밖으로 전파. `SearchView`는 error 상태를 노출하지 않아 빈 결과로만 보임.
- **문제/리스크**: degraded 라벨은 "DB는 살아있고 Qdrant/검색만 죽은" 경우에만 작동. 데모 중 백엔드 프로세스가 죽으면 "백엔드 미연결"이 아니라 "관련 세션을 찾지 못했어요"가 표시되어 진짜 원인이 은폐된다.
- **개선 방안**: fallback 내부를 try/catch로 감싸 실패 시 `{ sessions: [], degraded: true }` 반환, 또는 `useSearch`의 `isError`를 뷰에 전달해 별도 오류 상태 표시.
- **우선순위**: **High** · 30분

### H4. [A] 민감 도메인 목록의 실효성 갭 — 토스가 안 걸러짐 + 미사용 `bookmarks` 권한

- **현재 상태**: `extension/lib/sensitive-domains.ts:4-18` — 도메인 목록이 실제 도메인과 대조 없이 작성된 흔적이 있음:
  - 결제(:15): `toss(payments)?\.com`인데 **토스 실제 도메인은 `toss.im`** → 미매칭.
  - 은행(:6): 그룹 전체가 `.com`만 매칭하는데 하나은행은 `kebhana.com`(`hana` 패턴은 접두사 불일치로 미매칭), IBK기업은행은 `ibk.co.kr`, 한국씨티는 `citibank.co.kr` → 모두 미매칭.
  - 인터넷은행/페이 부재: `kakaobank.com`, `kbanknow.com`(케이뱅크), `kakaopay`, `payco` 등 누락.
  - 반대로 `.or.kr` 전면 차단(:13)은 학회·협회 등 무관한 사이트 본문까지 비워 요약 품질 저하.
  - 별건으로 `wxt.config.ts:13`에 `chrome.bookmarks` 사용처가 전무한 `bookmarks` 권한 선언 (grep 0건 확인).
- **문제/리스크**: 심사위원이 토스/하나은행/카카오뱅크 탭을 열고 시연을 요청하면 본문이 그대로 전송됨 — 이전 리포트 A2가 우려한 바로 그 시나리오. 미사용 권한은 Chrome Web Store 심사 거부 사유이자 스스로 표방한 개인정보 최소화 원칙과 모순.
- **개선 방안**: 목록의 모든 항목을 실도메인과 대조 검증(브라우저에서 접속해 최종 hostname 확인)하고 `toss.im`·`kebhana.com`·`ibk.co.kr`·`kakaobank.com`·`kbanknow.com`·`kakaopay`·`payco` 등 보강. `.or.kr`은 의료·금융 서브셋만 남기고 완화. `bookmarks` 권한 제거.
- **우선순위**: **High** · 30분

### H5. [C] 발표자료 ↔ 구현 불일치 (이전 C1, 그대로 잔존)

- **현재 상태**: `ppt.md:93-95` "HDBSCAN, cosine similarity" / `ppt.md:106` "Structured Output 방식" ↔ 실제: solar-mini 프롬프트 클러스터링(`clusterer.py`) + 정규식 JSON 파싱. 파이프라인 순서도 상이(ppt: 임베딩→클러스터링 / 실제: LLM 클러스터링→요약→요약문 임베딩).
- **개선 방안**: 이전 리포트 C1의 전략 유지 — 실제 구현으로 갱신하고 전환 이유("탭 수십 개 규모에서 HDBSCAN은 파라미터에 민감 → LLM 클러스터링은 그룹핑과 주제명 생성을 동시에, 모델 티어링으로 비용·속도 해결")를 어필 포인트로 역이용. 코드 수정 없이 심사 Q&A 신뢰도 리스크를 제거하는 최고 가성비 작업.
- **우선순위**: **High** · 2~3시간

---

## B. Medium — 품질·안정성

### M1. [A] 기동 복구의 동시 실행 폭주 + fire-and-forget 태스크

- **현재 상태**: `backend/app/api/sessions.py:264-271` — pending 세션 N개를 `asyncio.create_task`로 동시에 실행하고 참조를 보관하지 않음.
- **문제/리스크**: ① A.X-K1 RPS 3 제한 초과로 연쇄 fallback/실패, ② 이벤트 루프는 태스크를 약참조로만 잡으므로 GC로 태스크가 중간에 사라질 수 있음(CPython 공식 문서 경고).
- **개선 방안**: 순차 for 루프를 단일 태스크로 감싸 실행하고 모듈 레벨 참조 유지.
- **우선순위**: **Medium** · 30분

### M2. [A] 검색에 score threshold 없음 + 예외 미처리 + title 미임베딩

- **현재 상태**: `backend/app/db/vector.py:59-66` — `search_similar`에 score_threshold 없음 → 무관한 쿼리도 항상 top-N 반환. `search.py:26` embed 실패 시 500. `sessions.py:62` — 임베딩 텍스트가 overview+purpose+highlights뿐이라 **세션 title이 검색 인덱스에 없음**.
- **문제/리스크**: "없는 주제 검색" 시 엉뚱한 세션이 그럴듯하게 나옴(데모 리스크). 제목 키워드 검색 취약.
- **개선 방안**: `query_points`에 `score_threshold`(0.3~0.4에서 실측 튜닝) 추가, embed_text에 title 포함(1줄), `/search`에 예외 처리로 5xx 대신 명확한 오류 응답.
- **우선순위**: **Medium** · 1시간

### M3. [A] 세션 복원 실패 은폐 — 항상 성공 토스트

- **현재 상태**: `extension/lib/chrome-bridge.ts:36-47` — `chrome.tabs.create` 순차 루프라 하나 실패 시 나머지 중단. 호출부(`SessionCard.tsx:104-119`, `SessionDetailView.tsx:152-166`)는 `void`로 프로미스를 버리고 결과와 무관하게 "복원했어요" 토스트. 탭 개수 상한/확인 없음.
- **개선 방안**: `Promise.allSettled`로 개별 실패 격리, 실패 건수를 토스트에 반영, 다수(예: 15개 초과) 탭 복원 시 확인 단계.
- **우선순위**: **Medium** · 1시간

### M4. [A] done·빈 overview 무한 스피너 잔여 경로 + 응답 매핑 널 방어 부재(잠재)

- **현재 상태**:
  1. **실재**: `SessionDetailView.tsx:202-209` — `summaryStatus === 'done'`인데 `overview`가 빈 문자열이면 재시도 버튼 없는 영구 "AI 요약 중…". LLM이 overview 키를 빠뜨리면 `summarizer.py:59`가 빈 문자열로 통과시키므로 도달 가능한 경로.
  2. **잠재**: `extension/lib/api.ts:42-50` — `b.todos.length` 등이 필드 누락/null 시 throw → `fetchSessions` 전체 실패로 세션 목록이 통째로 에러. 단 **현행 백엔드는 `_to_detail`이 항상 기본값 채운 배열을 반환하므로 지금은 발생하지 않음** — 계약 변경 시 목록 전체가 깨지는 구조라는 방어 차원의 지적.
- **개선 방안**: done+빈 overview는 실패 취급 또는 빈 요약 안내(H1 수정 시 "done이면 non-empty overview 보장"을 계약으로 함께 정리). 매핑에는 `?? []`/기본값 방어.
- **우선순위**: **Medium**(1번) / **Low**(2번) · 1시간

### M5. [B] 대시보드 검색의 drift — degraded/rerank 부재, 에러 시 빈 화면, 디바운스 없음

- **현재 상태**: `frontend/src/lib/api.ts:113-130` — Extension에 있는 `degraded` 플래그·`rerank` 파라미터가 대시보드엔 없음. 실패 시 조용히 substring 필터링으로 대체돼 AI 검색으로 위장. `HomeView.tsx:49` — 검색 모드 에러 분기 누락으로 백엔드 다운 시 **빈 화면**. `HomeView.tsx:51-54` — 키입력마다 `/search` 호출 → 임베딩 API 연타(Extension은 form submit으로 회피).
- **근본 원인**: extension↔frontend에 api/types ~130줄이 복붙되어 이미 갈라짐(`SearchResult`, `enrichTabs`, 민감 필터는 Extension에만 존재).
- **개선 방안**: 데모 전에는 degraded 반환 + 에러 분기 + 디바운스(300~500ms)만 이식. 중기적으로 shared 패키지로 타입·매퍼·API 클라이언트 단일 출처화.
- **우선순위**: **Medium**(대시보드 데모 시) · 2~3시간

### M6. [B] 대시보드 "AI로 세션 복원" 카드가 허상 — 제품 방향 판단 필요

- **현재 상태**: `frontend/src/views/HomeView.tsx:10-16` — "탭을 한 번에 열어요"라고 안내하지만 대시보드에 일괄 복원 기능이 없음(탭별 개별 `<a>` 링크만). 카드 클릭은 검색 모드 전환만 수행.
- **구조적 한계**: 일반 웹페이지는 사용자 제스처 1회로 수십 개 탭을 여는 것이 팝업 차단기에 막혀 신뢰성 있게 불가능 — "일괄 복원"은 본질적으로 Extension 전용 기능.
- **개선 방안**: 문구를 실제 동작에 맞추거나 "Extension에서 복원" 안내 CTA로 교체. 어느 쪽이든 팀의 제품 방향 결정 필요.
- **우선순위**: **Medium** · 30분~

### M7. [B] 무인증 + CORS 전체 허용

- **현재 상태**: `backend/app/main.py:29-34` — `allow_origins=["*"]`, 인증 없음. `DELETE`/`PATCH`/전체 조회 무방비.
- **문제/리스크**: 백엔드가 외부 노출되면 임의 웹사이트 JS가 전체 세션 열람·순회 삭제 가능. 로컬 데모 한정이면 수용 가능.
- **개선 방안**: 노출 계획이 있다면 최소한의 API 키 + origin 제한(chrome-extension:// + 대시보드 도메인).
- **우선순위**: **Medium**(노출 시) / 데모 한정이면 Low

### M8. [A] 탭 본문(탭당 최대 8000자)이 Postgres JSONB에 영구 보관

- **현재 상태**: 저장 시 `tabs=[t.model_dump()]`로 text_content 포함 전체가 DB에 남음. 응답에는 노출되지 않지만(`_to_detail`은 title/url만 매핑) 재요약(`retry-summary`)이 이 원문을 사용.
- **문제/리스크**: "민감 정보 수집 최소화" 원칙(ppt.md:232) 대비 과보관 + DB 비대. 단 비우면 재요약 품질이 떨어지는 트레이드오프.
- **개선 방안**: `summary_status="done"` 후 일정 시점에 `text_content`를 비우는 정리 작업 검토 — 보관 기간 vs 재요약 품질은 팀 판단 영역.
- **우선순위**: **Medium** · 판단 후 1~2시간

### M9. [A] MV3 특성 — 설치/재로드 이전부터 열려 있던 탭은 본문 수집 실패

- **현재 상태**: `extension/entrypoints/background.ts:4,37-56` — 본문 캐시가 서비스워커 메모리 Map이라 SW 유휴 종료 시 소실. 콘텐츠 스크립트는 기존 탭에 자동 주입되지 않아 on-demand `sendMessage`도 수신자 없음 → `text_content: ''`로 저장.
- **문제/리스크**: 데모 직전 익스텐션을 리로드하면 열려 있던 탭들의 본문이 전부 비어 요약 품질 급락.
- **개선 방안**: 정석은 `chrome.scripting.executeScript` 온디맨드 주입(`scripting` 권한 필요). 당장은 "저장 전 탭 새로고침"을 리허설 체크리스트에 명시하는 것으로 회피 가능.
- **우선순위**: **Medium** · 반나절 / 리허설 회피는 0분

---

## C. Low — 위생

- **L1. PATCH title 100자 초과 시 500**: `schemas/session.py:24`의 `PatchSessionRequest.title`에 `max_length=100` 없음 → DB `String(100)` 초과 시 DBAPI 에러. 1줄 수정.
- **L2. 삭제 세션의 Qdrant 고아 포인트**: `delete_point` 실패가 조용히 삼켜짐. 검색 결과는 `sessions_by_id` 필터로 방어되지만 top-N 후보 슬롯을 낭비. 기동 시 DB에 없는 포인트 청소 로직 고려 (선택).
- **L3. 새 dead code**: Extension — `lib/storage.ts` 전체, `lib/mock/*`, `components/SearchInput.tsx`, `components/Logo.tsx` (import 0건). Frontend — `Sidebar.tsx`, `SessionListView.tsx`, `SearchView.tsx`, `store/ui.ts`의 `activeView`/`setView` (죽은 SearchView가 "진짜"로 오인되기 쉬움 — degraded 처리가 없는 쪽).
- **L4. 문서 drift**: `IMPLEMENTATION.md:319-324`가 "민감 필터 미구현·redis 잔존"이라 서술하나 둘 다 해결됨 → README와 상호 모순. `.env.example`·`docker-compose.yml`의 "mock 단계" 주석 stale. dev 스크립트 로그가 존재하지 않는 redis 언급(`dev.sh:58`).
- **L5. dev 스크립트 Windows 이슈**: `dev_conda.sh`는 POSIX conda 레이아웃 가정(`bin/`)이라 Windows conda(`Scripts/`, `.exe`)에서 첫 검사에서 즉사. `dev.sh`의 cleanup은 파이프라인 말단(tag) PID만 kill해 uvicorn/vite가 잔존 가능.
- **L6. 프로덕션 배포 갭**: `host_permissions`가 localhost 전용(`wxt.config.ts:14`), `VITE_API_BASE_URL` 미설정 빌드는 localhost로 고정(빌드타임 인라인), HTTPS 대시보드 + http 백엔드는 mixed-content 차단.
- **L7. UI 세부**: 토스트 타이머 미관리로 연속 호출 시 조기 소멸(`store/ui.ts:33-36`), 대시보드 파비콘 404(`frontend/public/` 부재), 접근성(검색 input aria-label, 토스트 `role="status"`, `role="button"` div 내 실제 button 중첩), 시간 라벨에 연도 없음, 검색 결과 3개 고정 + "모두 보기" 버튼 onClick 없음, `TabListItem` "탭 열기"가 새 창을 여는 레이블-동작 불일치, native `confirm()` 삭제 확인.
- **L8. `useTabs` 모듈 전역 리스너 가드**: 다중 소비자 시 리스너 누락 가능(현재 소비자 1개라 잠재 버그) + 2초 폴링과 메시지 무효화 중복.

---

## D. 세션 분류 설계 방향 (설계 결정 기록 — **아직 미구현**)

> 2026-07-05 논의 결과. 코드 반영 전이며, 구현 시 이 섹션을 기준으로 진행한다.

### D1. 세션 정의 확장 — 주제 단일 축 → 주제 + 작업 의도 + 행동 구조

- **현재**: `clusterer.py`는 제목+URL의 의미 유사성(주제)만으로 그룹핑한다.
- **결정**: 분류에 **작업 의도**(무엇을 하려던 탐색인가)와 **행동 구조**(사용자가 어떻게 열고 묶었나)를 함께 반영한다.
- **행동 구조 신호** — Chrome이 공짜로 주는 메타데이터, 현재 전부 미사용:
  - `tab.groupId` — 사용자가 만든 탭 그룹은 **정답으로 취급** (LLM이 임의로 쪼개거나 섞지 않도록 프롬프트에서 제약)
  - `tab.windowId` — 창 분리는 사용자가 이미 수행한 작업 분리
  - `tab.openerTabId` — 탐색 트리. 같은 opener 체인 = 같은 작업 흐름일 확률 높음
  - `tab.lastAccessed` — 시간 근접성 (같은 시간대에 판 탭 묶음)
  - 전달 방식: `TabItemRequest`에 `group_id`/`window_id`/`opener_tab_id`/`last_accessed` 필드 추가 → 클러스터링 프롬프트에 탭별 힌트로 포함 (`[3] 제목 — URL (그룹: 여행, 2번 탭에서 파생)`). API 계약 변경이므로 extension `types.ts`·`enrichTabs`와 backend `schemas` 동시 수정 필요 — M5의 extension↔frontend 중복 문제와 연동해서 처리.
- **작업 의도**는 프롬프트 지시로 반영: "주제가 같아도 작업 흐름이 다르면 분리하고, 작업 흐름이 이어지면 병합하라".
- **팀 결정 필요(granularity)**: "일본 여행 준비" 하나로 묶을지 "항공권 비교"/"숙소 검색"으로 쪼갤지의 기준은 제품 판단 — 기준을 정해야 LLM에 지시할 수 있다 (예: "하나의 완결된 할 일 단위").

### D2. 클러스터링 방법 — LLM 유지 (임베딩 방식 실측 후 기각)

- **실측 결과**: 임베딩 기반 클러스터링을 실제로 실험한 결과 분류 품질이 낮았음 (팀 실측, 2026-07).
- **원인 분석** — 이 도메인에서 임베딩이 구조적으로 불리한 이유:
  1. 입력이 제목+URL 수십 자 — 짧은 텍스트 임베딩은 노이즈 비중이 큼
  2. 탭 수십 개 규모 — 밀도 기반(HDBSCAN 등)은 소표본에서 파라미터 민감·불안정
  3. 임베딩 유사도는 "주제 근접"만 포착 — D1의 작업 의도·행동 구조 축을 표현할 수 없음
  4. 그룹핑에 성공해도 주제명 생성에 어차피 LLM이 필요 — 2단계 파이프라인 비용만 추가
- **반론 검토**: 본문 텍스트까지 임베딩하면 품질이 오를 수 있으나, 탭 N개 × 임베딩 호출 비용/지연이 커지고 민감 필터로 본문이 빈 탭은 여전히 커버 못 함 → 결론 동일.
- **결정**: LLM(solar-mini) 프롬프트 클러스터링 유지. 임베딩은 **검색**(요약문 벡터)과 **D4 세션 간 병합 판정**에 사용 — 적재적소 분리.
- **발표 활용(H5 연계)**: "임베딩 클러스터링을 실험 → 품질 한계 실측 → LLM 전환"은 근거 있는 설계 판단 스토리. ppt.md의 HDBSCAN 서술을 이 서사로 교체하면 심사 Q&A 답변이 된다.

### D3. 현행 LLM 클러스터링 손질 (구현 대기 · 1~2시간)

- LLM이 빠뜨린 탭·`_MAX_TABS`(20) 초과분을 마지막 그룹에 붙이지 말고 **"기타" 그룹으로 분리** — 현재는 멀쩡한 주제 세션이 무관한 탭으로 오염됨 (`clusterer.py:64-78`).
- 프롬프트에 `excerpt` 앞 80자 추가 — "Google Docs", "로그인" 같은 무의미 제목 탭 대응 (민감 필터 탭은 excerpt가 null이라 자동 제외).
- 그룹핑 규칙 명시 + few-shot 예시 1개: "1탭짜리 그룹 남발 금지, 확신 없으면 기타로" — 세션 파편화 방지.

### D4. 증분 분류 — 기존 세션과 병합 제안 (구현 대기 · 1일)

- **문제**: 저장할 때마다 무조건 새 세션 → 같은 주제를 반복 저장하면 중복 세션 누적. ppt.md 문제 정의 2번("중복 탭 과잉")을 해결하는 기능이 현재 전무하며, 이것이 그 답이 된다.
- **방안**: 새 그룹의 요약 임베딩을 기존 세션 벡터와 비교(기존 Qdrant 인프라 재활용), 유사도 > threshold(실측 튜닝)면 "기존 '일본 여행' 세션에 합칠까요?" 제안.
- **원칙**: 자동 병합 금지 — 반드시 사용자 확인 후 병합. AI가 기존 세션을 임의 변경하지 않는다는 설계 원칙 유지.

### D5. 평가 골든셋 (구현 대기 · 리허설과 겸사)

- 실제 브라우징 스냅샷 3~5개 + 사람이 만든 정답 그룹핑으로 골든셋 구성.
- 프롬프트/방식 변경 시 골든셋 대비 회귀 비교 — "어떤 분류가 좋은가"를 측정 가능하게. C3 리허설 준비와 함께 진행.

---

## 지금 당장 해야 할 Top 3

| # | 항목 | 이유 | 소요 |
|---|---|---|---|
| 1 | **H1 + H2** — summarizer fallback을 `failed`로 전파 + 폴러 상세 쿼리 무효화 | 지난번에 없앴다고 믿는 무한 스피너·재시도 불능이 두 경로로 살아 있음. 재시도 UI를 실제로 작동시키고 Qdrant 오염을 막는 열쇠 | 1시간 |
| 2 | **H4** — `toss.im`·카카오뱅크 등 도메인 보강, `.or.kr` 완화, `bookmarks` 권한 제거 | "민감 데이터는 기기를 떠나지 않는다" 어필의 실효성 확보 | 30분 |
| 3 | **H5** — ppt.md를 실제 구현으로 정합화 | 코드 수정 없이 심사 Q&A 신뢰도 리스크 제거 — 이전 리포트 Top 3 중 유일한 미이행 항목 | 2~3시간 |

H3(검색 원인 은폐)와 M1(기동 복구 순차화)이 그 다음 순위로, 각각 30분 내 수정.

**전제**: 이 우선순위는 "대회 데모 최우선" 프레임 기준이다. 목표가 데모를 넘어 실사용/배포라면 M7(무인증)과 M5(코드 중복 해소)가 Top 3로 올라와야 한다.

**확인 필요로 남긴 것**: M8(본문 보관 기간), M6(대시보드 복원 UX 방향), D1(세션 granularity 기준 — "완결된 할 일 단위"로 묶을지 세부 작업으로 쪼갤지)은 코드가 아니라 제품 판단의 문제 — 팀 결정 후 반영.
