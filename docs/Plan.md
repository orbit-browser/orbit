# Extension newtab 백엔드 연결

**상태:** 완료 (후속 페이지 궤도 분할 포함, 2026-08-07)
**브랜치:** `feat/merge-in-sidepanel`

## 작업 목표

1. extension 새 탭 홈과 Orbit Atlas의 `ATLAS_ORBITS` 목업 의존성을 제거한다.
2. 기존 백엔드 세션·이벤트 API로 홈 카드, 네비게이터, Atlas 캔버스와 상세 정보를 구성한다.
3. 홈의 AI 질문 모드를 실제 Memory 검색 API에 연결한다.

## 현재 상태와 조사 결과

- 새 탭의 홈, 네비게이터, Atlas가 `components/atlas/data.ts`의 정적 `ATLAS_ORBITS`를 직접 참조한다.
- extension 공용 API 계층에는 `fetchSessions`, `fetchSessionEvents`, `searchMemory`가 이미 구현돼 있다.
- 백엔드에는 Session과 Event는 있지만 Orbit 엔티티나 Session-Orbit 관계는 없다.
- 사용자 결정에 따라 현재 단계에서는 별도 Orbit 그룹을 만들지 않는다. 백엔드 Session 하나가 Atlas 중심 노드 하나이며, 해당 Event/Page를 시간 순서대로 하나의 궤도에 배치한다.
- 세션 이벤트가 있으면 시간 순서를 유지하면서 이벤트별 체류 시간과 같은 URL의 총 방문 횟수를 표시하고, 이벤트가 없는 snapshot 세션은 탭 목록으로 보완할 수 있다.
- 기존 홈 카드와 상세 패널은 빈 배열을 전제로 하지 않아 loading, error, empty 상태와 페이지 없는 세션 처리가 필요하다.

## 포함 범위

- React Query 기반 새 탭 데이터 조회 훅
- Session/Event 응답을 Session/Page Atlas 뷰 모델로 바꾸는 순수 변환 계층
- 실제 세션 기반 홈 최근·진행·추천 카드
- 실제 세션 기반 2단계(세션 → 페이지) 네비게이터, Atlas 캔버스, 트레이, 상세 패널
- Memory 검색 결과를 실제 Atlas 세션 선택으로 연결
- loading, error, empty 및 이벤트/페이지 없는 세션 처리
- 변환 로직 단위 테스트
- mock 안내가 남은 현재 구조 문서 갱신

## 제외 범위

- 백엔드 Orbit 모델, 분류 저장 스키마 및 신규 API
- Orbit → Session → Page 3단계 정보 구조
- LLM을 이용한 주제별 Orbit 자동 분류
- 기존 Atlas 상세 패널의 미구현 편집·공유·내보내기 액션 구현
- 백엔드 세션화·검색 로직 변경
- 이전 작업에서 보존한 ignored `frontend/` 로컬 산출물 삭제

## 변경할 파일 또는 모듈

- `extension/entrypoints/newtab/components/atlas/data.ts`
- `extension/entrypoints/newtab/hooks/useAtlasData.ts`
- `extension/entrypoints/newtab/main.tsx`, `App.tsx`
- `extension/entrypoints/newtab/components/VariantAtlasReplica.tsx`
- `extension/entrypoints/newtab/components/layout/NavigatorDrawer.tsx`
- `extension/entrypoints/newtab/components/sections/`
- `extension/entrypoints/newtab/components/atlas/AtlasDetail.tsx`
- `extension/entrypoints/newtab/styles/`
- `extension/tests/unit/atlas-data.test.ts`
- `README.md`, `docs/IA.md`, `docs/DecisionLog.md`, `docs/WorkLog.md`

## 구현 순서

1. mock 상수를 제거하고 실제 Session/Event를 2단계 뷰 모델로 변환하는 계약과 순수 함수를 만든다.
2. React Query 훅과 새 탭 QueryClientProvider를 연결한다.
3. 홈과 네비게이터가 조회 결과 및 loading/error/empty 상태를 사용하게 한다.
4. Atlas 중심 노드를 세션명으로 표시하고 페이지를 `sequenceOrder` 순서로 한 궤도에 배치한다.
5. AI 질문을 Memory 검색으로 연결하고 결과 없음·실패 상태를 표시한다.
6. 변환 단위 테스트와 extension 전체 검증을 수행한다.
7. 결정 기록, 작업 이력, 현재 구조 문서를 실제 구현에 맞춘다.

## 테스트 및 검증

```bash
cd extension && pnpm test && pnpm compile && pnpm build
```

- 이벤트의 시간 순서와 같은 URL의 방문 횟수 계산 검증
- 이벤트 없는 세션의 탭 fallback 검증
- 세션 최신순 정렬, 상태, 요약 필드 변환 검증
- 빈 세션에서 상세 helper가 예외를 내지 않는지 검증
- 로컬 백엔드 `/health`, `/sessions` 응답과 새 탭 번들 API base 설정 확인
- `rg`로 `ATLAS_ORBITS`와 mock 안내가 제거됐는지 확인

## 위험과 결정 사항

- 백엔드에 Orbit 계약이 없으므로 현재는 Session을 중심 노드로 직접 표현한다. 실제 Orbit 그룹과 중첩 세션은 후속 데이터 모델/API 고도화 범위다.
- 세션별 이벤트 조회는 기존 API를 재사용하므로 세션 수만큼 요청이 발생한다. 동시 요청 수를 제한하고 React Query 캐시를 사용한다.
- 이벤트 조회 실패는 snapshot 세션과 동일하게 tabs fallback으로 보완하지만, 세션 목록 자체 실패는 오류 상태로 노출한다.
- `fetchSessionEvents`의 기존 계약상 이벤트 요청 실패와 빈 이벤트는 구분할 수 없다. 이번 범위에서는 화면 가용성을 우선한다.

## 완료 조건

- 새 탭 코드와 번들에 정적 `ATLAS_ORBITS` 데이터가 남지 않는다.
- 홈과 Atlas가 백엔드의 실제 세션·이벤트를 표시한다.
- AI 질문이 실제 Memory 검색 결과의 세션으로 이동한다.
- loading, error, empty, 페이지 없는 세션에서도 화면이 깨지지 않는다.
- extension 테스트·타입 검사·빌드가 통과한다.
- 관련 문서와 `DecisionLog.md`, `WorkLog.md`가 실제 구현과 일치한다.

## 후속 개선 — 페이지 궤도 분할

- 한 궤도에 표시하는 페이지를 최대 8개로 제한한다.
- 9번째 페이지부터는 바깥쪽 동심 궤도를 추가하며 전체 방문 순서를 유지한다.
- 페이지 수가 0개, 8개, 9개, 여러 궤도인 경계 조건을 단위 테스트한다.
- 선택한 페이지의 연결선과 툴팁 번호는 분할 후에도 정확한 전체 페이지를 가리켜야 한다.
