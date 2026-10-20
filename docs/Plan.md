# Atlas 폴더 자동 분류 (확실하면 자동, 애매하면 제안)

**상태:** 구현 완료 (2026-10-20)
**브랜치:** `feat/folder-auto-classify`

## 작업 목표

- 사용자가 만든 폴더는 그대로 두고, 새 세션이 기존 폴더와 확실히 비슷하면 자동으로 넣고(표시·되돌리기), 애매하면
  "정리 안 됨"에서 폴더를 제안한다. 사용자의 결정(옮기기·빼기·제안 닫기)은 자동 분류가 다시 건드리지 않는다.

## 사용자 결정 사항 (확인 완료, 2026-10-20)

- 사용자 폴더 유지 + 확실할 때 자동 + 애매하면 제안. 2026-08-07 "자동 분류 안 함" 결정을 이 범위로 바꾼다.

## 현재 상태와 조사 결과

- 수동 이동은 이미 있다(내비게이터 드래그·`+` 다중 선택·폴더에서 빼기). `sessions.folder_id` 단일 소속, FK 없음.
- 세션 벡터는 Qdrant `orbit_sessions`(제목·개요·목적·핵심)에 있다. `score_sessions`로 지정 세션만 점수를 매길 수 있다.
- 기준 점수 측정(`real-eval` 21세션 leave-one-out + `ask-eval` 8세션, 폴더 점수 = 그 폴더 세션 중 가장 비슷한 2개 평균):
  폴더가 있는 17개 모두 1위가 정답(0.394~0.580). 폴더 없는 세션 최고 0.27~0.36. 애매: 제주 여행→강릉 0.447(차이 0.04),
  전세대출→청년월세 0.521(차이 0.11).
- 설정은 `app_settings` 전역 키-값(`auto_merge_enabled`와 같은 방식).

## 포함 범위

- `sessions.folder_assigned_by`(`user`|`auto`|NULL) 컬럼과 멱등 마이그레이션. 배정 API는 `user`, 빼기는 NULL 폴더 + `user`,
  폴더 삭제는 NULL/NULL.
- `services/folder_classifier.py`: 폴더 점수(사용자가 넣은 세션만 근거, 자동 배정 세션은 근거에서 제외), 판정
  (자동: 점수 ≥ 0.47·2위와 차이 ≥ 0.12·근거 세션 ≥ 2, 제안: 점수 ≥ 0.40).
- 배치 끝에 이번 배치에서 만들어지거나 바뀐 미정리·미결정 세션만 자동 배정(`auto_folder_enabled`, 기본 켜짐).
- `GET /folders/suggestions`, `POST /folders/suggestions/{session_id}/dismiss`, `SessionDetail.folder_assigned_by`,
  설정 `auto_folder_enabled`.
- 확장: '자동' 표시, 정리 안 됨의 제안(넣기·닫기·모두 넣기), 사이드패널 설정 토글.

## 제외 범위

- 폴더 자동 생성·이름 짓기, 이미 쌓인 세션의 일괄 자동 이동(제안만), 캔버스 위 드래그, 사용자별 설정 저장소.

## 검증

- 백엔드·확장 단위 테스트, 타입 검사, 빌드. 실제 데이터로 배치 자동 배정과 제안 확인, 실제 확장 화면 확인.

## 완료 조건

- 확실한 세션은 자동으로 들어가 '자동' 표시가 붙고, 애매한 세션은 제안으로 뜨며, 사용자가 빼거나 닫은 세션은 다시 건드리지
  않는다. 전체 테스트·빌드 통과.

---

# Ask 답변의 비슷한 대상 혼동 검증

**상태:** 구현 완료 (2026-10-20)
**브랜치:** `feat/ask-conflation-check`

## 작업 목표

- 답변이 질문한 대상과 비슷한 다른 대상의 값을 가져온 경우(청량리 출발 막차 ← 서울역 출발 시각, 서울시 접수일
  ← 국토부 날짜, 튜토리얼 목표치 ← 실측 글 목표치)를 답변 직후 검증해 사용자에게 알린다.

## 현재 상태와 조사 결과 (real-eval3, 기록된 답변 38개)

- 프롬프트 규칙 변경 2종과 K-EXAONE 답변 모델 교체로는 혼동이 줄지 않았다(2026-10-19).
- 검증기 v1(답변 전체에 ok/fix 판정): A.X는 혼동 3건 중 1건만 잡고 맞는 답 2건을 걸렀다. EXAONE은 혼동은 잡지만
  맞는 답 다수를 걸렀다.
- 검증기 v2(값마다 기록 원문·원문의 대상·질문의 대상·같음 여부): A.X가 혼동 3건을 3회 모두 잡았다. 오탐은 "찾지 못했어요"
  답변(코드로 제외 가능)과 원문 없는 값 1/3회(원문이 있는 불일치만 쓰면 제외)뿐이었다.
- 걸린 답을 검증 메모와 함께 다시 생성하면 청량리 질문이 21:31로 되돌아가거나 "찾지 못했어요. 50%입니다"처럼 앞뒤가
  맞지 않았다(메모 문구 3종). 답을 고쳐 쓰지 않고 경고로 알린다.

## 포함 범위

- 백엔드 `services/answer_verifier.py`: 검증 프롬프트·응답 검증·불일치 추출. A.X 결과만 쓰고 실패·타임아웃·형식 오류는
  경고 없이 끝낸다(로그).
- `POST /ask/stream`: 답변 스트림 뒤 `verification` 이벤트(불일치가 있을 때만) → `done`.
- 확장: `streamAsk` 이벤트 파싱, 턴 상태에 경고 저장, 사이드패널·새 탭 답변 아래 경고 표시.
- 평가 하네스가 `verification` 이벤트를 기록.

## 제외 범위

- 답변 자동 재작성, 답변 모델 교체, 근거 없는 값(환각) 검출.

## 검증

- 백엔드·확장 단위 테스트, 타입 검사, 빌드. 실제 평가(real-eval3 질문 38개 + 합성 Ask 평가셋)에서 검출·오탐·지연 확인.

## 완료 조건

- 혼동 사례에 경고가 붙고 맞는 답에는 붙지 않는다. 검증 실패가 답변을 막지 않는다. 전체 테스트·빌드 통과.

---

# 정부 공지 페이지 본문 수집 (`.go.kr` 민감 도메인 축소)

**상태:** 구현 완료 (2026-10-20)
**브랜치:** `feat/gov-content-capture`

## 작업 목표

- 공공 공지·안내 페이지(복지로, 지자체 공지)의 본문을 수집해 정책·지원금 질문에 답할 수 있게 한다.

## 사용자 결정 사항 (확인 완료)

- 선택지 B: `.go.kr` 허용, 로그인 후 개인 기록을 다루는 정부 서비스만 제외(2026-10-20).

## 포함 범위

- 확장 `lib/sensitive-domains.ts`와 백엔드 `services/event_filter.py`의 같은 규칙 변경, 양쪽 테스트, 관련 문서.

## 제외 범위

- 마이페이지 경로 규칙 확대 등 다른 민감 규칙 변경.

## 검증

- 확장·백엔드 단위 테스트, 실제 정부 사이트 재생으로 저장 길이 확인, Ask 질문 3개.

## 완료 조건

- 공공 공지 본문이 저장되고 정부24 등 개인 서비스는 계속 비어 있다. 전체 테스트·빌드 통과.

---

# 본문 수집 폴백과 상한 상향

**상태:** 구현 완료 (2026-10-19)
**브랜치:** `feat/content-capture-fallback`

## 작업 목표

- Readability가 본문을 못 찾거나 짧게 뽑는 페이지에서도 본문을 남긴다(네이버 블로그 0자, 리멤버 211자).
- 4,000자 상한 때문에 긴 페이지의 뒷부분 사실(비용·FAQ)이 빠지는 문제를 줄인다.

## 현재 상태와 조사 결과 (실제 크롬, load / +3초 / +6초)

- 네이버 블로그: 최상위 문서는 비어 있고(Readability null) 본문은 same-origin iframe `#mainFrame`에 있다.
  iframe 문서에 Readability를 돌리면 본문 1,202자가 나온다. content script는 최상위 프레임에서만 돈다.
- 리멤버: Readability가 엉뚱한 블록(211자)을 고른다. 화면 텍스트는 2,912자.
- 복지로·경남바로서비스·서울 청년몽땅정보통: Readability는 850~1,569자를 뽑는다. 0자는 `.go.kr` 민감 도메인 정책
  (확장·백엔드 모두 본문 제거)의 의도된 결과다 — 이번 범위 밖.
- 정부24: 헤드리스 크롬을 `/mbuster/Mbuster_T.html`("비정상 서비스 접속으로 차단")로 돌려보낸다. 고칠 수 없다.
- 늦게 렌더링돼 load 시점에 비어 있던 페이지는 이번 55개에는 없었다(네이버 검색은 시점마다 길이가 흔들림).
- Readability 원문에 공백이 많아 4,000자 중 상당 부분이 공백이었다(koreacharts 원문 60,246자 → 정규화 3,755자).
- 정규화 후 54개(1개 타임아웃) 길이: 중앙값 3,574, p75 6,770, p90 11,760, 최대 29,976. 상한별 온전히 남는
  페이지: 4,000 31개, 8,000 43개, 12,000 49개, 16,000 51개.

## 포함 범위

- content script 추출 폴백: Readability → (짧으면) same-origin iframe 문서의 Readability → 화면 텍스트
  (`document.body.innerText`). 공백·빈 줄 정규화. 결과가 짧으면 3초 뒤 한 번 더 추출해 더 길 때만 다시 보낸다.
- 상한 16,000자: 확장 `MAX_CONTENT_EXCERPT_LENGTH`·content script, 백엔드 `_MAX_EXCERPT_LEN`, DB `String(16000)`.
- 기동 마이그레이션에 `exploration_events.content_excerpt` 폭 확장(현재 길이가 작을 때만 ALTER).

## 제외 범위

- `.go.kr` 민감 도메인 정책 변경(보안 정책 — 사용자 결정 필요), 모든 프레임 주입(`all_frames`), `backend/app/services/*`.

## 변경 파일

- `extension/lib/page-text.ts`(신규, 순수 함수), `extension/entrypoints/content.ts`, `extension/lib/events/types.ts`,
  `extension/lib/types.ts`(주석), 테스트 `tests/unit/page-text.test.ts`·`queue.test.ts`.
- `backend/app/api/events.py`, `backend/app/db/models.py`, `backend/app/db/migrations.py`, 테스트.

## 테스트 및 검증

- `pnpm test && pnpm compile && pnpm build`, `python -m pytest -p no:asyncio`.
- 포트 8007 백엔드 + 확장 빌드로 실패 URL과 일반 기사 3개를 재생해 DB에 저장된 길이를 확인한다.

## 위험

- 화면 텍스트 폴백은 메뉴·푸터가 섞인다. Readability가 500자 이상이면 쓰지 않는다.
- 상한 상향으로 배치(50건) 최악 크기 약 2.3MB(한글 3바이트), 평균 저장 길이 2,771 → 4,824자(+74%).

## 완료 조건

- 네이버 블로그·리멤버가 실제 재생에서 500자 이상 저장되고, 긴 페이지가 16,000자까지 저장된다.
- 전체 테스트·타입 검사·빌드 통과, 문서·WorkLog·DecisionLog 갱신.

---

# 실제 데이터 기준 세션화·Ask 근거 판단 개선

**상태:** 구현 완료 (2026-10-19)
**브랜치:** `fix/session-clustering-real-data`

## 작업 목표

- 실제 사이트 탐색 평가(PR #21)에서 드러난 세션 과분할, 무관 세션 append, 비슷한 대상 혼동을 줄인다.

## 조사 결과

- 임베딩 선분리는 여정을 정확히 나누고, 과분할은 그 안의 LLM 분할(세부 항목별 create, 없는 `S0` append)이다.
- 최근 24시간 후보는 점수가 없어 append 유사도 게이트를 건너뛴다(강아지 접종 세션에 로봇청소기 append).
- 세션이 커지면 세부 질문의 세션 점수가 0.28 아래로 내려가 출처가 0개가 된다(본문 조각 점수는 0.496).
- 비슷한 대상 혼동(청량리↔서울역, 서울시↔국토부)은 규칙 문구 2종·K-EXAONE 모두 0/4로 개선되지 않았다.

## 포함 범위

- 서브클러스터 안 세션 병합, 최근 후보 점수 계산, Ask 본문 조각 관련성 기준(0.40).

## 제외 범위

- 비슷한 대상 혼동 — 프롬프트·모델로 해결되지 않아 남은 위험으로 둔다(검증 단계 추가는 별도 결정).
- 본문 수집 개선은 `feat/content-capture-fallback`에서 따로 한다.

## 검증

- 단위 테스트, 골든셋 재생 비교, 실제 이벤트 원래 배치 재세션화, 실제·합성 Ask 평가 각 2회.

## 완료 조건

- 재세션화에서 과분할·무관 append가 줄고, Ask 실제·합성 평가에서 회귀가 없다.

---

# Ask 본문 예산과 임베딩 캐시

**상태:** 구현 완료 (2026-10-19)
**브랜치:** `feat/ask-budget-cache`

## 작업 목표

- 출처가 여러 개일 때 페이지에 흩어진 세부(공고별 연봉 등)가 답변에서 빠지는 문제를 줄인다.
- 같은 문장을 매번 다시 임베딩해 생기는 지연(본문 조각 임베딩 약 0.9초)을 줄인다.

## 조사 결과

- 본문 예산이 전체 8,000자(출처 2개면 세션당 4,000자)이고 점수 순으로만 골라, 한 페이지의 조각이
  예산을 차지하면 다른 페이지의 세부가 빠졌다(라이트헬스 연봉 "기록에 없음").
- A.X-K2 실측: 프롬프트 8,000자·16,000자 첫 토큰 0.72초 동일, 32,000자 1.9초, 64,000자 3.9초.
- 임베딩은 캐시가 없어 후속 질문·같은 질문 반복·라우터 프로토타입마다 Upstage를 다시 호출한다.

## 포함 범위

- 본문 예산 16,000자(세션당 최소 4,000자, 페이지 10개), 페이지 커버리지 우선 선택.
- `embed`/`embed_many` 공통 메모리 LRU 캐시(float32, 최대 2,000개).
- 평가: 여러 페이지 세부 4문항 추가, main 대비 품질·지연 비교.

## 제외 범위

- 본문 조각 벡터의 영구 저장(Qdrant 별도 컬렉션) — 저장 구조 변경이라 별도 결정.

## 완료 조건

- 새 4문항 포함 평가에서 main보다 세부 포함률이 오르고, 기존 문항·후속 질문이 떨어지지 않는다.
- 후속 질문의 컨텍스트 단계 지연이 줄어든다. 전체 테스트 통과, 문서·WorkLog 갱신.

---

# Ask AI 후속 질문 지원과 실제 모델 기준 개선

**상태:** 구현 완료 (2026-10-19)
**브랜치:** `feat/ask-followup` (Qdrant 사용자 필터는 `feat/qdrant-user-filter` #18로 먼저 병합)

## 작업 목표

- "그중 마감이 제일 빠른 곳은?", "그럼 9070은?" 같은 후속 질문에 이전 대화를 이어서 답한다.
- 현재 연결된 모델(A.X-K2 + K-EXAONE dedicated)로 평가해 드러난 문제를 고친다.

## 현재 상태와 조사 결과

- `/ask/stream`은 독립 단일턴이었고, 프롬프트도 "이전 대화를 참조하지 말라"고 지시했다. 확장은 화면에 대화를
  누적만 하고 요청에는 넣지 않았다(`useAskConversation.ts`).
- 실제 모델 평가에서 추가로: K-EXAONE 의도 분석 응답의 날것 개행·깨진 토큰으로 그룹이 계속 hold되어 세션이
  생기지 않았고(제주 주제 전체 누락), 같은 주제가 두 세션으로 나뉘면 근거 점수 하한 바로 아래 세션이 빠졌다.

## 사용자 결정 사항 (확인 완료)

- 후속 질문 지원 추가(요청 계약에 선택 필드 추가) — 2026-10-19 사용자 요청.

## 포함 범위

- 요청 `history`(선택, 최대 3턴, 서버 비저장), 후속 질문 재작성(검색 전용), 직전 출처 후보 추가(소유권 확인),
  답변 프롬프트의 이전 대화 블록, 확장의 history 전송·안내 문구, 후속 질문 라우팅 규칙.
- 실제 모델 대응: JSON 파싱 strict=False(main 직접), 의도 분석 형식 오류 시 A.X 재시도, 출처 동점 규칙,
  다부분·비교 질문 규칙.
- 평가 하네스 대화 케이스.

## 제외 범위

- 대화 기록의 서버 저장, 세션 상세(`session_id` 지정) 화면의 대화 맥락 확장.
- 본문 조각 임베딩 캐시(후속 질문 지연 단축) — 메모리 비용이 있어 별도 판단.

## 검증

- backend 전체 테스트, extension test/compile/build, 라우팅 평가, Ask 평가(main vs 브랜치, 실제 모델).

---

# Ask AI 답변 품질 개선

**상태:** 구현 완료 (2026-10-19) — 실제 모델(A.X-K2) 재측정 완료, 사이드패널 화면 확인은 미실시
**브랜치:** `feat/ask-answer-quality`

## 작업 목표

Ask AI가 사용자의 탐색 기록에서 실제 근거를 찾아 질문에 바로 답하게 한다. 답이 없는 질문은
상식으로 채우지 않고 못 찾았다고 말하게 한다.

## 현재 상태와 조사 결과

실측: 6개 주제 34개 이벤트(페이지 본문 포함) + 질문 20개(사실·비교·요약·할 일·교차·부정)를
로컬 백엔드에 넣고 UI와 같은 경로(`/assistant/route` → `/ask/stream`)로 질문했다.
A.X-K1·EXAONE 키가 막혀 측정은 Upstage `solar-pro2`로 두 슬롯을 대신했다.

기준선: 사실 포함률 0.58, 완전 정답 8/16, 부정 질문 거절 4/4, 잘못된 인용 4건.

- **라우팅 오분류.** "체크인 몇 시였어?" 같은 사실 질문 5개가 의미 라우터에서 `find_sessions`로
  분류돼 답 없이 "관련 세션 1개를 찾았어요"만 반환했다(`assistant_router.py`). 1개는 `navigate_tab`.
- **본문 앞 1200자만 사용.** 페이지 본문(최대 4000자)의 앞부분만 넣어(`ask_service.py`
  `MAX_EXCERPT_CHARS`) 뒤쪽 사실을 못 보고 상식으로 채운 답이 나왔다(전세대출 필요서류).
  이어 붙인 컨텍스트도 14,000자에서 잘려 세 번째 세션이 사라질 수 있다.
- **메타데이터 없음.** 세션 날짜·방문 시각·검색어가 프롬프트에 없어 "지난주에 본" 같은 질문의 근거가 없다.
- **인용 번호.** 출처 세션이 1개인데 페이지마다 [2]~[4]를 붙였다.
- **Markdown 노출.** UI는 답변을 일반 텍스트로 표시하는데 모델이 `**`, `###`를 쓴다.
- **공급자 장애 시 폴백 없음.** 주 공급자가 401/403이면 예외를 그대로 던져 Ask가 통째로 실패한다(`llm.py`).

## 포함 범위

- 라우터: 의문사가 있는 내용 질문은 규칙 단계에서 `search_memory`로 보낸다(명시적 세션 찾기 규칙이 우선).
- 컨텍스트: 페이지 본문을 조각으로 나눠 질문과 가까운 조각을 고르고, 세션별 예산으로 배분한다.
  세션 기간·방문 시각·검색어·오늘 날짜를 넣는다. 임베딩 실패 시 기존 방식으로 폴백.
- 프롬프트: 첫 문장에 바로 답, 기록의 표기 그대로, 상식으로 채우지 않기, 세션 번호만 인용, 일반 텍스트.
- LLM: 401/403도 다른 공급자로 폴백. 답변이 토큰 한도로 잘리면 로그를 남긴다.
- 평가 하네스: 질문 세트와 채점 스크립트를 `backend/eval/`에 남긴다.

## 제외 범위

- 후속 질문(대화 맥락) 지원 — `/ask/stream` 요청 계약 변경이 필요해 사용자 결정 후 진행.
- Qdrant 검색에 사용자 필터 추가 — 포인트 payload 변경과 재색인이 필요. 별도 작업으로 제안.
- 채팅 LLM 공급자 변경(A.X·EXAONE → Solar) — 사용자 결정 사항.

## 변경할 파일

- `backend/app/services/assistant_router.py`, `backend/app/services/ask_service.py`,
  `backend/app/api/ask.py`, `backend/app/ai/llm.py`
- `backend/tests/test_assistant_router.py`, `test_ask.py`, `test_llm_stream.py`
- `backend/eval/` Ask 평가 데이터·스크립트, `backend/eval/README.md`
- `backend/app/api/search.py`(후보 확장), `backend/app/ai/embedding.py`(100개 배치)
- 확장 답변 정리(`lib/ask-answer.ts`, `AskConversationPanel.tsx`, `AskView.tsx`)

## 구현 순서

1. 라우터 규칙 → 라우팅 평가(`eval.run_assistant_eval`) + Ask 실측
2. 컨텍스트 조각 선택·메타데이터 + 프롬프트 → Ask 실측
3. LLM 폴백·잘림 로그
4. 남은 실패 유형에 따라 검색 보강 또는 UI 렌더링 판단

## 테스트 및 검증

- `cd backend && python -m pytest -p no:asyncio`, 라우팅 평가, Ask 실측(전후 비교)
- 확장 변경 시 `pnpm test && pnpm compile && pnpm build`

## 위험

- 조각 임베딩으로 Ask 1회당 임베딩 입력이 늘어난다(Upstage 배치 1~3회). 지연을 실측한다.
- 측정 모델(Solar)과 운영 모델(A.X-K1)의 서식·지시 이행 차이. 키가 복구되면 같은 세트로 재측정한다.

## 완료 조건

- 사실 포함률·완전 정답 수가 기준선보다 오르고, 부정 질문 거절과 라우팅 평가가 떨어지지 않는다.
- 잘못된 인용 0건, 전체 테스트 통과, 문서·WorkLog 갱신.

---

# 사이드패널 개편 — 세션 행 리스트와 Ask AI 상시 독

**상태:** 구현 완료 (2026-08-12) — 실제 브라우저 스모크 미실시
**브랜치:** `feat/sidepanel-redesign`

## 작업 목표

- 세션 탭을 카드 그리드에서 새 탭 아틀라스와 같은 계열의 **행 리스트**로 바꾼다.
- Ask AI를 상단 탭에서 빼고 **메인 탭 하단에 상주하는 입력창**으로 옮긴다. 질문을 보내면
  답변 화면이 아래에서 올라와 덮고, 뒤로가기로 원래 탭에 복귀한다.
- 세션 탭 안에 접혀 있던 **열린 탭 찾기·북마크**를 Ask AI가 비운 세 번째 탭으로 승격한다.
- **현재 세션(수동 저장)** 카드를 없앤다. 세션화는 이벤트 배치가 담당하므로 수동 저장 경로가
  제품 흐름에서 필요하지 않다.

## 현재 상태와 조사 결과

- `TopNavBar.tsx:28-32` — 세그먼트 탭 3개(`타임라인` / `세션` / `Ask AI`). `Ask AI` 탭의 실체는
  `activeView === 'search'` → `SearchView`다.
- 검색 경로는 Ask 하나뿐이다. `useAskConversation`이 질문을 `search_memory` /
  `search_session` / `navigate_tab`으로 라우팅하므로(`useAskConversation.ts:139-217`),
  Ask를 채팅창으로 옮겨도 잃는 검색 기능이 없다.
- `useAskConversation`의 턴 저장소는 모듈 전역 zustand store다(`useAskConversation.ts:38-41`).
  뷰가 언마운트돼도 대화가 남으므로 오버레이 개폐 구조에 그대로 맞는다.
- `SessionCard.tsx` 한 장에 제목·요약 2줄·복원 버튼·오버플로 메뉴·파비콘·시간이 모두 들어 있고,
  `SessionListView.tsx:69`에서 폭에 따라 1~3열 그리드로 깔린다. 행 리스트에는 자리가 없다.
- `Session.timeLabel`은 이미 `8/7 20:45` 형식이다(`lib/api.ts:173`). 시안의
  `20개 탭 · 8/7 22:31`을 `tabs.length` + `timeLabel`로 그대로 만들 수 있다.
- `CurrentSessionCard`는 `useSaveSessionsClustered`와 `isClustering`의 **유일한 호출자**다.
  이걸 없애면 `SessionListView`의 `ClusteringCard`("주제 분류 중…")를 켤 주체도 사라진다.
- `OpenTabsPanel`의 목록 영역은 `max-h-80`으로 고정돼 있다(`OpenTabsPanel.tsx:139`).
  독립 탭으로 올리면 화면 높이를 채우도록 바꿔야 한다.

## 사용자 결정 사항 (확인 완료)

- 세션 행: **행 클릭 = 상세 진입, caret = 탭 목록 인라인 펼침**.
- 복원·삭제는 caret으로 펼친 영역 맨 아래 액션 줄에 둔다.
- AI 요약문은 펼친 영역 상단. 단 **요약 중·요약 실패는 접힌 행에서도** 보인다.
- 병합 제안은 세션 탭 상단에 그대로 유지한다.
- 열린 탭 찾기·북마크는 세 번째 탭으로 승격한다.
- 키워드·세션 검색은 계속 채팅창이 처리한다.
- 하단 입력창은 메인 탭(타임라인/세션/열린 탭)에만. 상세·설정에는 없다.
- 현재 세션 카드와 수동 저장은 제거한다.
- 타임라인 탭과 설정 화면은 이번 범위 밖 — 다음 섹션에서 다룬다.

## 포함 범위

- 사이드패널 탭 구성 변경과 뷰 라우팅(`store/ui.ts`, `TopNavBar`, `App`).
- 세션 목록의 행 리스트 전환(`SessionRow` 신규, `SessionListView` 재구성).
- Ask 상시 독과 답변 오버레이(`AskDock`, `AskView` 신규, `SearchView` 대체).
- 열린 탭 탭 승격(`OpenTabsView` 신규, `OpenTabsPanel` 높이 대응).
- 현재 세션 카드·수동 저장 훅·클러스터링 표시 제거.

## 제외 범위

- 타임라인 뷰, 설정 뷰, 세션 상세 뷰의 디자인 (다음 섹션).
- 백엔드 변경 없음. `/sessions/cluster` 엔드포인트는 그대로 둔다.
- Ask 답변의 "관련 세션"은 기존 `SessionCard`를 계속 쓴다. 목록과 표현이 갈리지만
  이번 지시 범위가 세션 탭이므로 임의로 바꾸지 않는다.

## 변경할 파일

| 파일 | 변경 |
| --- | --- |
| `store/ui.ts` | `View`에서 `search` 제거·`tabs` 추가, `askOpen`/`openAsk`/`closeAsk` 추가, 죽은 `searchQuery`·클러스터링 상태 제거 |
| `components/TopNavBar.tsx` | 탭 라벨 `타임라인/세션/열린 탭`, ask 열림 시 `‹ Ask AI` 헤더 + 새 대화 |
| `components/SessionRow.tsx` | 신규 — 행 리스트 아이템, caret 펼침, 파비콘 스택 |
| `components/AskDock.tsx` | 신규 — 하단 상주 입력창 |
| `views/AskView.tsx` | 신규 — 답변 오버레이 (SearchView의 대화 렌더링 이관) |
| `views/OpenTabsView.tsx` | 신규 — 열린 탭 탭 컨테이너 |
| `views/SessionListView.tsx` | 병합 제안 + 행 리스트로 재구성 |
| `components/OpenTabsPanel.tsx` | 목록 영역 `max-h-80` → 부모 높이 채움 |
| `App.tsx` | 독·오버레이 레이아웃 |
| `views/SearchView.tsx` | 삭제 (AskView가 대체) |
| `components/CurrentSessionCard.tsx` | 삭제 |
| `hooks/useSessions.ts` | `useSaveSessionsClustered` 제거 |
| `tests/unit/ui-store.test.ts` | ask 오버레이·뷰 전환 테스트 추가 |

## 구현 순서

1. `store/ui.ts` 계약 확정 (View union, askOpen).
2. `SessionRow` 신규 + `SessionListView` 재구성 + `CurrentSessionCard` 제거.
3. `OpenTabsView` + `OpenTabsPanel` 높이 대응.
4. `AskDock` + `AskView` + `TopNavBar` ask 헤더 + `App` 레이아웃, `SearchView` 삭제.
5. 테스트 추가 후 `pnpm test && pnpm compile && pnpm build`.
6. 문서 갱신(IA / DecisionLog / WorkLog).

## 테스트 및 검증

- `cd extension && pnpm test` — ui store 신규 상태 전이 포함.
- `pnpm compile` — `View` union 변경이 남긴 참조를 타입 검사로 잡는다.
- `pnpm build`.
- 실제 브라우저 스모크는 사용자 확인 필요(자동 검증 불가).

## 위험

- `View`에서 `search`를 없애면 참조가 남을 수 있다 → `pnpm compile`로 확인한다.
- 수동 저장 제거로 `lib/api.ts:391 saveSessionsClustered`와 `hooks/useTabs.ts:39 useTabs`가
  미사용이 된다. API 경계·백엔드 엔드포인트와 맞물려 있어 이번엔 지우지 않고 보고에 남긴다.
- 하단 독이 세로 약 60px을 상시 점유한다. 행 높이가 커진 만큼 한 화면 세션 수가 줄어든다.

## 완료 조건

- 세션 탭이 시안의 행 리스트로 보이고, caret 펼침에서 요약·탭 목록·복원/삭제가 모두 된다.
- 요약 중·요약 실패가 접힌 행에서 보이고 재시도가 동작한다.
- 메인 세 탭 하단에 입력창이 있고, 전송하면 답변 화면이 올라오고 뒤로가기로 복귀한다.
- 열린 탭이 독립 탭으로 동작한다.
- 테스트·타입 검사·빌드 통과.

---

# 열린 탭 화면 경량화 (2026-08-12)

**상태:** 구현 완료 (2026-08-12)
**브랜치:** `feat/sidepanel-redesign`

## 작업 목표

열린 탭 화면을 검색과 목록 중심의 평평한 구조로 바꾸고, 북마크는 탭을 선택했을 때만
나타나는 문맥 작업으로 정리한다. 세션 저장 기능은 추가하지 않는다.

## 현재 상태와 조사 결과

- 검색 입력과 비활성 북마크 버튼이 같은 줄에 있어 검색 폭이 좁다.
- 외곽 카드, 검색창, 목록 행에 둥근 테두리가 겹쳐 좁은 사이드패널이 답답해 보인다.
- 전체 URL을 표시해 도메인과 창 번호를 빠르게 훑기 어렵다.
- 우측 `LocateFixed` 아이콘만으로는 탭 이동 동작을 알아보기 어렵다.

## 포함 범위와 제외 범위

- 포함: 열린 탭 헤더·검색·선택·목록 행의 시각 위계, 도메인 표시, 탭 이동 affordance.
- 제외: 세션 저장, 새 필터, Chrome API 및 북마크 동작 변경, 상단 전역 내비게이션 변경.

## 변경할 파일과 구현 순서

1. `lib/tab-actions.ts`에 목록용 위치 라벨 변환을 추가하고 단위 테스트한다.
2. `components/OpenTabsPanel.tsx`를 전폭 검색 + 조건부 북마크 작업 바 + 평평한 목록으로 재구성한다.
3. 관련 테스트, 타입 검사, 빌드를 실행한다.
4. `docs/WorkLog.md`에 변경 및 검증 결과를 기록한다.

## 위험과 검증 방법

- 내부 Chrome URL과 파일 URL은 일반 호스트가 없으므로 별도 라벨 fallback이 필요하다.
- 체크 선택, 검색 결과 전체 선택, 북마크 생성, 탭 이동의 기존 이벤트 경로를 유지한다.
- `cd extension && pnpm test && pnpm compile && pnpm build`로 검증한다.

## 완료 조건

- 검색창이 전폭으로 보이고 비선택 상태에 비활성 북마크 버튼이 노출되지 않는다.
- 선택 시 북마크 작업만 나타나며 세션 저장 액션은 없다.
- 각 행에서 제목, 도메인·창 번호, 탭 이동 동작을 빠르게 구분할 수 있다.
- 관련 테스트, 타입 검사, 빌드가 통과하고 WorkLog가 갱신된다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

## 후속 — 타임라인·세션 목록과 시각 일관성 조정

**상태:** 구현 완료 (2026-08-12)

- 타임라인의 접이식 검색과 작은 sticky 헤더 패턴을 열린 탭에도 적용한다.
- 행 패딩, 제목 굵기, 파비콘 크기를 타임라인·세션 행과 같은 밀도로 낮춘다.
- 반복되는 탭 이동 아이콘은 평소 숨기고 hover/focus에서만 노출한다.
- 검색·선택·북마크·탭 이동 동작과 세션 저장 제외 범위는 유지한다.
- `OpenTabsPanel.tsx`, `OpenTabsView.tsx`만 구현 변경하고 공식 extension 검증을 재실행한다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

### 후속 — 검색 전개 방향 통일

**상태:** 구현 완료 (2026-08-12)

- 열린 탭 검색도 타임라인과 같이 목록 헤더 위에서 펼쳐지게 순서를 맞춘다.
- 탭 행의 `창 N` 메타는 제거하고 도메인만 표시한다.
- 검색·선택·북마크·탭 이동 동작은 변경하지 않는다.

**검증:** `pnpm test` 17개 파일 147개 통과 · `pnpm compile` 통과 · `pnpm build` 통과.
실제 Chrome 확장 재로드 후 시각 스모크는 미실시.

---

# 2단계 — 타임라인 개편 (같은 브랜치)

**상태:** 구현 완료 (2026-08-12) — 실제 브라우저 스모크 미실시

## 작업 목표

타임라인의 역할을 **브라우저 방문 기록의 대체**로 확정한다. "아까 본 거 뭐였지"를 즉시
되짚어 다시 들어가는 화면으로, 최근 48시간을 훑는 밀도를 최우선으로 한다.

## 현재 상태와 조사 결과

- 목록의 원천은 서버가 아니라 로컬 IndexedDB 큐(48시간 보관)다(`useTimeline.ts:56-60`).
  서버 조회는 세션 배지용이며 최대 3일치 캡(`:78`). **타임라인은 본질적으로 48시간 화면이다.**
- 하단 `이번 주 탐색 분석` 카드만 7일치를 보고 있어 화면 안에서 시간 범위가 어긋나 있었다.
- `SyncStatusCard` 가 opt-in 온보딩 / 수동 동기화 / 상태 표시 세 기능을 겸하고 있어,
  통째로 지우면 수집을 켜는 인라인 경로까지 사라진다.
- Ask 는 서버 데이터만 검색한다 — 방금 본 페이지(로컬 큐 `분류 대기`)는 검색 사각지대.

## 사용자 결정 사항 (확인 완료)

- 새로고침과 `지금 저장`을 상단 바 아이콘 하나로 통합한다.
- 미처리·마지막 동기화는 sticky 날짜 헤더 우측에 붙인다(상태 전용 카드 없음).
- 수집 안내는 조건부로 남긴다.
- 로컬 필터를 추가한다.
- 연속 같은 도메인 뭉치기는 이번에 하지 않는다(구현 난이도).
- `이번 주 탐색 분석` 카드는 제거한다.

## 제외 범위

- 도메인 뭉치기(보류).
- 타임라인을 48시간 너머로 넓히는 것 — 백엔드 기간 조회가 필요(미결정).
- 설정 화면(다음 섹션).

## 변경한 파일

| 파일 | 변경 |
| --- | --- |
| `views/TimelineView.tsx` | 카드 2개 제거, 필터 입력, 조건부 수집 안내 |
| `components/timeline/TimelineDateHeader.tsx` | sticky + 상태 슬롯 |
| `components/timeline/CollectionOptInNotice.tsx` | 신규 — opt-in 안내 (전체/한 줄) |
| `hooks/useTimeline.ts` | `filterTimelineEntries` 추가, `isFilteredOut` 구분 |
| `components/TopNavBar.tsx` | 새로고침 = 동기화 + 무효화 통합 |
| `components/SyncStatusCard.tsx` | 삭제 |
| `wxt.config.ts` | `modulePreload: false` — 확장 페이지 preload 경고 제거 |
| `tests/unit/timeline-filter.test.ts` | 신규 7건 |

## 완료 조건

- 상단 상태 카드와 하단 분석 카드가 없고, 첫 화면 목록 노출이 늘었다.
- 미처리·마지막 동기화가 맨 위 sticky 헤더에서 보인다.
- 상단 바 아이콘 하나로 동기화가 트리거된다.
- 필터가 아직 동기화되지 않은 기록까지 즉시 걸러낸다.
- 수집이 꺼져 있을 때 켜는 경로가 화면에 남아 있다.
- 테스트·타입 검사·빌드 통과.

---

# 세션 별칭(alias)과 네비게이터 정렬

**상태:** 구현 중 (2026-08-12)
**브랜치:** `feat/dashboard-design`

## 작업 목표

1. 세션 이름을 사용자가 바꿀 수 있게 하되, **내부 이름(`title`)은 그대로 두고 별칭(`alias`)에
   저장**한다. 사용자에게는 그냥 "이름 수정"으로 보인다.
2. 대시보드 네비게이터에 세션 이름 편집(별칭 지정) 기능을 넣는다.
3. 네비게이터에 **최신순 / 가나다순** 정렬을 넣는다.

## 현재 상태와 조사 결과

`PATCH /sessions/{id}` 는 지금 `session.title` 을 **덮어쓴다**(`api/sessions.py:313`).
`title` 은 사용자 편집 대상이 아닌 곳에서 이미 광범위하게 쓰인다.

| 위치 | 용도 | 이름이 바뀌면 |
| --- | --- | --- |
| `api/sessions.py:429` | `_embed_and_upsert(id, title, summary)` | Qdrant 벡터가 옛 제목 기준으로 남아 검색이 어긋난다 |
| `services/merge_service.py:67` | `_title_jaccard` 병합 게이팅 | 병합 판정이 사용자 작명에 좌우된다 |
| `services/merge_suggester.py:57` | 후보 토큰 겹침 | 위와 같음 |
| `services/session_updater.py:395` | 배치가 제목을 다시 만든다 | **사용자가 바꾼 이름이 덮인다** |
| `services/recommender/service.py:93` | 추천 신호 term 추출 | 추천 근거가 흔들린다 |

즉 사용자 요청대로 이름을 별도 항목으로 분리하는 것이 맞다.

편집 진입점은 이미 둘 있고 둘 다 `renameSession`(=title 덮어쓰기)을 부른다.

- `entrypoints/sidepanel/views/SessionDetailView.tsx:51`
- `entrypoints/newtab/components/atlas/AtlasDetail.tsx:53`

네비게이터(`AtlasNavigator.tsx`)에는 폴더 이름 편집만 있고 세션 편집이 없다.
정렬은 어디에도 없다 — `buildAtlasSessions` 가 활동 시각 내림차순으로 한 번 정렬할 뿐이다.

## 설계 결정

### 표시 이름은 서버가 합친다

응답의 `title` 은 **`alias or title`(표시 이름)** 이다. `alias` 는 편집창 초기값과
"되돌리기" 판단용으로 따로 내려보낸다. 클라이언트가 매 화면에서 합치면 한 곳이라도
빠지는 순간 같은 세션이 두 이름으로 보인다 — 사용자 요구("어디든 이름 수정처럼")를
지키려면 경계 한 곳에서 끝내야 한다.

내부 로직은 ORM 의 `session.title` 을 그대로 쓰므로 canonical 이 유지된다.

**의도적 예외**: Ask 프롬프트(`ask_service._session_block`)와 추천 리랭크 프롬프트는
`SessionDetail`/`SessionSignals` 를 거치므로 별칭을 본다. 사용자가 붙인 이름은 질의와
더 가까우므로 그대로 둔다 — 벡터·병합 점수처럼 저장된 값과 대조하는 경로가 아니다.

### 별칭 지우기

`alias` 에 `null` 또는 빈 문자열을 보내면 별칭을 지우고 원래 이름으로 돌아간다.

### 정렬

`sortSessions(sessions, mode)` 순수 함수. `recent`(활동 시각 내림차순, 기존 기본값)와
`title`(표시 이름 가나다순, `localeCompare(_, 'ko')`). 폴더 안 세션과 미정리 목록에
모두 적용한다. 폴더 자체 순서는 `position` 을 유지한다(사용자가 만든 순서).

상태는 `nav-state` 에 둔다 — 메인·아틀라스가 네비게이터를 공유한다.

## 변경할 파일

**backend**

| 파일 | 변경 |
| --- | --- |
| `app/db/models.py` | `Session.alias` 컬럼, `DISPLAY_TITLE` SQL 식 |
| `app/db/migrations.py` | `sessions.alias` additive 등록 |
| `app/schemas/session.py` | `PatchSessionRequest.alias`, `SessionDetail.alias` |
| `app/api/sessions.py` | `_to_detail` 표시 이름, `patch_session` 별칭 저장 |
| `app/api/analytics.py` | top 세션 표시 이름 |
| `app/api/events.py` | 타임라인 `session_title` 표시 이름 |
| `app/api/search.py` | 검색 결과 `session_title` 표시 이름 |
| `app/services/merge_suggester.py` | 병합 제안 표시 이름 (점수는 canonical 유지) |
| `app/services/recommender/service.py` | 추천 카드 표시 이름 |

**extension**

| 파일 | 변경 |
| --- | --- |
| `lib/types.ts` | `Session.alias` |
| `lib/api.ts` | `renameSession` → `setSessionAlias`, `mapSession` 에 alias |
| `entrypoints/sidepanel/hooks/useSessions.ts` | `useRenameSession` → 별칭 뮤테이션 |
| `entrypoints/sidepanel/views/SessionDetailView.tsx` | 호출부 |
| `entrypoints/newtab/components/atlas/AtlasDetail.tsx` | 호출부 |
| `entrypoints/newtab/components/atlas/data.ts` | `SessionNode.alias`, `sortSessions` |
| `entrypoints/newtab/lib/nav-state.ts` | `sessionSort` |
| `entrypoints/newtab/hooks/useFolders.ts` | 세션 별칭 뮤테이션 추가 |
| `entrypoints/newtab/components/atlas/AtlasNavigator.tsx` | 세션 편집 UI, 정렬 버튼 |
| `entrypoints/newtab/components/VariantAtlasReplica.tsx` | 정렬 상태 전달 |
| `entrypoints/newtab/styles/atlas.css` | 필요한 스타일 |

## 구현 순서

1. 백엔드 모델·마이그레이션·스키마 (계약 먼저)
2. 백엔드 응답 경계 표시 이름 적용
3. 백엔드 테스트
4. 익스텐션 타입·API 클라이언트
5. 기존 rename 호출부 2곳 전환
6. `sortSessions` + 네비게이터 UI
7. 익스텐션 테스트·타입·빌드

## 테스트 및 검증

- backend `pytest`:
  - `PATCH {alias}` 가 `title` 을 건드리지 않는다
  - 별칭이 있으면 목록·상세의 `title` 이 별칭이다
  - `alias: null`/빈 문자열이 별칭을 지운다
  - 100자 초과는 422
- extension `vitest`:
  - `sortSessions` 최신순/가나다순, 빈 목록, 동률
  - 별칭이 있는 세션의 `SessionNode` 매핑
- `pnpm compile`, `pnpm build`

## 위험

- **`session_updater` 가 배치마다 제목을 다시 만든다**(`:395`). 별칭은 별도 컬럼이라
  덮이지 않는다 — 이것이 별칭 분리의 핵심 이득이다.
- 기존 사용자가 예전 rename 으로 이미 `title` 을 바꿔 놓았을 수 있다. 그 값은 그대로
  두고 마이그레이션하지 않는다(되돌릴 원본이 없다).
- `updated_at` 은 `onupdate` 로 자동 갱신된다. 목록 정렬은
  `coalesce(last_activity_at, created_at)` 기준이라 순서는 흔들리지 않는다.

## 완료 조건

- 이름을 바꿔도 DB `sessions.title` 이 그대로다.
- 대시보드·사이드패널·검색·추천·타임라인 어디서나 바꾼 이름이 보인다.
- 네비게이터에서 세션 이름을 편집할 수 있다.
- 네비게이터 정렬이 최신순/가나다순으로 바뀐다.

---

## 2026-08-12 — 사이드패널 세션 분류 동작 위치·표현 정리

### 목표와 조사 결과

전역 상단의 수동 동기화 아이콘은 대상과 결과가 불명확하다. 타임라인 첫 sticky 날짜 헤더에는
이미 분류 대기 개수와 마지막 동기화 시각이 있으므로, 같은 문맥에 `세션 분류` 동작을 둔다.

### 범위

- 포함: 상단 바 동작 제거, 타임라인 첫 헤더의 조건부 `세션 분류` 버튼, 토스트와 IA·결정·작업 기록.
- 제외: `SYNC_NOW` 메시지와 동기화 엔진, 백엔드 세션화 계약 변경.

### 구현·검증

1. `TopNavBar`에서 수동 동기화 UI를 제거한다.
2. `TimelineView`가 기존 `triggerManualSync`를 호출하고 상태를 `TimelineDateHeader`에 전달한다.
3. 분류 대기가 있을 때만 `대기 N · 세션 분류`를 표시한다.
4. `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`를 실행한다.

### 위험과 완료 조건

- 메시지 응답은 분류 완료가 아니라 요청 접수이므로 토스트는 완료를 주장하지 않는다.
- 상단 바에는 설정만 남고, 타임라인에서 분류 대기와 실행 동작을 함께 확인할 수 있으면 완료다.

---

## 2026-08-12 — 새 탭·사이드패널 로그인 화면 통일

### 목표와 조사 결과

두 로그인 화면은 같은 인증 흐름을 쓰지만 새 탭은 빈 화면 중앙의 작은 묶음, 사이드패널은 별도
축소 레이아웃이라 제품 인상과 안내 문구가 다르다. 인증 로직은 유지하고 시각 구조와 카피만 맞춘다.

### 범위

- 포함: Orbit 마크, 제목·설명, Google CTA, 수집 선택 안내, 오류 상태의 공통 시각 규칙.
- 제외: 인증 API·권한·세션 저장 방식, 새 의존성, 새 이미지 자산.

### 구현·검증

1. 새 탭 로그인 화면을 표면 카드와 은은한 Orbit 배경 광원으로 정리한다.
2. 사이드패널은 같은 위계와 카피를 좁은 폭의 무경계 레이아웃으로 적용한다.
3. 기존 로고와 테마 토큰만 재사용하고 라이트·다크 모드를 함께 지원한다.
4. `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`를 실행한다.

### 위험과 완료 조건

- Google 버튼은 새 브랜드 자산을 임의 제작하지 않고 텍스트 `G` 표식만 사용한다.
- 두 화면에서 로그인 이유와 수집 선택권이 보이고, loading·error 상태가 유지되면 완료다.

---

## 2026-08-12 — 설치 후 온보딩 프로토타입

### 작업 목표와 조사 결과

확장 설치 직후 로그인부터 수집 opt-in, 핵심 기능 이해까지 이어지는 첫 실행 흐름을 만든다. 신규
사용자에게는 실데이터가 없고 `chrome.sidePanel.open()`은 사용자 제스처가 필요하므로, 로그인 후
별도 CTA로 패널을 열고 격리된 mock 데이터를 사용한다.

### 포함 범위와 제외 범위

- 포함: 최초 설치 안내 탭, 로그인 후 패널 시작 CTA, storage 상태, 7단계 spotlight, 충분한 mock
  타임라인·세션·열린 탭, Ask, 다음·건너뛰기·완료, 단계 재개.
- 제외: 백엔드 API·스키마, 실제 데이터 저장, 분석 이벤트, A/B 테스트, 기존 사용자 강제 노출,
  설정 기능 안내.

### 변경 파일과 구현 순서

- `lib/onboarding.ts`, `lib/useOnboarding.ts` — 상태 계약·저장·구독.
- `entrypoints/background.ts` — 최초 설치 탭 열기.
- `entrypoints/newtab/main.tsx`, `OnboardingLaunch.tsx` — 로그인 후 사용자 클릭으로 패널 열기.
- `entrypoints/sidepanel/App.tsx`, `components/onboarding/*` — mock 화면과 spotlight.
- `CollectionOptInNotice.tsx` — 실제 수집 설정 완료 콜백.
- `tests/unit/onboarding.test.ts` — 저장 상태와 설치 분기.

1. pending/touring/complete 상태 계약을 만든다.
2. 설치 시에만 안내 탭을 열고 로그인 후 CTA에서 touring 상태와 패널 열기를 요청한다.
3. `수집 → 타임라인 설명 → 세션 탭 직접 클릭 → 세션 설명 → 열린 탭 직접 클릭 → 열린 탭 설명
   → Ask` 순서로 구성한다.
4. 타임라인 10개, 세션 6개, 열린 탭 8개를 채우고 실제 행 형식을 재사용한다.
5. 수집·세션·열린 탭 단계의 실제 대상만 포인터 입력을 허용하며, 안내 카드는 강조 영역과 겹치지
   않게 배치한다.
6. 테스트·타입 검사·빌드·Playwright MCP 시각 검증 후 문서를 갱신한다.

### 검증, 위험과 완료 조건

- `pnpm.cmd test`, `pnpm.cmd compile`, `pnpm.cmd build`, `git diff --check`.
- 461×799 다크 모드 전체 7단계와 320×700·461×767 첫 단계에서 가림·잘림·직접 클릭을 확인한다.
- 패널 열기 실패 시 툴바 아이콘으로 계속할 수 있음을 안내한다.
- mock은 실제 저장·API 호출을 하지 않고, 건너뛰기는 수집을 임의로 켜지 않는다.
- 사용자가 세션·열린 탭을 직접 눌러야 화면이 전환되고 저장 단계로 정상 재개되면 완료다.
---

## 2026-08-12 — 새 탭 검색창 최근 검색 기록

**브랜치:** `feat/search-history`

### 작업 목표

새 탭 히어로 검색창에 커서가 들어가면 크롬·구글 새 탭처럼 최근 검색 기록 드롭다운이 뜨고,
항목을 고르면 바로 그 검색어로 검색이 실행되게 한다.

### 현재 상태와 조사 결과

- 검색 실행은 `OrbitHero.handleSubmit`이 담당한다. `parseOmniboxInput`으로 주소/검색어를
  가른 뒤 주소면 `window.location.assign`, 검색어면 `chrome.search.query`로 넘긴다.
- 검색어를 어디에도 남기지 않으므로 최근 기록의 원천이 없다.
- 확장에 `history` 권한이 없고, 이미지의 구글 드롭다운은 구글 계정 검색 기록이라 확장이
  그대로 읽을 수 없다.
- 바로가기(`newtab/lib/shortcuts.ts`)가 `chrome.storage.local` + 순수 로직 분리라는
  같은 계열의 선례를 이미 갖고 있다.

### 사용자 결정 사항 (확인 완료)

- 데이터 출처는 **Orbit 검색창에서 실행한 검색어만** 로컬에 저장한다. `history` 권한을
  추가하지 않는다.
- 드롭다운 항목을 고르면 **바로 검색을 실행**한다.

### 포함 범위

- 검색 모드에서 실행한 검색어를 `chrome.storage.local`에 최근순으로 저장 (상한 10개)
- 검색창 포커스 시 드롭다운 표시, 입력값이 있으면 그 값으로 필터
- 클릭/Enter로 즉시 검색, ↑↓ 이동, Esc·바깥 클릭으로 닫기
- 항목별 삭제

### 제외 범위

- `history` 권한과 브라우저 방문 기록 파싱
- 검색어 자동완성(외부 suggest API 호출)
- AI 모드 질문 기록
- 백엔드 저장·동기화

### 변경할 파일 또는 모듈

- `entrypoints/newtab/lib/search-history.ts` — 순수 로직과 저장소 (신규)
- `entrypoints/newtab/components/sections/SearchHistoryDropdown.tsx` — 드롭다운 (신규)
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 포커스·키보드·검색 실행 연결
- `entrypoints/newtab/styles/index.css` — 드롭다운 스타일
- `tests/unit/search-history.test.ts` — 순수 로직과 저장소 (신규)

### 구현 순서

1. 저장 형식과 순수 로직(추가·중복 승격·상한·필터)을 먼저 만들고 테스트한다.
2. 드롭다운 컴포넌트를 만든다.
3. `OrbitHero`의 검색 실행 경로에서 기록을 남기고 드롭다운을 배선한다.
4. 스타일을 추가한다.
5. `pnpm test`, `pnpm compile`, `pnpm build`를 실행한다.

### 테스트 및 검증

- 중복 검색어는 새로 쌓지 않고 맨 위로 올라간다.
- 상한을 넘으면 가장 오래된 항목이 밀려난다.
- 빈 문자열·공백만 입력은 기록하지 않는다.
- 필터는 대소문자를 구분하지 않는다.
- 저장소 읽기·쓰기 실패가 검색 자체를 막지 않는다.

### 위험과 완료 조건

- 기록은 로컬에만 남기며 동기화하지 않는다. 삭제 수단을 함께 제공한다.
- 주소로 해석되는 입력(`github.com`)은 검색어가 아니므로 기록하지 않는다.
- 드롭다운이 바로가기 영역을 밀어내지 않도록 절대 배치한다.
- 포커스 시 목록이 뜨고 선택 시 검색이 실행되며 검증 명령이 모두 통과하면 완료다.

---

# 2026-08-12 — 실 Backend·실 LLM Playwright 데모 영상

## 작업 목표

실제 Orbit 확장, Backend, PostgreSQL/Qdrant, LLM을 사용해 하나의 탐색이 자동으로 세션이 되고,
사이드패널과 새 탭 홈·Atlas에서 다시 발견·복원되는 과정을 90~120초 제품 데모 영상으로 만든다.
데모용 API 응답, UI mock, DB 직접 주입은 사용하지 않는다.

## 현재 상태와 조사 결과

- 저장소에는 Playwright로 빌드 확장을 로드해 실제 Backend·LLM까지 검증한 이력이 있지만,
  당시 스크립트는 스크래치패드에만 있었고 재사용 가능한 촬영 스크립트는 없다.
- 사이드패널은 `타임라인 / 세션 / 열린 탭`과 하단 Ask 독으로 구성되고, 새 탭 홈은 최근 탐색,
  이어서 탐색하기, 추천 세션, AI 질문, Atlas 진입을 제공한다.
- 새 탭 Atlas는 세션의 페이지와 탐색 순서를 궤도·타임라인·상세 패널로 보여주므로
  사이드패널에서 만들어진 세션이 메인 대시보드로 이어지는 장면에 적합하다.
- Extension에는 Playwright 실행 의존성이 없고 이 머신에는 `ffmpeg`가 설치되어 있지 않다.
- 현재 작업 트리의 `OrbitHero.tsx`, `newtab/styles/index.css` 변경과 `.playwright-mcp/`,
  `docs/orbit-logic.html`, `fig-map.png`, `top.png` 미추적 파일은 사용자 작업이므로 데모 작업에서
  덮어쓰거나 되돌리지 않는다.

## 사용자 결정 사항 (확인 완료)

- 브라우저 자동 조작은 Playwright를 사용한다.
- 실제 Backend와 실제 LLM 호출을 사용한다. 해당 제품 흐름에서 발생하는 LLM 비용을 허용한다.
- 사이드패널과 메인 대시보드(새 탭 홈 및 Atlas)를 모두 영상에 포함한다.
- `backend/eval/` 평가 하네스는 실행하지 않는다.

## 데모 전제와 기본 연출

- 전용 Chrome 프로필과 전용 데모 계정을 사용해 기존 기록·개인정보를 영상에 노출하지 않는다.
  기존 계정 데이터를 자동 삭제하거나 수정하지 않는다.
- 기본 이야기 소재는 **“오사카 3박 4일 여행 준비”**로 한다. 로그인·CAPTCHA가 없고 제목·본문이
  안정적인 공개 페이지 4개를 골라 교통, 숙소 지역, 관광지, 일정 탐색 흐름을 만든다.
- 한국어 자막, 다크 테마, 1920×1080, 30fps, 최종 길이 90~120초를 기본값으로 둔다.
  내레이션과 배경음악은 첫 버전에서 제외한다.
- LLM 대기 시간은 숨기지 않고 로딩 상태를 1~2초 보여준 뒤 점프 컷으로 줄인다.

## 스토리보드

1. **0~8초 — 문제와 시작**
   - 일반 Chrome 페이지와 오른쪽 Orbit 사이드패널을 함께 보여준다.
   - “찾아본 페이지가 아니라, 찾아간 흐름을 기억합니다” 자막으로 시작한다.
2. **8~28초 — 실제 탐색과 상시 수집**
   - 여행 관련 공개 페이지 4개를 순서대로 방문하고 각 페이지에서 4~8초 머문다.
   - 사이드패널 타임라인에 실제 방문 이벤트가 `분류 대기`로 쌓이는 모습을 동시에 보여준다.
3. **28~45초 — 실 LLM 자동 세션화**
   - 타임라인의 `세션 분류`를 누르고 실제 `/sync` 파이프라인을 실행한다.
   - 로딩 상태를 짧게 보여준 뒤 `세션` 탭에서 새로 만들어진 세션을 펼쳐 실제 AI 제목·요약과
     방문 시각순 페이지 목록을 보여준다.
4. **45~65초 — 메인 대시보드로 연결**
   - 새 탭 홈을 전체 화면으로 전환한다.
   - 방금 생성된 세션이 `최근 탐색`과 `이어서 탐색하기`에 나타난 것을 보여준다.
5. **65~82초 — Atlas에서 탐색 경로 확인**
   - 해당 세션의 `상세 보기`를 눌러 Atlas로 이동한다.
   - 궤도의 페이지 순서, 탐색 인사이트, AI 요약을 차례로 강조한다.
6. **82~105초 — 목적 중심으로 다시 찾기**
   - 새 탭 홈의 AI 모드에서 “오사카 여행 준비하면서 찾아본 자료 다시 보여줘”를 입력한다.
   - 실제 Ask 응답과 관련 세션을 보여주고 세션으로 다시 이동한다.
7. **105~120초 — 작업 복원과 엔딩**
   - `세션 복원`으로 관련 페이지가 다시 열리는 것을 보여준다.
   - “탭을 정리하는 것이 아니라, 탐색 흐름을 기억한다. Orbit.”으로 끝낸다.

## 포함 범위

- 공식 명령으로 Backend·인프라·Extension을 실제 기동하고 상태를 확인한다.
- Playwright persistent context에 빌드 확장을 로드하고 전용 프로필의 실제 로그인 세션을 재사용한다.
- 실제 공개 페이지 방문 → 로컬 큐 → `/sync` → 세션화 → Ask → 복원 흐름을 실행한다.
- 실제 `sidepanel.html`을 461×799 target으로 동시에 녹화하고, 탐색 페이지 영상 오른쪽에 합성한다.
  새 탭 홈과 Atlas는 1920×1080 전체 화면 장면으로 전환한다.
- 자연스러운 커서 이동, 35~65ms 타이핑 간격, 클릭 전후 300~800ms 정지를 적용한다.
- 원본 WebM과 최종 MP4를 로컬 산출물로 남긴다.

## 제외 범위

- 온보딩, 설정, 병합, 북마크, 오류 상태 등 핵심 이야기와 무관한 기능 투어
- API 응답 가로채기, fixture 데이터, DB 직접 seed, LLM 응답 수정
- 기존 사용자 데이터 삭제와 운영 환경 배포
- 음성 내레이션, 배경음악, 다국어 버전
- 제품 UI에 데모 전용 플래그·라우트·컴포넌트 추가

## 변경할 파일 또는 모듈

- `extension/scripts/demo-live.mjs` — 브라우저 조작, 상태 대기, 원본 클립 녹화, ffmpeg 합성
- `extension/package.json`, `extension/pnpm-lock.yaml` — Playwright 개발 의존성과 `demo:record` 명령
- `.gitignore` — 민감한 브라우저 프로필과 대용량 영상 산출물이 커밋되지 않게 제외
- `docs/Plan.md`, `docs/WorkLog.md` — 계획과 실행·오류·검증 이력

제품 화면·Backend 코드는 데모 중 발견된 실제 결함을 사용자가 별도 승인하지 않는 한 수정하지 않는다.

## 구현 순서

1. 큰 변경이므로 `chore/live-demo-video` 브랜치를 만들되 현재 사용자 변경을 보존한다.
2. API 키 값을 출력하지 않고 `.env` 존재, Docker/PostgreSQL/Qdrant, Backend health, 확장 빌드를
   사전 점검한다.
3. Playwright와 녹화·합성용 portable ffmpeg를 준비한다. ffmpeg는 저장소 밖 도구 캐시에 두고
   실행 파일과 바이너리를 커밋하지 않는다.
4. 전용 Chrome 프로필을 저장소 밖에 만들고 사용자가 최초 Google 로그인을 한 번 완료한다.
5. 녹화 없이 전체 제품 흐름을 한 번 드라이런한다. 새 세션은 AI 제목 문자열이 아니라 이번 방문 URL과
   가장 최근 활동 시각으로 식별한다.
6. 사이드패널과 탐색 페이지를 동시에 녹화하고, 이어서 새 탭 홈·Atlas·Ask·복원 장면을 녹화한다.
7. Playwright 원본 클립을 ffmpeg로 합성하고 자막·점프 컷·페이드만 최소 적용한다.
8. 최종 영상을 검토하고 공식 검증 명령과 문서 기록을 완료한다.

## 테스트 및 검증

- 드라이런에서 실제 방문 이벤트 4건 이상이 로컬 타임라인에 나타난다.
- 수동 분류 후 실제 Backend `sync`가 성공하고 새 세션이 생성되거나 관련 세션에 추가된다.
- 사이드패널 세션 행에서 실제 AI 요약과 방문 페이지가 표시된다.
- 새 탭 홈에서 같은 세션이 최근 탐색에 표시되고 Atlas에 실제 이벤트 순서가 나타난다.
- Ask가 동일 세션을 관련 근거로 반환하고 세션 복원이 실제 탭을 연다.
- 정확한 AI 제목·문장에는 의존하지 않고 로딩·실패·타임아웃을 구분한다.
- `cd extension && pnpm test && pnpm compile && pnpm build`
- `cd backend && python -m pytest -p no:asyncio`
- `git diff --check`
- `ffprobe`로 최종 MP4의 1920×1080, 30fps, 재생 시간, 정상 종료를 확인하고 처음부터 끝까지
  실제 재생해 개인정보·알림·비밀값 노출이 없는지 검토한다.

## 위험과 대응

- **LLM 결과 변동:** 제목 문구에 기대지 않고 최신 세션과 방문 URL로 추적한다. 분류가 갈리면
  공개 페이지 구성을 조정해 한 번만 다시 촬영하며 응답을 조작하지 않는다.
- **외부 페이지 변동:** 로그인·CAPTCHA·자동 재생·쿠키 팝업이 없는 정적 페이지를 사전 확인한다.
- **LLM 지연과 비용:** 호출을 순차 처리하고 드라이런 1회 + 본 촬영 1회를 기본 상한으로 둔다.
- **개인정보 노출:** 전용 프로필·계정만 사용하고 OS 전체 화면이 아니라 Playwright page video를
  합성한다. 토큰, `.env`, 개발자 도구, 개인 알림은 영상에 포함하지 않는다.
- **사이드패널 합성:** 실제 `sidepanel.html`과 동일한 프로필·Backend를 사용하지만 Chrome 외곽 UI는
  녹화하지 않는다. 실제 Chrome 사이드패널 컨테이너까지 필요하면 수동으로 패널을 연 뒤 OS 창 캡처가
  필요하므로 별도 촬영 방식으로 전환한다.
- **기존 작업 충돌:** 현재 수정 중인 `OrbitHero.tsx`와 `index.css`를 덮어쓰지 않고, 구현 전 diff를
  다시 확인한다.

## 완료 조건

- 실제 Backend·LLM으로 생성된 동일 세션이 사이드패널, 새 탭 홈, Atlas, Ask, 복원 장면에 이어진다.
- 최종 MP4가 90~120초 안에서 제품의 `기록 → 자동 세션화 → 재발견 → 복원` 이야기를 전달한다.
- fixture·mock·DB 직접 주입 없이 두 화면이 실제 데이터로 동작한다.
- 관련 테스트·빌드·영상 검증이 통과하고 `docs/WorkLog.md`에 비용 발생 호출, 오류, 재촬영 횟수,
  검증 결과를 기록한다.

---

## 2026-08-12 — 온보딩 완료 후 홈 복귀, 최근 검색 기록 드롭다운 정렬

**브랜치:** `main`

### 작업 목표

1. 온보딩 투어가 끝난 뒤 안내 탭이 멈춰 있지 않고 새 탭 홈으로 돌아가게 한다.
2. 최근 검색 기록 드롭다운이 검색창 바로 아래에 구글 새 탭처럼 이어 붙어 열리게 한다.

### 현재 상태와 조사 결과

- 사이드패널 투어의 `완료`·`건너뛰기`는 `completeOnboarding()`으로 `orbit:onboarding`을
  `complete`로 저장하기만 한다(`OnboardingPrototype.tsx:497,507`).
- 안내 탭(`newtab.html?onboarding=1`)의 `OnboardingLaunch`는 그 변화를 구독하지 않아
  `사이드패널에서 계속하세요` 상태로 남는다. 첫 실행이 화면 없이 끊긴다.
- `main.tsx:25`의 `onboarding` 플래그는 매 렌더 `window.location.search`를 다시 읽으므로,
  쿼리를 지우고 popstate 를 알리면 안내 화면에서 벗어난다.
- 드롭다운은 `position: absolute` 기준이 `.search-container`였는데 이 컨테이너가 검색창과
  바로가기를 함께 감싸고 있어 `top: 100%`가 바로가기 아래를 가리켰다.

### 포함 범위

- `replaceWithHome()` — `onboarding=1` 쿼리를 지우고 히스토리를 덮어쓴다
- `OnboardingLaunch`가 온보딩 상태를 구독해 `complete`가 되면 홈으로 돌아간다
- `main.tsx`가 안내 탭 여부를 상태로 들고 popstate 에서 갱신한다(홈은 라우트가 안 바뀌어
  리렌더가 일어나지 않는다)
- 드롭다운 기준을 검색창만 감싼 `form`으로 바꾸고, 열린 동안 입력창과 한 판으로 잇는다

### 제외 범위

- 온보딩 단계·문구·mock 데이터 변경
- 안내 탭이 이미 닫힌 경우 새 탭을 다시 열어 주기
- 신규 사용자의 빈 홈 화면(최근 탐색·추천 없음) 자체를 손보기

### 변경할 파일

- `entrypoints/newtab/lib/navigation.ts` — `replaceWithHome()`, `isOnboardingLaunch()`
- `entrypoints/newtab/main.tsx` — 안내 탭 여부를 상태로 관리
- `entrypoints/newtab/components/sections/OnboardingLaunch.tsx` — 완료 감지와 이동
- `entrypoints/newtab/styles/index.css` — `.search-container > form`, `.search-shell--with-history`
- `entrypoints/newtab/components/sections/OrbitHero.tsx` — 열림 상태 클래스

### 테스트 및 검증

- `pnpm test`, `pnpm compile`, `pnpm build`
- 실제 브라우저: 설치 → 로그인 → 사이드패널 투어 완료 → 안내 탭이 홈으로 바뀌는지
- 뒤로가기로 안내 화면에 돌아가지 않는지(replaceState)

### 위험과 완료 조건

- 온보딩을 이미 끝낸 사용자가 `?onboarding=1`을 직접 열면 즉시 홈으로 넘어간다(의도된 동작).
- 안내 탭이 닫혀 있으면 이동 대상이 없어 아무 일도 일어나지 않는다. 알려진 한계로 남긴다.
- 투어 완료 직후 안내 탭이 홈으로 바뀌고 드롭다운이 검색창에 붙어 열리면 완료다.
