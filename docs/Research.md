# Orbit 기술 조사

검증된 사실, 프로젝트 내 실측 결과, 추가 확인이 필요한 가설을 구분해 기록한다.

## 현재 채택 기술

| 영역 | 선택 | 현재 근거 |
|---|---|---|
| Chrome Extension | WXT + React + MV3 | 사이드패널과 콘텐츠 추출 구현 완료 |
| Backend | FastAPI + async SQLAlchemy | 비동기 API와 PostgreSQL 연동 구현 완료 |
| 세션 검색 | Upstage 비대칭 임베딩 + Qdrant | 자연어 벡터 검색 구현 완료 |
| 배치 의도 분석 | K-EXAONE primary, A.X-K1 fallback | 품질 대등·노이즈 제외 우세, 429는 즉시 폴백으로 흡수 |
| 탭 클러스터링 | K-EXAONE primary, A.X-K1 fallback | 소표본 제목/URL 분류 실측에서 임베딩 방식보다 적합 |
| 요약·리랭킹 | A.X-K1 primary, K-EXAONE fallback | 한국어 요약 우세, 상호 폴백으로 공급자 장애 대응 |
| 상태 관리 | TanStack Query + Zustand | 서버 상태와 로컬 UI 상태 분리 |

## 프로젝트 내 실측 결과

### Ask AI 통합 의도·실데이터 이벤트 랭킹 평가 (2026-08-07)

- 숫자 ID만 사용한 UTF-8 골든셋 42개를 실제 Upstage `embedding-query`/
  `embedding-passage`로 평가했다.
- 구성: 탭 이동 8, 세션 찾기 8, 특정 세션 내용 검색 8, 전체 기록 내용 검색 및 이동 음성 18.
- 최초 결과는 30/36이었다. “세션 내부에서 찾아줘”가 세션 자체 찾기로 먼저 판별되고,
  “기록을 바탕으로”가 세션 위치 요청으로 분류되는 결과 형태 우선순위 문제를 수정했다.
- 이동 설명·장애 질문과 페이지 내용 질문 6개를 추가한 중간 평가에서 이동 오탐 3개를 발견했다.
  실행 요청과 기능 설명/저장 내용 질문을 분리한 뒤 최종 42/42, 이동 오탐 0건을 기록했다.
- 현재 DB의 active session 이벤트를 최대 500개 읽고 세션별 relevance 상위 12개로 제한한 뒤,
  실제 `search_query` 또는 페이지 제목 20개를 probe로 평가했다. 기대 이벤트 hit@1은 17/20,
  hit@3는 20/20이었다. 원문 query·title·URL은 평가 출력에 남기지 않았다.
- 실제 HTTP에서 네 의도 응답을 확인했고, 저장된 세션을 사용한 `search_memory` SSE가
  sources 1회, delta 33회, done 1회, error 0회와 실제 완료 모델을 반환했다.

### 자연어 열린 탭 resolver 실제 API 평가 (2026-08-07)

- Upstage `embedding-query`/`embedding-passage` 실제 API를 사용해 대표 열린 탭 11개와
  자연어 21개(이동 11, 일반 질문·요약·새 검색·후보 없음 10)를 평가했다.
- 최초 실험은 PowerShell→Python stdin 한글 손실과 의미가 노출된 case ID 문제로 결과가 오염되어
  폐기했다. UTF-8 강제와 숫자 ID로 재실행했다.
- 최종 설정 `intent floor=0.14`, `intent margin=0.02`, `match floor=0.20`,
  `match margin=0.06`에서 이동 10/11, 안전 차단 10/10, 전체 20/21이었다.
- 유일한 실패는 `Orbit`↔`오빗` 표현에서 정답 GitHub 탭이 top-1이지만 top-2 격차가 0.021로
  자동 이동을 보류한 경우다. margin을 낮추면 후보에 없는 “음악 사이트” 요청을 YouTube로
  잘못 이동할 위험이 있어 안전 차단을 우선했다.
- LLM 구조화 resolver도 실제 호출했지만 단일 후보 요청에서 간접 표현 누락과
  오선택이 관찰되어 주 경로로 채택하지 않았다.
- 실제 HTTP smoke에서 영상 이동 문장이 YouTube 후보를 `score=0.397971`, `margin=0.212456`로 선택했다.

관련 공식 자료: [Upstage Embedding 2 제품 설명](https://aws.amazon.com/marketplace/pp/prodview-dm6frbhyivjeu)은
query/passage 전용 인코딩과 한국어·영어 다국어 검색을 안내하며,
[Upstage API 가격](https://www.upstage.ai/ko/pricing/api)은 Embed 2를 후속 제품으로 표시한다.

### Chrome 열린 탭 이동과 기본 북마크 API (2026-08-07)

- 출처: Chrome for Developers `chrome.tabs`, `chrome.windows`, `chrome.bookmarks`, 권한 목록.
- `tabs.update({active:true})`는 탭을 활성화하지만 창 자체를 포커스하지 않으므로
  다른 창의 탭으로 이동하려면 `windows.update({focused:true})`를 함께 사용해야 한다.
- 탭 제목·URL·파비콘을 전체 조회하는 데는 기존 `tabs` 권한을 사용한다.
- `chrome.bookmarks` API에는 manifest의 `bookmarks` 권한이 필요하고,
  해당 권한은 “북마크 읽기 및 변경” 설치 경고를 표시한다.
- `bookmarks.create()`의 `parentId`를 생략하면 Chrome ‘기타 북마크’ 폴더가 기본값이다.
- 채택: 열린 탭 찾기·이동은 Chrome 실행을 extension 로컬에서 담당한다. 명시적인 탭 이름은
  로컬에서 먼저 정확 매칭하고, `아까 보던 영상으로 돌아가자` 같은 간접 표현은 backend의 의미
  resolver로 의도와 후보를 판별한다. 낮은 신뢰도에서는 실행하지 않고 일반 질문은 기존 백엔드
  스트리밍 경로를 유지한다. 북마크는 사용자가 수동 도구에서 선택한 항목만 생성한다.

### 임베딩 기반 탭 클러스터링

- 짧은 탭 제목과 URL은 의미 정보가 적고 노이즈가 크다.
- 탭 수십 개 규모에서는 밀도 기반 클러스터링이 파라미터에 민감했다.
- 그룹 이름 생성을 위해 LLM 호출이 별도로 필요했다.
- 현재 결정은 LLM 클러스터링 유지이며, 임베딩은 세션 검색에 사용한다.

### 비대칭 임베딩

- 저장되는 세션 요약은 passage 성격이다.
- 사용자 검색어는 query 성격이다.
- 현재 구현은 저장에 passage 모델, 검색에 query 모델을 사용한다.

## 추가 조사 필요

### Chrome 행동 메타데이터

- `groupId`, `openerTabId`, `lastAccessed`가 실제 분류 품질을 얼마나 높이는지 골든셋으로 평가해야 한다.
- 탭 그룹 제목을 사용하려면 `chrome.tabGroups` API와 추가 권한의 필요성을 확인해야 한다.
- 현재 창만 수집할 경우 `windowId`는 분류 신호가 되지 않는다.

### 검색 품질

- Qdrant score threshold의 적절한 값은 실제 저장 세션과 검색어로 측정해야 한다.
- 리랭킹 사용 시 지연과 순위 개선 정도를 함께 기록해야 한다.
- 존재하지 않는 주제 검색에서 무관한 결과가 반환되지 않는지 확인해야 한다.

### 개인정보와 보관

- 페이지 본문을 요약 완료 후 삭제할지, 제한 기간 보관할지 결정이 필요하다.
- 민감 도메인 목록은 실제 hostname과 자동 테스트로 검증해야 한다.
- 외부 배포 전 CORS, 인증, 전송 구간 보안을 별도로 조사해야 한다.

## 조사 기록 형식

- 날짜:
- 질문:
- 출처 또는 실험 환경:
- 결과:
- 한계:
- 채택 여부와 후속 작업:
