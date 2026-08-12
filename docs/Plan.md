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
