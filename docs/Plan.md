# 사용자 폴더와 궤도 캔버스 2뎁스

**상태:** 구현 완료 (2026-08-07) — 실제 브라우저 스모크 미실시
**브랜치:** `feat/session-folders`

## 작업 목표

- 사용자가 직접 폴더를 만들어 세션을 정리하고, Atlas 캔버스가 폴더를 중심 노드로 그린다.
- 세션 배정은 폴더 옆 `+` 버튼(다중 선택 일괄)과 세션 드래그앤드롭 두 경로를 제공한다.
- 궤도는 자식 전체를 담되 앞면에 일부만 노출하고 나머지는 뒤편에 두어 회전으로 접근한다.
- 화면 밖으로 나간 궤도는 흐리게 표시하고 화살표·스크롤로 그쪽까지 이동한다.
- 폴더 뷰(궤도=세션)와 미정리 뷰(궤도=페이지 그룹)가 같은 렌더링·인터랙션 로직을 쓴다.

## 현재 상태와 조사 결과

- `extension/entrypoints/newtab/components/atlas/data.ts:139-142` — "백엔드에 Orbit 엔티티가
  없어 세션을 중심 노드로 직접 쓴다"는 주석. 주제 계층은 원래 설계에 있었으나 미구현 상태다.
- `AtlasCanvas.tsx` 궤도는 의미가 없다. `PAGES_PER_ORBIT = 8`로 페이지를 8개씩 잘라 담는
  순수 페이지네이션이며(`data.ts:39-48`), 궤도 반경은 정보를 전달하지 않는다.
- 궤도 용량 한계: `ORBIT_GAP = 58`, `R_ABS_MAX = 390`, 최소 반경 150 → 실질 5줄.
  밀도 통제 없이 궤도=세션 매핑을 넣으면 세션 6개부터 그릴 자리가 없다.
- `backend/app/db/models.py`에 topic/folder/tag 계열 필드가 없다. 신규 테이블은
  `create_all`이 생성하고(`app/db/session.py:14`), 기존 테이블 컬럼 추가는
  `app/db/migrations.py`의 멱등 ALTER 러너가 담당한다.
- 인증은 `app/api/deps.py`의 `current_user_id`로 통일돼 있다. 폴더도 사용자 스코프가 필요하다.
- 키 배정 충돌: `VariantAtlasReplica.tsx:123-129`에서 ↑↓=세션 순회, ←→=페이지 순회로
  4방향을 이미 소진했다. 궤도 회전과 축 이동을 넣으려면 재배정이 필요하다.

## 사용자 결정 사항 (확인 완료)

| 항목 | 결정 |
|---|---|
| 폴더 뷰 계층 | **3계층** — 중심=폴더, 궤도 1줄=세션 1개, 그 궤도의 점=해당 세션의 페이지 |
| 세션 소속 | **단일 소속** (폴더 = 서랍). 세션은 폴더 하나에만 속한다 |
| 저장 위치 | **백엔드** — 기기 간 유지, 세션 병합·삭제와 정합성 확보 |
| 주제 생성 방식 | **수동** — 자동 클러스터링을 쓰지 않는다 |

## 포함 범위

- `folders` 신규 테이블(사용자 스코프, 이름, 색, 정렬 위치)과 `sessions.folder_id` 컬럼
- 폴더 CRUD API, 세션 일괄 배정 API, 폴더에서 빼기 API
- 폴더 삭제 시 소속 세션은 보존하고 `folder_id`만 NULL로 되돌린다
- 세션 응답에 `folderId` 노출
- 확장 타입·API 클라이언트·조회 훅
- 네비게이터 3뎁스 트리(폴더 > 세션 > 페이지)와 미정리 섹션
- 폴더 생성·이름 변경·삭제 UI, `+` 다중 선택 모달, 세션 드래그앤드롭
- 캔버스 제네릭화: 중심 노드 + 궤도 트랙 + 궤도별 회전 오프셋
- 궤도 가시 슬롯 제한과 뒤편 보관, 잔여 개수 표시
- 화면 밖 궤도 흐림 처리와 축 이동(화살표·휠)
- 키보드 조작 재배정
- backend pytest, extension vitest·타입 검사·빌드
- `data-model-v2.md`, `api-design-v2.md`, `IA.md`, `DecisionLog.md`, `WorkLog.md` 갱신

## 제외 범위

- 자동 주제 클러스터링·LLM 폴더 추천
- 중첩 폴더(폴더 안의 폴더)
- 폴더 공유·내보내기
- 세션 다중 소속(태그형)
- 폴더 단위 AI 요약
- 사이드패널의 폴더 UI (새 탭 Atlas 화면에 한정)

## 변경할 파일

**backend**

- `app/db/models.py` — `Folder` 모델 추가, `Session.folder_id` 추가
- `app/db/migrations.py` — `sessions.folder_id` additive 컬럼 등록
- `app/schemas/folder.py` — 신규 요청·응답 스키마
- `app/schemas/session.py` — `SessionDetail`에 `folder_id`
- `app/api/folders.py` — 신규 라우터
- `app/api/sessions.py` — 세션 응답 매핑에 folder_id 반영
- `app/main.py` — 라우터 등록
- `tests/test_folders.py` — 신규 테스트

**extension**

- `lib/types.ts` — `Folder`, `Session.folderId`
- `lib/api.ts` — 폴더 API 클라이언트
- `entrypoints/newtab/hooks/useFolders.ts` — 신규 조회·변경 훅
- `entrypoints/newtab/components/atlas/data.ts` — `FolderNode`, 궤도 트랙 빌더
- `entrypoints/newtab/components/atlas/AtlasNavigator.tsx` — 3뎁스 트리, DnD
- `entrypoints/newtab/components/atlas/FolderAssignDialog.tsx` — 신규 일괄 선택 모달
- `entrypoints/newtab/components/atlas/AtlasCanvas.tsx` — 궤도 트랙·회전·축 이동
- `entrypoints/newtab/components/VariantAtlasReplica.tsx` — 포커스 대상 확장, 키 재배정
- `entrypoints/newtab/lib/nav-state.ts` — 폴더 포커스 상태
- `entrypoints/newtab/styles/atlas.css` — 폴더 행, 흐림, 회전 전환

## 구현 순서

1. 백엔드 모델·마이그레이션·스키마를 먼저 확정한다(계약 우선).
2. 폴더 라우터와 세션 배정 엔드포인트를 구현하고 pytest를 추가한다.
3. 확장 타입과 API 클라이언트를 백엔드 계약에 맞춘다.
4. 네비게이터 3뎁스 트리와 폴더 CRUD·배정 UI를 구현한다.
5. 캔버스를 중심 노드 + 궤도 트랙 구조로 일반화한다.
6. 궤도 회전과 축 이동·흐림을 추가하고 키 배정을 재정리한다.
7. 테스트·타입 검사·빌드를 실행한다.
8. 문서와 WorkLog를 갱신한다.

## 테스트 및 검증 방법

```bash
cd backend && python -m pytest -p no:asyncio
cd extension && pnpm test && pnpm compile && pnpm build
```

- 폴더 생성 → 세션 배정 → 조회 → 폴더 삭제 후 세션 보존을 API 테스트로 확인한다.
- 남의 폴더에 접근하면 404가 되는지 사용자 스코프를 테스트한다.
- 궤도 분할·회전 오프셋 계산은 순수 함수로 분리해 단위 테스트한다.

## 위험과 완화

- **밀도 붕괴** — 폴더에 세션이 많으면 궤도가 화면을 넘는다. 궤도 축 이동과 흐림으로
  대응하되, 동시 렌더 궤도 수에 상한을 둔다.
- **숨긴 항목 인지 실패** — 뒤편으로 넘어간 점은 존재를 알 수 없다. 궤도마다
  `현재/전체` 위치 표시를 붙인다.
- **드래그앤드롭 접근성** — 포인터 전용 조작은 키보드 사용자를 배제한다.
  `+` 버튼 경로가 동등한 대체 수단이 되도록 유지한다.
- **휠 이벤트 충돌** — 새 탭 페이지 스크롤과 겹친다. 캔버스 위에서만 가로챈다.
- **병합과의 정합성** — 흡수된 세션은 `merged_into`로 목록에서 빠지므로 폴더 소속을
  따로 정리하지 않는다. 생존 세션의 폴더는 유지한다.

## 완료 조건

- 폴더를 만들고 두 경로 모두로 세션을 넣을 수 있다.
- 폴더를 선택하면 중심=폴더, 궤도=세션, 점=페이지로 그려진다.
- 궤도의 점이 가시 한도를 넘으면 뒤편에 보관되고 회전으로 접근된다.
- 화면 밖 궤도가 흐리게 보이고 축 이동으로 접근된다.
- 미정리 세션 뷰가 같은 로직으로 동작한다.
- 폴더를 지워도 세션이 사라지지 않는다.
- 검증 명령이 모두 통과한다.
