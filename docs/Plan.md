# AI 챗 대화 URL 정규화 + 노이즈 필터 보강 + 오염 세션 재세션화

**상태:** ①③ 완료 (2026-08-05) — 대화 파편화·진입화면 노이즈 해소 검증. 별개 문제(LLM 주제 뭉침) 발견해 결정 대기.
**브랜치:** `fix/dogfood-session-recency`

> 직전 계획(노이즈 사전 필터)은 완료·커밋됨(b05cbaa).

## 작업 목표

도그푸딩 2차 피드백 — 세션에 이질 주제가 뒤섞이는 문제의 근본 원인(AI 챗 SPA 파편화)을
수정한다. 사용자 승인 범위: ①+③ 구현 후 오염 세션 재세션화. ②(과도기 제목)는 별도.

## 조사 결과 (근본 원인)

- `chatgpt.com/c/<id>` 대화 하나가 최대 5~6개 이벤트로 수집됨(SPA nav). `?messageId=` 등
  쿼리 차이로 normalized_url이 갈라져 dedup이 못 합침.
- 같은 대화가 여러 세션(항공권/여름음악/미배정)으로 파편화됨.
- 노이즈 필터의 "도메인 반복" 구제 조건이 `chatgpt.com/`(진입 화면)을 살려버림 —
  AI 챗은 도메인 반복이 흔해서 구제가 역효과.

## 포함 범위

1. **① normalize_url 강화** — AI 챗 도메인(chatgpt.com, chat.openai.com, claude.ai,
   gemini.google.com)은 query를 통째로 제거해 같은 대화(`/c/<id>`, `/chat/<id>`)를
   한 URL로 접는다. → 배치 내 dedup이 대화 단위로 병합.
2. **③ 노이즈 필터 보강** — AI 챗 진입 화면(대화 id 없는 루트·`/new`)을 "확정 노이즈"로
   판정하되 도메인 반복 구제보다 우선 적용(검색어·체류 미측정 구제는 유지).
3. **재세션화** — 오염 세션 4개(가비아 snapshot 제외)의 이벤트를 pending 복귀,
   세션·session_events·versions 삭제, 기존 이벤트 normalized_url 재계산 후 수동 sync
   한 배치로 재구성.

## 제외 범위

- ② 과도기 제목("ChatGPT"/"New chat" → 확정 제목 대체) — 수집기 타이밍 이슈, 별도 조사.
- collector.ts 변경(정규화는 서버 전용이라 불필요).

## 변경할 파일

- `backend/app/services/event_filter.py` — AI_CHAT_HOSTS 상수, normalize_url 분기
- `backend/app/services/noise_filter.py` — AI 챗 진입 화면 규칙(구제 우선순위 조정)
- `backend/tests/test_event_filter.py`, `test_noise_filter.py` — 케이스 추가

## 테스트 및 검증

- 단위: chatgpt/claude URL 정규화(쿼리 제거, 대화 id 보존), 진입 화면 노이즈 판정
- backend pytest 전체 / extension·frontend 무영향(서버 전용)이나 확인 위해 빌드
- 골든셋 평가 1회(회귀 확인)
- 재세션화 후 라이브 확인: 대화가 파편화 없이 주제별로 묶이는지

## 위험

- normalize 변경으로 기존 이벤트 재계산 필요 — 재세션화 스크립트에 포함.
- AI 챗 도메인 목록 하드코딩 — 신규 서비스는 추가 필요(설정 분리는 후순위).

## 완료 조건

- 같은 대화가 하나의 이벤트로 dedup되어 한 세션에만 들어간다.
- chatgpt.com/·claude.ai/new 진입 화면이 discard된다.
- 오염 세션이 주제별로 재구성된다.
- 문서(DecisionLog·WorkLog) 갱신.
