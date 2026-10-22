# 팀 워크스페이스 2단계 — 팀 수집 모드 설계

> 상태: 설계 확정(b8d5c21). 서버 구현 2026-10-23(`feat/team-collect-mode`, main 3875f4c 기준), 확장·화면은 다음 차례. 협업 사업부장 한지석.
> 근거: `DecisionLog.md` 2026-10-17 "팀 워크스페이스: 세션 공유(라이브 참조)부터, 팀 수집 모드는 2단계"의 B 단계,
> 대표 지시 `company/directives/2026-10-22-no-deferral.md` 5번.
> 기준 코드: 로컬 main(db91269)의 1단계 서버 계약 + `origin/main`의 #22(append 게이트)·#23(본문 16,000자)·
> #24(`.go.kr` 민감 도메인 축소)·#26(폴더 자동 배정). 구현은 `chore/sync-origin-main` 통합본 위에서 한다.
> 계약은 `data-model-v2.md` §10.3, `api-design-v2.md` §15, `IA.md` 설정 > 팀 수집, `UserScenarios.md` 17~19로 옮겼다.
> 시험: `backend/tests/test_team_collect.py`(메모리 SQLite, 항상 실행), `backend/tests/test_team_collect_pg.py`(실제 PostgreSQL, `ORBIT_TEST_PG_URL`).

## 0. 한 줄 요약과 결정

> 2026-10-22 보안·개인정보 검토(류건호, `company/meetings/2026-10-22-team-collect-design.md`) M1~M6·S1~S7을 반영했다.
> 처음 안에서 "대표 결정 필요"로 올린 5개는 CTO가 대표 위임으로 모두 권고대로 확정했다(맨 끝 "결정 사항").

팀 수집을 켠 동안 **이 기기에서** 연 페이지를 그 팀의 "팀 스트림"으로 보내고, 서버는 **멤버마다 따로**
세션화한 뒤 만든 세션을 1단계의 공유 행(`workspace_sessions`)으로 **자동 공유**한다. 세션의 주인은 언제나
방문한 사람이다. 그래서 1단계의 소유권·삭제·탈퇴·쓰기 권한·누출 방지 규칙을 그대로 다시 쓴다.

| 항목 | 결정됨 |
|---|---|
| 켜기 | owner가 팀에 "팀 수집 허용"을 켜고, 각 멤버가 기기마다 시간을 정해 시작한다(기본 2시간, 최대 8시간) |
| 꺼짐 | 시간 만료(서버가 강제), 브라우저 재시작, 계정 전환, 탈퇴, owner의 허용 끄기. 확장의 끄기는 서버 응답을 기다리지 않고 로컬부터 멈춘다 |
| 상태 저장 | 확장의 수집 상태는 `chrome.storage.session`(브라우저를 다시 열면 Chrome이 지운다) |
| 보이기 | 확장 아이콘 배지 `팀`(팀 색), 사이드패널 상단 띠, 새 탭 머리 칩. 남은 시간과 `일시 정지`·`끄기` |
| 제외 | 민감 사이트·로그인/결제로 보이는 주소·웹메일·메신저·검색 결과 페이지·사용자 제외 목록은 팀으로 가지 않고 개인 기록으로만 남는다. 시크릿 창은 개인으로도 수집하지 않는다 |
| 세션화 | 멤버별 세션화 + 팀 자동 공유(선택지 A). 여러 멤버를 한 세션에 섞지 않는다 |
| 저장 | `exploration_events.workspace_id`·`collect_window_id`, `sessions.collect_workspace_id`, `workspaces.collect_allowed` 열과 `workspace_collect_windows` 표 |
| 권한 근거 | 서버가 인제스트·세션 반영 시점의 SQL로 멤버십(가입 시각 포함)과 수집 창(시간·기기·빼기 여부)을 다시 판정한다. 애매하면 개인. 클라이언트가 붙인 팀 표시는 요청일 뿐이다 |
| 팀원에게 보이는 주소 | 쿼리를 지운다(모든 팀원 응답 경로, §7.3) |

대표가 꼭 알아야 할 위험: **켜 둔 동안 연 페이지는 팀원이 실시간으로 본다. 나중에 공유를 풀어도 이미 본 것은
되돌릴 수 없다.** 이 설계는 "잊고 켜 둔 채 사적인 방문"을 시간 만료·상시 표시·자동 제외로 줄이지만 0으로
만들지는 못한다(§1.4). 동의 문안에 이 사실을 그대로 적는다(§7.1).

---

## 1. 켜고 끄기와 동의

### 1.1 누가 켜는가

| 선택지 | 장점 | 단점 |
|---|---|---|
| (a) 멤버만 켠다 | 단순 | owner가 팀 성격(예: 외부인 섞인 팀)상 자동 수집을 원치 않아도 막을 길이 없다 |
| (b) owner가 팀 단위로 허용 + 멤버가 각자 켬 | 팀 정책과 개인 동의를 모두 명시. owner가 허용을 끄면 모두 멈출 수 있다 | 켜기 단계가 하나 는다 |
| (c) owner가 켜면 모든 멤버가 수집 | 팀 기록이 가장 빨리 쌓인다 | **본인 동의 없는 수집** — 계정별 동의 원칙(대표 위임 결정 4)과 정면 충돌 |

**결정됨 (b).** `workspaces.collect_allowed`(owner 전용, 기본 false). 멤버의 시작은 그 팀에서 처음일 때 동의
화면(§7.2)을 거친다. 계정의 개인 수집 동의(`orbit:collectionConsent`)가 없으면 팀 수집도 시작할 수 없다 —
팀 수집은 개인 수집 위에 "어디로 보낼지"만 더하는 것이기 때문이다(§2.3).

### 1.2 수집 창(window)과 기기

팀 수집은 **수집 창** 단위다: `(팀, 사람, 기기, 시작, 만료, 끝)`. 서버가 창을 만들고 끝내며, 인제스트는
이벤트의 `visited_at`이 그 사람·그 기기의 창 안에 있을 때만 팀 표시를 받아들인다.

- **기기에 묶는 이유**: 노트북에서 켠 수집이 같은 계정으로 로그인한 집 데스크톱의 방문까지 팀으로 보내면 안 된다.
  `device_id`는 이미 `POST /events`에 실린다(`orbit:deviceId`).
- **한 사람·한 기기에 동시에 하나의 창만**: 다른 팀에서 시작하면 이전 창을 같은 트랜잭션에서 끝낸다
  (응답에 `ended_workspace_id`). 확장은 시작 전에 "팀 A 수집을 끝내고 팀 B로 바꿀까요?"를 묻는다.
  두 시작 요청이 경합해도 열린 창이 둘 생기지 않게 부분 유니크 인덱스로 막는다(§4.1). 시작 트랜잭션은
  먼저 그 사람·기기의 만료됐지만 `ended_at`이 비어 있는 창을 `ended_at = expires_at`(사유 `expired`)으로 닫고 새 창을 넣는다.
- **다른 기기의 창도 끈다**: 회사 노트북에서 켜 두고 잊었으면 집에서 끌 수 있어야 한다. 팝오버에 "내 다른 기기의
  열린 창" 목록과 `모두 끄기`를 둔다(`DELETE /collect`에서 `device_id`를 빼면 그 팀의 내 모든 창을 끝냄, §5).
- **창 기록을 남기는 이유**: 로컬 큐는 오프라인이면 몇 시간 뒤에 보낸다. 늦게 도착한 이벤트도 "그때 켜져
  있었는가"로 판정해야 하므로 열 하나(현재 상태)가 아니라 이력 행이 필요하다.

### 1.3 일시 정지와 자동 꺼짐

| 선택지 | 장점 | 단점 |
|---|---|---|
| 시간 제한만 | 서버가 강제할 수 있어 확장 버그에도 안전 | 짧게 잡으면 자주 다시 켜야 한다 |
| 브라우저 닫을 때만 | 하루 작업 단위와 맞음 | 브라우저를 며칠 켜 두는 사용자가 많다. 서버가 알 수 없다 |
| 유휴(자리 비움) 시 | 자리를 떠난 동안 남이 쓰는 경우 대비 | 회의·독서 중에도 꺼진다. 오탐이 잦다 |
| 시간 제한 + 브라우저 재시작 | 서버 강제 + 하루 경계 | 두 경로를 시험해야 한다 |

**결정됨: 시간 제한(서버 강제) + 브라우저 재시작 시 꺼짐.** 유휴는 넣지 않는다(기존 `idle` 처리는 활성 시간
계산에만 쓴다).

- 시작할 때 30분·1시간·2시간(기본)·4시간·8시간 중 고른다. 서버는 `expires_at = now + min(요청, 8h)`.
  만료 뒤 방문은 팀 표시를 버리고 개인으로 저장한다(판정 시각 규칙은 §2.2).
- **로컬 상태는 `chrome.storage.session`에 둔다(M1).** 브라우저를 다시 열면 Chrome이 지우므로 서버 `DELETE`가
  실패해도(오프라인·토큰 만료) 재시작 뒤 방문에는 팀 표시가 붙지 않는다. SW만 재시작할 때는 남는다
  (탭 상태 `TAB_STATE_KEY`와 같은 방식). `chrome.storage.local`에 두면 서버 종료 실패 시 최대 8시간 새므로 쓰지 않는다.
- **끄기는 로컬 먼저(M1).** 정지·일시 정지·만료·계정 전환·로그아웃 때 확장은 ① 로컬 상태를 먼저 지우고
  ② 서버 `DELETE`를 보낸다. 서버 결과를 기다리지 않으며, 실패하면 재시도 알람으로 다시 보낸다. ①과 ② 사이에
  생긴 방문은 이미 로컬 상태가 없으므로 개인이다.
- `chrome.runtime.onStartup`에서 확장이 그 계정의 열린 창을 `DELETE`(사유 `browser_restart`)로 끝낸다.
  로컬 상태는 이미 비어 있으므로 이 요청은 서버 정리와 다른 기기 화면의 정확성을 위한 것이다.
- **마지막 Chrome 창이 닫히면 끈다(S'4).** macOS에서 창만 닫고 Chrome을 끝내지 않거나 Windows의 "백그라운드 앱 계속 실행"이
  켜져 있으면 `storage.session`이 남는다. 그래서 `chrome.windows.onRemoved`에서 남은 일반 창이 0개면 ① 로컬 상태부터 지우고
  ② 서버 `DELETE`(사유 `browser_restart`)를 보낸다. 동의 시트에 "Chrome 창을 모두 닫거나 Chrome을 끝내면 꺼져요"를 적는다(§7.2).
- **일시 정지 = 창 끝내기(사유 `pause`)**, 다시 시작 = 남은 시간으로 새 창. 서버 상태를 늘리지 않는다.
- 만료 10분 전에 사이드패널 띠와 배지 툴팁에 "곧 꺼져요 · 연장"을 보인다. 연장은 새 창(최대 8시간 규칙 동일).

### 1.4 "끄는 걸 잊으면 사적인 방문이 팀에 들어간다"를 막는 장치

1단계 대안 분석(DecisionLog 2026-10-17 대안 1)의 위험이다. 겹겹이 막는다.

1. **만료가 기본값**: 무기한 켜기는 없다. 최대 8시간, 브라우저 재시작에서 꺼진다(로컬 상태가 세션 저장소라 서버 응답과 무관).
2. **상시 표시**: 배지·띠·칩이 켜진 동안 늘 보인다(§8). 사이드패널을 닫아도 아이콘 배지는 남는다.
3. **자동 제외**: 민감 도메인·로그인/결제로 보이는 주소·웹메일·메신저·검색 결과 페이지·사용자 제외 목록은 팀으로
   가지 않는다(§2). `excludeSensitive` 설정을 꺼 둔 사용자도 팀 수집에서는 항상 제외한다.
4. **끝날 때 돌아보기**: 창이 끝나면(정지·끄기·만료) "이번 팀 수집: 세션 N개, 사이트 목록"을 보인다.
   - 세션마다 `팀에서 빼기`(= 1단계 공유 해제 + `collect_workspace_id` 비움).
   - `남은 방문도 모두 빼기`: 아직 세션이 되지 않은 방문을 개인으로 돌린다. 로컬 `pending`은 로컬에서, **서버에 도착했지만
     세션화되지 않은 방문은 서버 빼기 API(§5 `withdraw`)로** 돌린다(M2). 응답을 잃은 전송 중 배치를 개인으로 다시 보내도
     서버는 `on_conflict_do_nothing(id)`라 처음 저장한 팀 표시를 남기므로, 로컬 처리만으로는 부족하다. `withdraw`는 창에
     "빼짐" 표시(`withdrawn_at`)를 남겨 그 뒤 도착하는 그 창의 방문도 개인으로 받는다.
5. **한계**: 팀원은 공유 세션을 실시간으로 볼 수 있다. 빼기 전에 본 것은 회수할 수 없다.
   "보내기 전 대기(예: 15분 보류 후 전송)"는 넣지 않기로 결정했다(팀 기록의 실시간성을 깎고 로컬 큐 상태가 하나 는다).
   이 한계는 동의 문안에 밝힌다(§7.1).

---

## 2. 무엇이 팀으로 들어가는가

### 2.1 판정 순서 (확장, 방문 시점)

방문 하나가 생길 때(`handleCommitted`, `commitSpaNavigation`) 확장이 `workspaceId`를 정한다.

1. 개인 수집 동의가 없거나 로그아웃이면 → 수집 안 함(기존 그대로).
2. 시크릿 창(`tab.incognito`) → **수집 안 함**(개인에도 남기지 않음, §2.4).
3. 이 계정의 `chrome.storage.session` 팀 창이 없거나, 서버 시각으로 보정한 지금이 만료 뒤 → `workspaceId = null`(개인).
4. 다음 중 하나에 걸림 → `workspaceId = null`(개인으로만).
   - `isSensitiveUrl(url)`(민감 도메인·로그인/결제 경로 정규식)
   - **로그인 호스트 패턴**(팀 수집 전용): 호스트가 `login.*`·`accounts.*`·`sso.*`·`auth.*`·`signin.*`로 시작,
     또는 `login.microsoftonline.com`, `github.com/session`·`/login`, `accounts.google.com` 전부
   - **팀 수집 기본 제외(S6, CTO 결정, v1은 해제 불가)**: 웹메일(`mail.google.com`, `outlook.live.com`, `outlook.office.com`,
     `mail.naver.com`, `mail.daum.net`), 메신저(`web.whatsapp.com`, `web.telegram.org`, `app.slack.com`, `teams.microsoft.com`,
     `discord.com/channels`, `messenger.com`, `instagram.com/direct`), 검색 결과 페이지(서버 `extract_search_query`가 검색어를
     뽑는 주소 = Google·Naver·YouTube·Bing 결과). 목록은 확장·서버에 같은 값으로 두고 민감 목록처럼 함께 바꾼다
   - 사용자 제외 목록
5. 그 밖 → `workspaceId = 창의 팀`.

- **리다이렉트 재판정**: 열린 이벤트의 주소가 바뀌는 경로(`tryReplaceRecentOpenEvent`)에서도 4번을 다시 판정한다.
  로그인 화면으로 튕기는 리다이렉트가 흔해서, 첫 주소로만 판정하면 로그인 화면이 팀으로 간다.
- **제목 재판독(S5)**: `onCommitted` 시점의 `tab.title`은 직전 페이지(개인·민감일 수 있음)의 제목일 수 있다.
  팀 표시가 붙은 이벤트는 제목을 비워 두고, 본문을 붙일 때(`handlePageContentReady`)와 `tabs.onUpdated`의 제목 변경 때
  지금 `tab.url`이 그 이벤트 주소와 같을 때만 제목을 채운다. 주소가 다르면(이미 다른 페이지로 감) 제목을 비운 채 둔다.
- 이 정규식·호스트 목록은 "로그인 화면 전부"를 잡지 못한다. 그래서 동의 문안은 "로그인 화면 제외"를 약속하지 않고
  "로그인·결제 주소로 보이는 페이지"라고 쓴다(§7.1).

### 2.2 서버의 재판정 (인제스트)

클라이언트 판정은 믿지 않는다. `POST /events`가 팀 표시가 붙은 이벤트마다 같은 트랜잭션에서 다시 본다.
하나라도 어기면 **팀 표시만 지우고 개인 이벤트로 저장**한다(거절하지 않는다 — 그 사람이 개인 수집에 동의했고,
거절하면 확장이 재시도를 반복한다).

- 서버 `event_filter.is_sensitive_url(url)` (origin #24 이후 목록: 정부24·홈택스 등 개인 서비스만, 공지성
  `.go.kr`는 수집), 로그인 호스트 패턴, 팀 수집 기본 제외(§2.1 4번). 판정 함수는 확장과 같은 규칙을 유지한다.
- 사용자 제외 목록(`user_settings` 키 `team_collect_excluded_domains`, §4.4)에 걸림.
- **이벤트가 실은 `collect_window_id` 창 하나로만 판정한다(S'1).** 그 창이 있고, 창의 `user_id`가 요청자, `workspace_id`·`device_id`가
  이벤트와 같고, `withdrawn_at IS NULL`(빼기 전, M2). `collect_window_id`가 없거나 맞지 않으면 개인. 서버가 `visited_at`으로 창을 고르지
  않으므로, 일시 정지 뒤 다시 시작해 같은 기기에 창이 연달아 있어도 창 1의 방문이 창 2로 판정돼 창 1의 빼기를 빠져나가지 않는다.
- **창이 현재 멤버십 이후에 열렸다**: `window.started_at ≥ workspace_members.joined_at`(M3). 탈퇴 뒤 다시 들어오면
  옛 창 행(`ended_reason=left`)이 남아 있어도, 로컬 큐에 남은 옛 창의 방문이 새 멤버십으로 팀에 들어가지 않는다.
- 지금도 그 팀의 멤버이고 팀의 `collect_allowed = true`.
- **시각 판정(S1, 서버 수신 시각 기준, 애매하면 개인)**: `visited_at`은 클라이언트 시계라 믿지 않는다.
  `received_at`은 인제스트 트랜잭션의 서버 `now()`, `end = coalesce(ended_at, expires_at)`.
  - `visited_at > received_at + 5분`(미래 시각) → 개인.
  - `received_at < end`(창이 열려 있는 동안 도착) → `visited_at ≥ started_at`이면 팀. 방문은 도착보다 앞서므로 실제로 창 안이다.
  - `received_at ≥ end`(늦게 도착, 오프라인 큐) → `started_at ≤ visited_at < end − 5분`일 때만 팀. 끝 직전 5분은
    기기 시계가 느린 경우를 구분할 수 없어 개인으로 둔다(실패 시 닫힘).
  - 시작 경계는 기기 시계가 느리면 개인 쪽으로, 빠르면 끝 경계에서 개인 쪽으로 기운다. 어느 쪽도 팀 쪽으로 새지 않는다.
  - 창 시작 응답의 `server_now`로 확장이 시계 차이를 보정해 로컬 만료 판단에 쓴다(서버 판정을 대신하지 않는다).
- **판정과 빼기의 직렬화**: 인제스트는 판정할 때 해당 창 행을 `FOR SHARE`로 잠그고, `withdraw`·창 종료는 `FOR UPDATE`로
  잠근다. 빼기가 커밋되기 전에 시작한 인제스트가 그 뒤에 팀 표시를 커밋하는 경합을 막는다(§6.4).

응답에 `team_accepted`, `team_downgraded`와 **`window_closed: bool`**(이 기기의 로컬 창이 서버에서 이미 끝났는가, S'5)을 더한다.
강등 수는 제외 목록 동기화 지연으로도 늘 수 있어 로컬을 끄는 신호로 쓰지 않는다. 끄는 신호는 `window_closed`뿐이다.

### 2.3 같은 방문이 개인 기록에도 남는가

| 선택지 | 장점 | 단점 |
|---|---|---|
| (a) 팀에만 간다(개인 기록에 안 보임) | "팀 기록과 내 기록이 분리됐다"는 느낌 | 세션 주인이 없어진다 → 선택지 B와 같은 소유권 문제. 내 탐색을 나도 못 찾는다 |
| (b) 이벤트는 하나, 세션은 내 것이고 팀에 공유됨 | 내 기록에도 보이고(공유 중 배지), 삭제·공유 해제를 내가 한다. 저장이 한 벌 | 개인 화면에 팀 세션이 섞여 보인다 |
| (c) 개인 사본 + 팀 사본 | 각자 독립 | 데이터 두 벌, 삭제가 한쪽만 되면 누출. 1단계가 버린 스냅샷 복사(대안 3)의 문제 재현 |

**결정됨 (b).** 팀 수집 세션은 내 세션 목록에도 `팀 이름 · 수집` 표시로 보인다. 개인 화면에서 팀 수집 세션만
숨기는 필터는 화면 일이며 데이터는 하나다.

### 2.4 시크릿 창 — 현재 코드의 빈틈

확인 결과 지금 수집기(`extension/lib/events/collector.ts`)는 `tab.incognito`를 보지 않는다. manifest에
`incognito` 키가 없어 기본값 `spanning`이므로, 사용자가 확장 관리에서 "시크릿 모드에서 허용"을 켜면 시크릿
탭의 방문과 본문이 서버와 외부 AI로 간다.

**결정됨(CTO 결정 4): 개인 수집에서도 막는다.** 팀 수집과 별개로 결선 전에 고친다(보안 검토 판정 심각도 중간,
GitHub main 통합본 위 별도 갈래).
- `wxt.config.ts` manifest에 `incognito: 'not_allowed'` — 확장이 시크릿 창에서 아예 돌지 않는다. 시험은 빌드 산출 manifest의 키 확인.
- 이중 방어로 `handleCommitted`·`commitSpaNavigation`에서 `tab.incognito`면 수집하지 않는다(§2.1 2번).

---

## 3. 팀 단위 Auto Session

### 3.1 두 선택지

- **A. 멤버별 세션화 → 팀 자동 공유.** 배치는 지금처럼 한 사람의 이벤트만 다룬다(`_claim_pending_events`의
  "한 배치 = 한 사용자" 규칙). 다만 같은 사람 안에서도 **팀 스트림과 개인 스트림을 섞지 않는다**. 팀 스트림
  이벤트로 만든 세션은 `collect_workspace_id = 팀`이고 만들 때 `workspace_sessions` 행을 같이 넣는다.
- **B. 여러 멤버의 이벤트를 한 팀 세션으로.** 팀 스트림 전체를 한 배치에서 세션화하고, 세션 주인은 팀이다.

### 3.2 비교

| 관점 | A. 멤버별 + 자동 공유 | B. 멤버 혼합 팀 세션 |
|---|---|---|
| 소유권 | 방문한 사람. `sessions.user_id` 그대로 | 팀(가짜 user_id 또는 새 열). `_owned_session`이 "팀 owner도 쓰기 가능"으로 넓어져야 한다 |
| 삭제 | 주인이 세션·방문을 지운다(기존 경로) | 남의 방문이 섞인 세션을 누가 지우나? 내 방문만 빼면 요약을 다시 만들어야 한다 |
| 탈퇴 | 1단계 규칙 그대로: 공유 행 삭제 → 즉시 안 보임. 세션은 그 사람 개인 기록으로 남음 | 탈퇴자의 방문을 모든 팀 세션에서 빼고 재요약해야 한다. **`session_versions`에 탈퇴자 내용이 담긴 옛 요약이 남는다** — 지우지 않으면 누출, 지우면 이력 계약 위반 |
| 쓰기 권한 | 주인만(1단계 불변 조건 2 유지) | 팀원 누구나 or owner만 — 새 권한 모델. 대표 결정 필요 |
| 요약 비용 | 개인 수집과 같다(방문당 한 번 배정, 바뀐 세션만 재요약) | 멤버마다 append가 큰 세션의 재요약을 부른다. 탈퇴·삭제마다 재요약. 세션당 입력이 커 토큰↑ |
| 개인정보 | 한 세션·한 요약에 한 사람의 방문만. 외부 AI 프롬프트에도 한 사람 것만 | 여러 사람의 방문이 한 프롬프트·한 요약으로 합쳐진다. 누가 무엇을 봤는지가 요약 문장에 섞인다 |
| 팀 가치 | 같은 주제를 두 사람이 보면 세션 두 개가 나란히 보인다 | 같은 주제가 한 세션으로 모인다 |
| 구현 크기 | 배치 스트림 분리 + 반영 시 공유 행. 권한 코드 변경 없음 | 배치·권한·삭제·탈퇴·이력 전부 변경 |

**결정됨 A.** B의 장점(같은 주제 모아 보기)은 팀 화면에서 **읽기 전용 묶음 보기**로 얻는다 — 같은 팀의 공유
세션들을 제목·키워드 유사도로 묶어 "이 주제: 지석 · 유나"처럼 보이는 것. 저장·권한은 A 그대로다. 이 묶음
보기는 2단계 범위 밖이며 필요가 확인되면 따로 제안한다.

### 3.3 A의 세부 규칙

- **스트림 = `(user_id, workspace_id)`**, 개인은 `workspace_id IS NULL`. `_claim_pending_events`는 가장 오래
  기다린 pending 이벤트의 `(user_id, workspace_id)`를 골라 그 스트림만 가져온다.
- **후보 세션도 같은 스트림만**: `_fetch_candidates`의 SQL에 `Session.collect_workspace_id IS NOT DISTINCT FROM
  :ws`. 이 SQL 조건이 경계다. Qdrant 필터(§4.3)는 후보 품질용이다.
  - 왜: 개인 방문이 팀 세션에 append되면 **끈 뒤에도 팀에 보인다**. 팀 방문이 공유 안 된 개인 세션에 append되면
    팀에 안 간다(누출은 아니지만 사용자가 기대한 팀 기록이 빠진다).
- **반영 시 재판정(§6.4)**: LLM 대기 뒤 `apply_assignments`의 트랜잭션에서 멤버십을 다시 본다. 실패하면 그 그룹을
  개인 스트림으로 내려 반영한다(새 세션은 `collect_workspace_id = NULL`, 공유 행 없음, append 대상이 팀 세션이면
  create로 강등).
- **append 게이트(#22)·형제 주제 분리·`_merge_split_topic`**은 스트림 안에서 그대로 적용한다.
- **병합(S4)**: 자동병합·수동 병합·병합 제안 모두 **두 세션의 `collect_workspace_id`가 같은지 직접 비교**한다
  (`IS NOT DISTINCT FROM`). 다르면 자동병합·제안에서 빼고 수동 병합은 `409 conflict` — 개인 세션을 팀 세션에 흡수시키면
  개인 방문이 팀에 보인다. 지금의 "공유 중이면 건너뜀"(`merge_service.auto_merge_duplicates`)은 그대로 두되 그것에만 기대지
  않는다. owner가 남의 수집 세션의 공유를 풀면 공유 행만 사라지고 스트림 열이 남아 공유 여부 검사만으로는 자동병합 대상이
  되기 때문이다.
- **공유 해제 = 스트림 해제**: 누가 풀든(공유한 사람·owner, 1단계 `DELETE /workspaces/{id}/sessions/{sid}`) 그 세션이
  그 팀의 수집 세션이면 같은 트랜잭션에서 `collect_workspace_id`를 비운다. 이후 그 세션은 개인 스트림이며 팀 방문이 붙지 않는다.
- **되돌리기 = 두 값을 함께(N1).** 돌아보기에서 뺀 세션의 `되돌리기`는 공유 행과 `collect_workspace_id`를 **한 트랜잭션에서 함께**
  원래대로 돌린다. 공유 행만 되살리면 "공유된 개인 스트림 세션"이 되어, 1단계 라이브 참조 규칙대로 이후의 **개인 방문**이 append돼
  팀에 보인다. 조건: 주인이 지금도 그 팀 멤버이고, 그 세션을 만든 창이 `started_at ≥ joined_at`이며, 팀의 그 세션이 아직
  흡수되지 않았다. 하나라도 깨졌으면 `409`로 막고 화면은 "되돌릴 수 없어요"를 보인다. 서버 경로는
  `POST /workspaces/{id}/collect/sessions/{sid}/restore`(주인 전용, 남의 세션 `404`). 일반 1단계 `POST /workspaces/{id}/sessions`로
  다시 공유하는 것은 개인 스트림 공유이며 되돌리기가 아니다(확인 문구가 라이브 참조를 알린다 — 1단계 그대로).
- **폴더 자동 배정(#26)**: 주인의 폴더에 넣는 개인 정리 정보라 그대로 둔다. 팀원 응답의 `folder_id`는 1단계대로 `null`.
- **추천·병합 제안·개인 검색**: 주인 기준 그대로(팀 수집 세션도 내 세션).

---

## 4. 데이터 모델과 마이그레이션

### 4.1 변경

```sql
-- 기존 표에 열 추가 (모두 NULL 허용 또는 기본값 → 옛 코드가 무시해도 동작)
ALTER TABLE exploration_events ADD COLUMN workspace_id VARCHAR(36);           -- NULL=개인 스트림
ALTER TABLE exploration_events ADD COLUMN collect_window_id VARCHAR(36);      -- 판정에 쓴 창(S'1). withdraw가 이 값으로 고른다
ALTER TABLE sessions           ADD COLUMN collect_workspace_id VARCHAR(36);   -- NULL=개인 스트림 세션
ALTER TABLE workspaces         ADD COLUMN collect_allowed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_exploration_events_collect_window
  ON exploration_events (collect_window_id) WHERE collect_window_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_exploration_events_stream
  ON exploration_events (user_id, workspace_id, sync_status, visited_at);
CREATE INDEX IF NOT EXISTS ix_sessions_collect_workspace_id
  ON sessions (collect_workspace_id) WHERE collect_workspace_id IS NOT NULL;

-- 신규 표 (create_all이 만든다)
CREATE TABLE workspace_collect_windows (
  id           VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  user_id      VARCHAR(64) NOT NULL,
  device_id    VARCHAR(64) NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,      -- started_at + 최대 8h
  ended_at     TIMESTAMPTZ,               -- NULL=아직 안 끝남(만료 전이면 활성)
  ended_reason VARCHAR(20),               -- stop|pause|switch|expired|browser_restart|account_switch|left|removed|disallowed|team_deleted
  withdrawn_at TIMESTAMPTZ                -- 돌아보기에서 "남은 방문 모두 빼기". 이후 이 창의 팀 표시는 받지 않는다(M2)
);
CREATE INDEX ix_collect_windows_lookup ON workspace_collect_windows (workspace_id, user_id, device_id, started_at);
-- 한 사람·한 기기에 열린 창은 하나(S2). 시작 경합에서 둘째 INSERT가 유니크 위반 → 409로 답하고 확장이 다시 읽는다
CREATE UNIQUE INDEX ux_collect_windows_open ON workspace_collect_windows (user_id, device_id) WHERE ended_at IS NULL;
```

- **왜 `exploration_events`에 열인가(관계 행이 아니라)**: 방문 하나는 최대 한 팀 스트림에 속한다(§1.2 동시에 한 창).
  배치 claim이 이 열로 스트림을 고르므로 조인 없이 인덱스로 끝난다. FK는 두지 않는다 — 팀 삭제 때 이 열을 먼저
  비우는 순서를 §6.2에 정한다(`previous_event_id`처럼 소프트 참조).
- **왜 `sessions.collect_workspace_id`인가(`workspace_sessions`만으로 부족)**: 공유 행은 "팀에 보이는가", 이 열은
  "어느 스트림의 이벤트를 받는가"다. 수동 공유한 개인 세션(1단계)은 팀에 보여도 개인 스트림이다 — 둘을 한 값으로
  합치면 수동 공유 세션에 팀 스트림 방문이 붙거나 그 반대가 생긴다.
- `workspace_sessions`에는 열을 더하지 않는다. "수집으로 공유됨" 표시는 `sessions.collect_workspace_id = workspace_id`로 안다.
- `session_events`, `session_versions`는 바꾸지 않는다.

### 4.2 마이그레이션 계획 — alembic이 아니라 기존 멱등 러너

지시문은 alembic 계획을 요구했지만 이 저장소에는 alembic이 없다. 기동 시 `Base.metadata.create_all`(신규 표) +
`app/db/migrations.py`의 멱등 `ALTER TABLE ... ADD COLUMN`(기존 표 열 추가, origin에서 VARCHAR 확장도 추가됨)이
공식 경로다(`docs/migration-plan.md` §3). alembic 도입은 기술 스택 변경이라 이번 설계에 넣지 않는다.

1. `_TABLE_COLUMNS`에 위 열 4개를 더한다(`exploration_events`·`workspaces` 항목 신설).
2. 러너에 **인덱스 단계**를 더한다: `CREATE INDEX IF NOT EXISTS` 목록. create_all은 이미 있는 표에 새 인덱스를
   만들지 않기 때문이다. 큰 `exploration_events`라도 개발 단계 규모(수만 행)에서는 기동 시 생성으로 충분하다
   (`CONCURRENTLY`는 트랜잭션 밖이어야 해서 러너 구조를 바꾼다 — 공용 서버 데이터가 커지면 그때 바꾼다).
3. `workspace_collect_windows`는 모델 추가만으로 create_all이 만든다(부분 유니크 인덱스는 모델의 `Index(..., unique=True, postgresql_where=...)`).
4. 데이터 이관 없음: 기존 이벤트·세션은 NULL = 개인 스트림, 기존 팀은 `collect_allowed = false`.
5. 되돌리기: 열이 남아도 옛 코드는 읽지 않는다. 기능을 끄려면 모든 팀 `collect_allowed = false` + 열린 창 종료.
6. 시험: 러너 멱등(두 번 실행), 옛 스키마 DB에 기동 → 열·인덱스 생성. 지금 러너 전용 시험 파일은 없어 `tests/test_migrations.py`를 새로 둔다.

### 4.3 Qdrant payload와 필터

- 세션 포인트 payload에 `collect_workspace_id`(keyword index)를 싣는다. 개인 스트림 세션은 **필드를 두지 않는다**.
- 배치 후보 검색(`search_similar_with_scores`, `score_sessions`)에 스트림 필터:
  - 개인: `user_id = u` AND `IsEmpty(collect_workspace_id)`
  - 팀: `user_id = u` AND `collect_workspace_id = ws`
- 기존 포인트는 필드가 없으므로 개인으로 판정된다 → **백필 불필요**.
- 스트림이 바뀌는 경우(탈퇴·팀 삭제로 `collect_workspace_id`를 비움)는 `set_payload`로 필드를 지우는 것을 시도하고,
  실패해도 SQL 후보 조건(§3.3)이 막는다. 개인 검색·팀 검색 필터는 바꾸지 않는다(팀 검색은 1단계처럼 공유 id `HasIdCondition`).

### 4.4 사용자 제외 목록

`user_settings`(키·JSONB 값)에 `team_collect_excluded_domains: string[]`(최대 200개, 호스트 접미사 일치)를 둔다.
팀 수집 기본 제외(§2.1 4번)는 코드 상수이며 이 목록에 들어가지 않는다(v1은 사용자가 풀 수 없다).
새 표가 필요 없고, 서버가 인제스트에서 같은 목록으로 재판정할 수 있으며, 같은 계정의 다른 기기와 맞춰진다.
`GET/PATCH /settings` 스키마에 필드 하나를 더한다(사용자별 값 — 1단계 §11 규칙 그대로).

---

## 5. API

1단계 §14 표에 더한다. 권한·오류 정책(비멤버 404, owner 전용 403)은 같다.

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| `PATCH` | `/workspaces/{id}` | owner | `{name?, collect_allowed?}`. `collect_allowed=false`로 바꾸면 그 팀의 열린 창을 모두 끝낸다(`disallowed`) |
| `GET` | `/workspaces` | 로그인 | 항목에 `collect_allowed`, `my_collect: {window_id, device_id, started_at, expires_at} \| null`(쿼리 `?device_id=`로 준 이 기기 것만) 추가 |
| `GET` | `/workspaces/{id}/collect` | member | `{allowed, my_windows: [window], collecting: [{user_id, name, picture, expires_at}]}` — `my_windows`는 이 팀의 **내 모든 기기**의 열린 창(S3), `collecting`은 지금 팀으로 수집 중인 멤버(투명성) |
| `POST` | `/workspaces/{id}/collect` | member | `{device_id, duration_minutes: 30\|60\|120\|240\|480 (기본 120), consent_version}` → `{window, server_now, ended_workspace_id}`. `consent_version`은 `user_settings.team_collect_consented`에 기록. `allowed=false`면 `409`. 같은 사람·기기의 다른 창은 끝내고 `ended_workspace_id`로 알림. 부분 유니크 위반(동시 시작)은 `409` |
| `DELETE` | `/workspaces/{id}/collect` | member | 쿼리 `?device_id=&reason=stop\|pause\|browser_restart\|account_switch`(본문 없음). `device_id`를 빼면 이 팀의 내 모든 창을 끝낸다(S3). 열린 창이 없어도 `204`(멱등) |
| `GET` | `/workspaces/{id}/collect/windows/{window_id}/sessions` | 창 주인 | 끝날 때 돌아보기(§1.4-4): 그 창의 방문으로 만들어지거나 이어진 **내** 세션. 창이 없거나 남의 창이면 `404`(존재를 알리지 않음) |
| `POST` | `/workspaces/{id}/collect/windows/{window_id}/withdraw` | 창 주인 | 남은 방문 빼기(M2). 창 행을 `FOR UPDATE`로 잠근다. **창이 아직 열려 있으면 같은 트랜잭션에서 창도 끝낸다(S'3, 사유 `stop`, 응답 `window_closed: true`)** — 배지는 `팀`인데 이후 방문이 모두 개인이 되는 어긋남을 막는다. `withdrawn_at = now()`, `collect_window_id = 이 창`인 내 이벤트 중 **`session_events`에 묶이지 않은 것**의 `workspace_id`·`collect_window_id`를 NULL로. 응답 `{withdrawn_events, sessions: SessionDetail[], window_closed}` — `sessions`는 그새 세션이 된 내 수집 세션(돌아보기 목록 갱신용). 멱등. 남의 창은 `404` |
| `POST` | `/workspaces/{id}/collect/sessions/{session_id}/restore` | 세션 주인 | 돌아보기 되돌리기(N1, §3.3). 공유 행 + `collect_workspace_id`를 한 트랜잭션에서 되돌린다. 세션의 모든 방문이 이 팀·이 사람의 창(`started_at ≥ joined_at`) 방문일 때만 — 개인 방문이 섞였거나 멤버십·`joined_at`·비흡수 조건이 깨졌으면 `409`, 남의 세션 `404`. 성공 `204` |

- `POST /events`: 이벤트마다 선택 필드 `workspace_id: string | null`, `collect_window_id: string | null`(S'1, 둘 다 있어야 팀 판정. 기존 `window_id`는 브라우저 창 번호라 이름을 달리한다). 응답에 `team_accepted`, `team_downgraded`, `window_closed`.
  `device_id`는 지금도 배치·이벤트에 있다. 창 판정은 이벤트의 `device_id or 배치 device_id`로 한다.
  이미 있는 id는 `on_conflict_do_nothing`이라 재전송으로 팀 표시를 바꿀 수 없다 — 바꾸는 길은 `withdraw`뿐이다.
- `GET/PATCH /settings`: `team_collect_excluded_domains`.
- `POST /sessions/merge` 등 병합: 스트림이 다르면 `409`(§3.3).
- 팀 세션 목록·검색·Ask·읽기 경로: **바꾸지 않는다.** 팀 수집 세션은 공유 행으로 들어오므로 1단계 경로가 그대로 보여 준다.
  `SessionDetail`에 `collect_workspace_id`를 소유자에게만 채우고(팀원에겐 `null` — 다른 팀 정보 누출 방지, 1단계 §14.3과 같은 원칙),
  팀원 응답에는 대신 `collected: true`(그 팀으로 수집된 세션인지)만 준다.

### 5.1 확장 동기화가 팀 표시를 싣는 방식

- 로컬 큐 이벤트에 `workspaceId: string | null`, `collectWindowId: string | null`을 더한다(`accountId`처럼 방문 시점에 고정. 기존 `windowId`는 브라우저 창 번호). `toWire`가 `workspace_id`·`collect_window_id`로 싣는다.
- 팀 창 상태는 **`chrome.storage.session`**의 `orbit:teamCollect` = `{ [accountId]: {workspaceId, windowId, expiresAt, clockOffsetMs} }`(M1).
  계정별 동의(`orbit:collectionConsent`)와 같은 모양이다. SW 재시작에는 남고 브라우저 재시작에는 지워진다. 계정을 섞지 않는다.
  끄기·만료·계정 전환·로그아웃 때 이 키를 **먼저** 지우고 서버 `DELETE`는 그다음(실패 시 재시도 알람, §1.3).
- 판정은 방문 시점의 로컬 상태로 하되, 서버 시각으로 보정한 만료 시각을 지나면 로컬에서도 `null`. 서버가 최종 판정한다(§2.2).
- 서버에서 창이 끝난 경우(owner 허용 끄기·다른 기기에서 끄기·탈퇴): 인제스트·`withdraw` 응답의 `window_closed: true`이거나 주기 동기화 때
  `GET /workspaces`의 `my_collect`가 비어 있으면 확장이 로컬 상태를 지우고 배지를 끈다.
- 드레인은 지금처럼 계정 단위다. 한 배치에 개인·팀 이벤트가 섞여도 서버가 이벤트마다 판정하므로 따로 보낼 필요가 없다.
- 끝날 때 돌아보기:
  - 세션의 `팀에서 빼기` → 1단계 `DELETE /workspaces/{id}/sessions/{sid}`. 서버가 `collect_workspace_id`도 비운다(§3.3).
  - `남은 방문도 모두 빼기` → ① 그 창의 로컬 `pending`·`syncing` 이벤트를 `workspaceId = null`로 ② 서버 `withdraw` 호출
    ③ 응답의 `sessions`를 목록에 더해 보여 준다. ①만으로는 전송 중 배치(응답 유실 후 재전송)를 못 고치므로 ②가 필수다.
    ② 실패 시 재시도 알람으로 다시 보내고, 성공 전까지 돌아보기 카드에 "아직 빼는 중"을 남긴다.

---

## 6. 권한과 보안 불변 조건

### 6.1 1단계 불변 조건 7개 — 유지

(`company/tasks/2026-10-20-team-workspace-security-review.md`)

1. 읽기 = 내 세션 또는 내 팀에 아직 멤버인 사람이 공유한 비흡수 세션 → **그대로.** 팀 수집 세션도 공유 행으로만 보인다.
2. 쓰기는 소유자만 → **그대로.** 팀 수집 세션의 소유자는 방문한 사람. `_owned_session`을 넓히지 않는다.
3. 팀 검색·Ask SQL은 공유 세션 id로 좁힌다 → **그대로.** 팀 스트림 방문이라도 세션에 묶이기 전(pending)에는 팀 검색에 안 나온다.
4. 비멤버 404 / owner 작업 403 / owner 탈퇴 409 → 새 경로에도 같은 규칙. `collect` 경로의 비멤버는 404, `collect_allowed` 변경은 owner(403).
5. 공유자 탈퇴·추방 시 공유 즉시 무효(경합 포함) → **그대로 재사용.** 반영 경합으로 생긴 공유 행도 읽기 조인이 거른다.
6. 초대 코드 규칙 → 영향 없음.
7. 팀원 응답에 폴더 id·다른 팀 공유 여부·이메일 없음 → `collect_workspace_id`도 팀원에겐 `null`(§5).
   더해서(S7) **팀원 응답에는 `referrer_url`·`previous_event_id`를 내보내지 않는다**(지금도 `SessionEventItem`에 없음 —
   앞으로 필드를 더할 때도 지킨다). 팀원 응답의 페이지 주소는 쿼리를 지운다(§7.3).

### 6.2 2단계에 더하는 불변 조건

8. **팀 표시는 서버가 인제스트 SQL에서 준다.** 창(사람·기기·시간)·멤버십·`collect_allowed`·민감/제외 판정을 하나라도 어기면 개인으로 저장.
9. **개인 스트림 방문은 팀 수집 세션에 붙지 않고, 팀 스트림 방문은 다른 스트림 세션에 붙지 않는다**(후보 SQL 조건 + 반영 시 대상 재확인).
10. **끈 뒤에는 팀으로 가지 않는다.** 서버 수신 시각 기준 판정(§2.2)으로 창 밖이거나 애매하면 개인. 다른 기기의 방문도 개인.
11. **시크릿 창은 어디에도, 민감 URL·로그인 호스트/경로 패턴·팀 수집 기본 제외(웹메일·메신저·검색 결과)·제외 목록은 팀 스트림에 없다**(확장 + 서버 이중).
12. **스트림이 다른 세션끼리는 병합하지 않는다**(자동·수동·제안 모두 `collect_workspace_id` 직접 비교).
13. **로컬의 끄기·브라우저 재시작·계정 전환·로그아웃은 서버 응답과 무관하게 즉시 팀 표시를 멈춘다**(M1: `chrome.storage.session`, 로컬 먼저 삭제).
14. **빼기는 서버에서 대기 중인 방문까지 개인으로 돌리고, 그 뒤 도착하는 그 창의 방문도 팀으로 받지 않는다**(M2: `withdraw` + `withdrawn_at`, 창 행 잠금으로 인제스트와 직렬화).
15. **현재 멤버십 이전에 열린 창은 무효다**(M3: `window.started_at ≥ workspace_members.joined_at`, 인제스트·반영·되돌리기 모두).
16. **팀에 보이는 세션의 스트림은 공유 경로와 맞는다**(N1): 수집 세션의 공유 해제는 `collect_workspace_id`를 함께 비우고, 되돌리기는
    둘을 함께 되살리며 멤버십·`joined_at`이 깨졌으면 막는다. 공유 행만 되살아난 "팀에 보이는 개인 스트림 수집 세션"은 생기지 않는다.
17. **팀 판정은 이벤트가 실은 창 하나로만 한다**(S'1). 서버가 시각으로 다른 창을 골라 주지 않는다.

### 6.3 탈퇴·추방·팀 삭제·모드 끄기 때 데이터

| 사건 | 열린 창 | 이미 만든 팀 수집 세션 | 아직 세션화 안 된 팀 스트림 방문 |
|---|---|---|---|
| 모드 끄기(멤버 정지·만료) | 끝남 | **그대로 공유됨**(켜 둔 동안 동의한 기록). 돌아보기에서 뺄 수 있음 | 창 안의 방문이면 그대로 팀 스트림. `withdraw`로 개인으로 돌릴 수 있음 |
| 돌아보기 빼기(`withdraw`) | 끝남(열려 있었으면 이때 끝냄, S'3) | 세션별로 공유 해제(+ 스트림 해제) | 세션에 묶이지 않은 것은 개인으로. 이후 그 창의 방문도 개인 |
| 돌아보기 되돌리기 | 그대로(끝난 창은 다시 열지 않음) | 공유 행 + `collect_workspace_id`를 함께 되살림. 멤버십·`joined_at`이 깨졌으면 409 | 영향 없음(빼기로 개인이 된 방문은 개인 그대로) |
| owner가 남의 수집 세션 공유 해제 | 그대로 | 그 세션만 공유 행 삭제 + `collect_workspace_id` 비움(개인 세션) | 영향 없음 |
| owner가 허용 끄기 | 모두 끝남(`disallowed`) | 그대로 공유됨 | 그대로(창 안이었음) |
| 탈퇴·추방 | 끝남(`left`/`removed`) | 1단계대로 공유 행 삭제 → 즉시 안 보임. `collect_workspace_id`를 비워 개인 세션이 됨 | `exploration_events.workspace_id`를 비워 개인 스트림으로. 다시 가입해도 옛 창은 `joined_at` 조건으로 무효(불변 조건 15) |
| 팀 삭제 | 끝남(`team_deleted`) | 위와 같음(모든 멤버) | 위와 같음 |
| 계정 삭제 | 지금 서버에 사용자 삭제 경로가 없다. 생기면 위 탈퇴 정리를 먼저 하고 지우는 순서를 따른다 | — | — |

정리 순서(S'2, 탈퇴·추방·팀 삭제 공통, 한 트랜잭션): **① 해당 창 행을 `FOR UPDATE`로 잠그고 닫는다**(`ended_at`, 사유) →
② `exploration_events.workspace_id·collect_window_id = NULL` → ③ `sessions.collect_workspace_id = NULL` → ④ `workspace_sessions` 삭제.
팀 삭제는 이어서 ⑤ `workspace_collect_windows` → ⑥ `workspace_members` → ⑦ `workspaces`를 지운다(FK에 ON DELETE가 없는 1단계 원칙).
창을 먼저 잠가야 진행 중인 인제스트(`FOR SHARE`)가 커밋할 때까지 기다린 뒤 ②가 그 행까지 비운다. 순서를 거꾸로 하면 누출은
반영 ①이 막지만 낡은 `workspace_id`가 남는다.

### 6.4 진행 중 요청에서의 권한 철회 경합

교훈 적용: **외부 API(임베딩·LLM)를 기다리기 전에 얻은 멤버십·스트림 정보는 그 뒤 SQL의 권한 근거가 될 수 없다.**

| 지점 | 대기 전 | 대기 뒤 반영 SQL에서 다시 볼 것 |
|---|---|---|
| 인제스트 | (대기 없음) | 같은 트랜잭션에서 창 행 `FOR SHARE` 잠금 → 창·빼기·가입 시각·멤버십 판정 후 INSERT. 탈퇴 커밋과 겹쳐 오래된 팀 표시가 저장돼도 아래 두 단계가 거른다 |
| 빼기(`withdraw`)와 인제스트 | — | `withdraw`는 창 행 `FOR UPDATE`. 먼저 시작한 인제스트가 커밋할 때까지 기다린 뒤 UPDATE하므로(READ COMMITTED에서 새 문장은 커밋된 행을 본다) 그 인제스트의 팀 표시도 비운다. 나중에 시작한 인제스트는 `withdrawn_at`을 보고 개인으로 저장 |
| 빼기와 배치 반영 | claim 시점의 `workspace_id` | 반영이 ③에서 이벤트 열을 다시 보므로 `processing` 중에 빠진 방문은 개인으로 반영. 반영이 먼저 커밋돼 세션이 됐으면 `withdraw` 응답 `sessions`에 나와 사용자가 공유를 푼다 |
| 배치 claim → 임베딩 → 의도 분석(LLM) | claim한 이벤트의 `workspace_id`, 후보 세션 목록 | `apply_assignments` 트랜잭션에서: ① 그 사람이 아직 팀 멤버이고 그 방문의 창이 `joined_at` 이후에 열렸는가 ② append 대상 세션의 `collect_workspace_id`가 여전히 그 팀인가(UPDATE의 WHERE에 조건) ③ 이벤트의 `workspace_id`가 아직 그 팀인가(탈퇴 정리·빼기가 비웠을 수 있음, 다시 SELECT). 하나라도 아니면 개인 스트림으로 반영, 공유 행을 넣지 않는다 |
| 공유 행 INSERT와 탈퇴의 경합 | — | 반영이 멤버십을 본 직후 탈퇴가 커밋되면 공유 행이 남을 수 있다. 1단계 불변 조건 5의 읽기 조인(공유자 멤버십)이 거른다. 다음 정리(탈퇴 재실행 없이)는 필요 없다 — 보이지 않는 행이다 |
| 재요약(`refresh_session_ai`) | 세션 id | 재요약은 주인 세션의 요약만 바꾼다. 팀에 보이는지는 읽기 때 판정하므로 철회 후 재요약 결과가 팀에 새지 않는다 |
| 끝날 때 돌아보기 | 창 id | 조회 SQL이 본인 소유 세션만 돌려준다 |

**보장 범위(명시)**: 각 SQL 스냅샷 시점까지다. 탈퇴 커밋 이전에 시작된 팀 목록 조회·Ask 생성·스트리밍이 이미 읽은 자료는
회수하지 않는다(1단계 §14.3과 같음).

### 6.5 계정 전환

- 이미 있는 것: 계정별 로컬 큐(`accountId`), 계정별 동의, 이전 계정 드레인(`drainPreviousAccount`), 계정 바뀌면 탭 상태 초기화.
- 더할 것:
  - `orbit:teamCollect`(`chrome.storage.session`)를 계정 키로 둔다. 계정이 바뀌면 새 계정의 창만 읽는다(없으면 개인).
  - `handleAccountChange` 때 이전 계정의 로컬 창 상태를 **먼저 지우고**, 그다음 이전 계정 토큰으로 `DELETE`(사유 `account_switch`). 드레인과 같은 잠금 안에서.
  - 확장의 Ask 대화 저장소(`entrypoints/shared/hooks/useAskConversation.ts`, 전역 zustand)는 이미 계정·범위가 바뀌면 비운다.
    쿼리 캐시만 지우면 팀 Ask 대화에 담긴 근거가 남으므로, 탈퇴·추방·팀 삭제로 범위가 개인으로 돌아갈 때도 비워지는지를 누출 경로로 시험한다(§9.4).
    실패해도 서버 판정이 사람·기기에 묶여 있어 새 계정의 방문은 이전 계정 팀으로 갈 수 없다(토큰이 다르므로 `user_id`가 다르다).
  - 이전 계정의 열린 방문은 이전 계정의 `workspaceId`를 단 채 마감한다(그 사람이 켰던 창 안의 방문).
- E2E: B 계정으로 팀 수집 → C로 전환 → C의 방문이 B의 팀에도, B의 서버 이벤트에도 없는지.

---

## 7. 외부 AI 전송과 공개 문구

### 7.1 `AI_DISCLOSURE`와 팀 수집 동의 문구

외부 AI로 가는 범위는 **바뀌지 않는다**. 팀 수집 세션도 개인 세션과 같은 경로(의도 분석·요약·임베딩)로 한 번만 처리되고,
팀원의 팀 Ask는 1단계에서 이미 공유 세션 본문을 근거로 보낸다. 그래서 `AI_DISCLOSURE` 본문은 그대로 두고, **팀 수집 동의용
문구를 따로** 둔다(설정·수집 동의 화면은 개인 수집만 다루므로 섞지 않는다).

원칙은 `AI_DISCLOSURE` 주석과 같다: **실제 노출보다 좁게 읽히면 안 된다**(M4). 그래서 다음을 모두 밝힌다.
되돌릴 수 없음, 끈 뒤에도 남음, 나중에 들어온 팀원도 봄, 제목·요약 속 검색어, 민감 사이트의 실제 범위(좁음),
로그인 화면은 "주소로 보이는 것"만 뺌(전부 뺀다고 약속하지 않음).

```ts
export const TEAM_COLLECT_DISCLOSURE =
  '팀 수집을 켜 둔 동안 이 기기에서 연 페이지는 세션으로 묶여 지금과 나중에 들어올 팀원 모두에게 보여요. 팀원은 세션 이름·요약·페이지 제목·주소(쿼리 제외)·방문 시각과 내 이름을 보고, 제목과 요약에는 검색어가 남을 수 있어요. 수집을 꺼도 켜 둔 동안 모인 세션은 내가 빼기 전까지 팀에 남고, 팀원이 이미 본 것은 되돌릴 수 없어요. 팀 Ask는 본문 일부를 AI 서비스(Upstage·SKT A.X·LG EXAONE)로 보내요. 은행·증권·카드·결제·일부 공공·건강보험 사이트, 로그인·결제 주소로 보이는 페이지, 웹메일·메신저·검색 결과 페이지, 내가 뺀 사이트는 팀으로 보내지 않아요. 그 밖의 사이트는 제외 목록에 직접 넣어야 해요. 시크릿 창은 기록하지 않아요.';
```

- 민감 목록은 origin #24 뒤 은행·증권·카드·결제·정부 개인 서비스(정부24·홈택스 등)·건강보험만 남았다. SNS·쇼핑·업무 도구는
  팀으로 간다. 문구가 이 범위를 그대로 말하고 제외 목록으로 이어지게 한다.
- 민감 목록·기본 제외 목록이 바뀌면 이 문구도 함께 바꾸고 동의 버전을 올린다(§7.2).

### 7.2 동의 화면 (그 팀에서 처음 시작할 때, 계정마다)

- 제목: `‹팀 이름›으로 팀 수집을 시작할까요?`
- 팀원이 **보는 것**: 세션 이름·요약·페이지 제목·주소(쿼리 제외)·방문 시각, 내 이름·사진. **제목·요약 속 검색어.**
  지금 팀원뿐 아니라 **나중에 들어올 팀원도** 본다.
- **되돌릴 수 없는 것**: 팀원이 이미 본 것. 수집을 꺼도 모인 세션은 내가 `팀에서 빼기` 전까지 남는다.
- 팀원이 **못 보는 것**: 개인 기록(수집 꺼진 동안), 다른 팀, 내 폴더, 이메일(owner 제외), 이전 페이지 주소.
- 팀으로 **안 가는 것**: 은행·증권·카드·결제·일부 공공·건강보험 사이트, 로그인·결제 주소로 보이는 페이지, 웹메일·메신저·검색 결과
  페이지, 제외 목록(바로 편집 링크). "그 밖의 사이트는 제외 목록에 직접 넣어야 해요." 시크릿 창은 어디에도 기록하지 않는다("시크릿 창은 기록하지 않아요").
- **언제 꺼지는지**: 정한 시간이 지나거나, Chrome 창을 모두 닫거나 Chrome을 끝내면 꺼진다(S'4). 일시 정지·끄기는 띠와 칩에서.
- 시간 선택(기본 2시간) + 주 버튼 `팀 수집 시작` + 보조 `취소`.
- 동의 기록: `user_settings` `team_collect_consented: {workspace_id: {version, at}}`. 문구 버전이 바뀌면 다시 묻는다.

### 7.3 팀원 응답의 주소에서 쿼리 삭제 (결정됨, CTO 결정 3)

적용 기준: **팀 범위 응답이거나 조회자가 세션 주인이 아닌 응답**. 주소는 `scheme://host/path`만 남긴다(쿼리·프래그먼트 삭제).
민감 URL은 도메인만(Ask 프롬프트의 `ai_safe_url` 규칙과 맞춘다). 적용 경로(M5):

| 경로 | 위치 | 필드 |
|---|---|---|
| 공유 세션 단건 `GET /sessions/{id}`(팀원) | `api/sessions.py` `_to_detail(include_private=False)` | `tabs[].url` |
| 세션 방문 `GET /sessions/{id}/events`(팀원) | `api/sessions.py` events 경로 | `url` (`referrer_url`·`previous_event_id`는 원래 없음 — 불변 조건 7) |
| 세션 버전 `GET /sessions/{id}/versions`(팀원) | `api/sessions.py` | 주소 필드는 없음 — 요약 문장 속 주소는 아래 한계 |
| 팀 세션 목록 `GET /workspaces/{id}/sessions` | `api/workspaces.py` | `tabs[].url` |
| 팀 세션 검색 `GET /search?workspace_id` | `api/search.py` `_search_sessions_by_vector`(`include_private=workspace_id is None`) | `tabs[].url` |
| 팀 방문 검색 `GET /search?workspace_id&scope=memory` | `api/search.py` `_search_memory_events`·`_fetch_keyword_matched_events` | 방문 `url` |
| 팀 Ask `POST /ask/stream`(`workspace_id`) | `services/ask_service.py` SSE 근거 이벤트 | 근거 `url`·세션 `tabs[].url` |

- 구현은 한 함수(`event_filter`에 `teammate_url(url)`)를 두고 위 경로가 모두 그 함수를 거치게 한다. 시험은 경로마다
  `?q=비밀&token=…`이 붙은 방문으로 팀원 응답에 쿼리가 없는지 본다.
- **한계(문서·문구에 밝힘)**: 페이지 제목(예: "오사카 맛집 - Google 검색"), `search_query`에서 만든 키워드, LLM 요약과 버전 이력
  문장에는 검색어·쿼리 정보가 남는다. 검색 결과 페이지는 팀 수집 기본 제외(§2.1)라 팀 수집 세션에는 들어오지 않지만, 1단계 수동
  공유 세션에는 남을 수 있다.

---

## 8. 화면 흐름

대표 지시(2026-10-22): 첫 화면에 분명한 행동 유도 하나, 누를 수 있는 것은 동작 전 반응(hover·focus·press)과 결과 전환,
`prefers-reduced-motion`이면 움직임만 줄이고 상태 변화는 남긴다. 색은 기존 `orbit-*` 토큰과 팀 색(폴더 팔레트) 안에서만.

### 8.1 흐름

1. **새 탭 팀 범위 첫 화면**(수집 허용된 팀, 내가 수집 안 함): 머리 아래 주 버튼 `팀 수집 시작` 하나. 허용 안 된 팀이면
   owner에겐 `팀 수집 허용하기`, 멤버에겐 행동 대신 1단계 주 행동(`세션 공유하기`)을 유지하고 "owner가 허용하면 켤 수 있어요" 안내.
2. 누르면 동의 시트(§7.2, 처음만) → 시간 선택 → `시작`. 버튼은 누르는 순간 눌림 상태, 요청 중 스피너, 성공 시 시트가 닫히며
   머리 칩이 `팀 수집 중 · 1:59`로 자라나는 전환.
3. **켜진 동안**:
   - 확장 아이콘 배지 `팀`(배경 = 팀 색). 시작 순간 한 번 맥박(감소 모션이면 생략). 툴팁 `‹팀›으로 수집 중 · 남은 시간`.
   - 사이드패널 상단 띠: 팀 색 점 · `‹팀›으로 수집 중 · 1:42 남음` · `일시 정지` · `끄기`. 일시 정지면 `다시 시작`이 주 버튼.
   - 새 탭 머리 칩: 같은 정보, 누르면 팝오버(남은 시간·연장·정지·끄기·제외 목록·**내 다른 기기의 열린 창과 `모두 끄기`**).
     다른 기기에서 켜진 창이 있으면 칩에 `다른 기기에서 수집 중`도 보인다(S3).
   - 타임라인(개인 화면)의 팀으로 간 방문 행에 작은 팀 색 점. 사이드패널 개인 화면 개편이 아니라 상태 표시다(대표 범위 지시 준수 — 결함·필수 표시만).
4. **만료 10분 전**: 띠·칩이 `곧 꺼져요 · 연장`으로 바뀐다(색 변화 + 텍스트, 움직임 없음).
5. **끝날 때**: 돌아보기 카드(새 탭 팀 화면 상단 / 사이드패널 띠 자리) — `이번 팀 수집: 세션 N개` 목록, 세션마다 `팀에서 빼기`,
   보조 `남은 방문도 모두 빼기`(서버 `withdraw`, 진행 중이면 `빼는 중…`, 실패하면 재시도 표시), 주 버튼 `확인`.
   빼면 행이 접히며 사라지는 전환과 되돌리기 토스트(5초). 되돌리기는 `restore`(N1)로 공유와 스트림을 함께 되살리며,
   조건이 깨졌으면 토스트가 "되돌릴 수 없어요"로 바뀐다. 그사이 노출은 없다.
6. **설정**(새 탭 설정): `팀 수집` 절 — 기본 제외(웹메일·메신저·검색 결과, 잠금 표시·해제 불가), 제외 사이트 목록(추가·삭제),
   기본 시간. owner는 팀 설정에 `팀 수집 허용` 스위치.

상태: 시작 요청 loading(버튼 스피너), 실패 error(시트 안 "시작하지 못했어요. 다시 시도"), 수집 중 팀 세션 empty("팀으로 모인
세션이 아직 없어요. 페이지를 열면 몇 분 안에 세션이 생겨요"), 서버 연결 끊김 시 칩에 `연결 안 됨 · 다시 연결되면 보내요`(늦게 도착한 방문은 서버가 §2.2 늦은 도착 규칙으로 판정 — 끝 직전 5분은 개인).
시작 요청이 실패하면 로컬 상태를 만들지 않는다(창 없이 팀 표시를 붙이지 않음).

### 8.2 IA에 바뀌는 곳 (통합 뒤 `IA.md`에 옮길 것)

- §0 새 탭 홈·아틀라스 "팀 범위": 첫 화면 주 행동 `팀 수집 시작`, 머리 칩, 끝날 때 돌아보기 카드, 수집 중인 멤버 표시.
- §1 사이드패널 "전역 내비게이션": 상단 수집 띠. "타임라인": 팀으로 간 방문 표시. "설정 > 팀": owner `팀 수집 허용`.
- 새 탭 설정: `팀 수집` 절(제외 목록·기본 시간).
- 확장 아이콘: 배지 상태(신규 항목).
- `UserScenarios.md`: "회의 전 2시간 팀 조사", "끄는 걸 잊고 쇼핑", "탈퇴한 동료의 기록" 시나리오 3개.

---

## 9. 시험 계획

### 9.1 서버 단위·통합 (pytest, 외부 API 대역)

- 인제스트 판정: 창 안/밖, 다른 기기, 멤버 아님, `collect_allowed=false`, 민감 URL(#24 목록 기준 정부24 ↔ 공지성 `.go.kr`),
  로그인 호스트 패턴(`accounts.google.com`, `login.microsoftonline.com`, `github.com/session`), 기본 제외(웹메일·메신저·검색 결과),
  제외 목록 접미사 일치, 응답 `team_accepted/downgraded`.
- 시각 판정(S1): 창 열린 동안 도착(시작 직전·직후), 늦게 도착(끝 5분 전·4분 전·끝 직후), 미래 시각(`received_at + 5분` 초과) → 손으로 쓴 기대값.
- 재가입(M3): 창 → 탈퇴 → 재가입 → 옛 창 시간의 방문 인제스트 → 개인. 반영 단계에서도 같은 조건(탈퇴·재가입이 LLM 대기 중에 일어남).
- 빼기(M2): 서버 `pending` → `withdraw` → 개인. `processing` 중 `withdraw` → 반영이 개인으로. 이미 세션이 된 것은 응답 `sessions`에.
  같은 id를 `workspace_id=null`로 재전송해도 팀 표시는 `withdraw` 전까지 그대로이고 `withdraw` 뒤 개인(`on_conflict_do_nothing` 확인).
  `withdraw` 뒤 도착한 그 창의 방문은 개인. 남의 창 `withdraw`·돌아보기 → `404`.
- 빼기와 인제스트 경합(PostgreSQL 실DB 시험): 인제스트 트랜잭션이 창 행을 잠근 채 멈춘 사이 `withdraw` 시작 → 인제스트 커밋 → `withdraw`가 그 행도 비우는지.
- 창: 시작(최대 8h 자름, `server_now` 포함)·같은 기기 다른 팀 시작 시 이전 창 종료·동시 시작 두 건 → 열린 창 하나(부분 유니크, S2)·
  만료된 열린 창을 `expired`로 닫고 새로 시작·정지 멱등·`device_id` 없는 정지가 내 모든 기기 창 종료(S3)·허용 끄기 시 전부 종료·비멤버 404·owner 전용 403.
- 배치 스트림: 개인·팀 이벤트가 같은 사람에게 섞여 있을 때 claim이 한 스트림만, 후보 SQL이 다른 스트림 세션 제외(Qdrant 대역이
  다른 스트림 id를 돌려줘도), 새 세션 `collect_workspace_id`와 공유 행 생성.
- 경합(플레이북: 외부 호출 대기 지점에서 철회): 의도 분석 대역 안에서 탈퇴를 커밋 → 반영이 개인으로 내려가고 공유 행·팀 세션 append 없음.
  세션·방문·생성 입력(요약 프롬프트) 각각 확인. 임베딩 대기 중 탈퇴도 같은 시험.
- 탈퇴·팀 삭제 정리: 이벤트·세션 열 비움, 창 종료, FK 순서(삭제 오류 없음).
- 공유 해제: 공유한 사람·owner 어느 쪽이 풀어도 `collect_workspace_id`가 비고, 그 뒤 팀 방문이 붙지 않는다.
- 되돌리기(N1): **빼기 → 되돌리기 → 개인 방문 → 배치** 순서에서 그 세션에 개인 방문이 붙지 않는다(후보 SQL이 스트림으로 거름).
  되돌리기 뒤 `collect_workspace_id`와 공유 행이 함께 있다. 탈퇴·재가입 뒤 되돌리기, 흡수된 세션 되돌리기 → 409. 남의 세션 → 404.
  보호 코드 대조: `restore`가 공유 행만 넣게 바꾸면 위 시험이 실패해야 한다.
- 창 지정 판정(S'1): 같은 기기에 창 1(정지)·창 2(다시 시작)가 있을 때 `window_id=창1`인 방문은 시각이 창 2에 들어가도 창 1로만 판정되고,
  창 1 `withdraw` 뒤 개인. 남의 창·다른 팀·다른 기기의 `collect_window_id` → 개인.
- `withdraw` on 열린 창(S'3): 창이 함께 끝나고 `window_closed: true`. 정리 순서(S'2): 인제스트가 창 행을 잡은 채 멈춘 사이 탈퇴 → 인제스트 커밋 뒤 탈퇴가 그 행의 `workspace_id`까지 비움(실DB).
- `window_closed`(S'5): 제외 목록 때문에만 강등된 응답은 `window_closed: false`.
- 병합(S4): 다른 스트림 수동 병합 409, 병합 제안·자동병합에서 제외 — **공유가 풀렸지만 스트림 열이 남은 경우를 만들어**(보호 코드 대조) 확인.
- 응답 필드: 팀원 응답 `collect_workspace_id = null`, `collected` 값, `referrer_url`·`previous_event_id` 없음(S7).
- 쿼리 삭제(§7.3): 표의 7개 경로마다 `?q=…&token=…` 방문으로 팀원 응답에 쿼리 없음, 주인의 개인 범위 응답은 원본 유지.
- 마이그레이션 러너 멱등, 인덱스(부분 유니크 포함) 생성.
- 보안 리뷰어 방식 대조: 판정 코드를 잠시 지웠을 때 위 시험이 실패하는지(소스 변경은 커밋 안 함). 불변 조건 17개 각각.

### 9.2 확장 단위 (vitest)

- 판정 함수: 동의 없음·시크릿·창 없음·만료(서버 시각 보정)·민감·로그인 호스트·기본 제외·제외 목록·리다이렉트로 로그인 화면 이동 시 재판정. 팀 이벤트에 `windowId`가 실린다(S'1).
- 마지막 창 닫기(S'4): `windows.onRemoved`에서 남은 일반 창 0 → 로컬 상태 삭제가 서버 `DELETE`보다 먼저. 창이 남아 있으면 유지.
- `window_closed: true` 응답에만 로컬을 끄고, `team_downgraded`만 있는 응답에는 끄지 않는다(S'5).
- 제목 재판독(S5): 팀 표시 이벤트는 `onCommitted` 제목을 쓰지 않고, 본문 부착·제목 변경 때 주소가 같을 때만 채운다.
- 상태 저장(M1): `orbit:teamCollect`가 `chrome.storage.session`에만 있다(`local`에 없음). 끄기·만료·계정 전환·로그아웃에서
  서버 `DELETE`가 실패(대역이 거부)해도 로컬 상태가 먼저 지워지고 다음 방문이 개인이다. 실패한 `DELETE`는 재시도 알람에 걸린다.
- `toWire`가 `workspace_id`를 싣는다. 계정별 분리, 계정 전환 시 이전 창 DELETE 호출.
- 돌아보기 빼기: 로컬 `pending`·`syncing` 이벤트 표시 해제 + `withdraw` 호출, 실패 시 재시도.
- `onStartup`에서 창 종료. 만료 시 배지 제거. manifest 산출물에 `incognito: 'not_allowed'`.
- 화면: 주 버튼·띠·칩·돌아보기 카드의 loading/empty/error/success, 키보드 조작, 감소 모션.

### 9.3 실제 서버 E2E (계정 둘·셋, 크롬 프로필별, 개발 DB 아닌 시험 DB)

계정 A(owner), B(member), C(비멤버 또는 같은 브라우저 전환용).

1. A가 허용 → B가 2시간 시작 → 배지·띠·칩 확인.
2. B가 일반 페이지 5개 → 배치 → A의 팀 화면에 B 소유 세션이 보인다. 주소에 쿼리가 없다.
3. B가 민감 사이트(정부24)·로그인 화면(`accounts.google.com` 등)·웹메일·검색 결과·제외 사이트 방문 → 팀 화면·팀 검색·팀 Ask 근거에 0,
   B 개인 기록에는 있음. 시크릿 창은 확장이 돌지 않아 어디에도 없음.
4. **로그인 리다이렉트**: 로그인이 필요한 페이지를 열어 로그인 화면으로 튕김 → 팀에 0, 제목도 직전 페이지 제목이 아님.
5. B가 끄기 → 새 방문 → 팀에 0, 개인에 있음.
6. **오프라인에서 끈 뒤 다시 열기**: B 켬 → 네트워크 끊음 → 끄기(서버 `DELETE` 실패) → 브라우저 재시작 → 방문 → 네트워크 복구 → 팀에 0.
   끄지 않고 오프라인 재시작한 경우도 재시작 뒤 방문은 팀에 0.
7. **빼기 경합**: B가 방문 직후 끄고 돌아보기에서 `남은 방문도 모두 빼기` → 배치가 돈 뒤에도 A에게 0. 전송 중 응답을 끊어 재전송하게 만든 경우도 0.
8. B 다시 시작 → 방문 → 세션화 직전(의도 분석 대기 중) B 탈퇴 → A에게 노출 0.
9. 탈퇴 뒤 A의 팀 목록·검색·Ask·단건·이벤트·버전 조회 모두 B 것 0(404).
10. **재가입**: B가 오프라인 상태로 켠 채 방문을 쌓음 → (A가 B를 내보냄) → B 재가입 → B 온라인 → 쌓인 방문이 팀에 0.
11. **owner가 허용 끔**: B 수집 중 A가 허용 끔 → B의 배지가 다음 상태 확인 때 꺼지고, 그 뒤 방문은 팀에 0.
12. **owner가 공유 품**: A가 B의 수집 세션 공유를 품 → 그 세션이 팀에서 사라지고, B의 이후 팀 방문이 그 세션에 붙지 않음.
13. **팀 삭제**: B 수집 중 A가 팀 삭제 → B의 세션은 B 개인 기록에 남고, B의 대기 방문은 개인, B 확장의 Ask 대화가 비워짐.
14. 같은 브라우저에서 B → C 계정 전환 → C의 방문 URL이 B의 서버 이벤트·A의 팀 화면 어디에도 없음. B의 팀 Ask 대화가 C 화면에 없음.
15. 만료: 창 길이를 시험용으로 짧게(서버 설정) → 만료 뒤 방문 개인.
16. **남의 창 번호**: C(또는 A)가 B의 `window_id`로 돌아보기·`withdraw` 호출 → 404. A가 B의 세션으로 `restore` → 404.
17. **빼기 → 되돌리기 → 개인 방문**(N1): B가 돌아보기에서 세션을 빼고 되돌린 뒤, 수집을 끈 상태로 같은 주제 페이지 방문 → 배치 뒤 A의 팀 화면 그 세션에 새 방문 0.
18. **마지막 창 닫기**(S'4, macOS): B가 켠 채 Chrome 창을 모두 닫음(앱은 실행 중) → 새 창에서 방문 → 팀에 0, 배지 없음.

### 9.4 누출 검사 경로 목록

- 서버: 팀 세션 목록 `GET /workspaces/{id}/sessions` · 단건 `GET /sessions/{id}` · `/events` · `/versions` · 팀 검색 `GET /search?workspace_id`
  (세션·방문 둘 다) · 팀 Ask `POST /ask/stream`(SSE 근거·생성 프롬프트 대역 입력) · 추천(`/recommendations`) · 병합 제안 ·
  `GET /workspaces/{id}/collect`(수집 중인 멤버, 남의 기기 창은 주지 않음) · 돌아보기·`withdraw`(남의 `window_id` 404) · Qdrant 후보(대역) · 요약 프롬프트(대역 입력).
- 확장: 쿼리 캐시(계정·범위 전환 뒤) · **Ask 대화 저장소**(`useAskConversation`, 계정 전환·탈퇴·팀 삭제 뒤) · `chrome.storage.session`의 팀 상태(계정 전환 뒤 이전 계정 키) ·
  열린 새 탭(공유 해제·탈퇴 즉시 반영 — `fix/team-live-refresh`와 같은 경로).
- 사건별로 위 경로를 다시 돈다: 끄기, 오프라인 끄기 후 재시작, 빼기, 탈퇴, 재가입, owner 허용 끄기, owner 공유 해제, 팀 삭제, 계정 전환.
- 내보내기 경로는 지금 서버·확장에 없다. 생기면 이 목록에 더한다.

---

## 10. 구현 계획 — `feat/team-collect-mode` (확정)

- **시작점**: GitHub main 통합본(`chore/sync-origin-main`이 품질 회의를 거쳐 로컬 main에 들어간 뒤의 main). 로컬 main 옛 기준이나
  이 설계 갈래에서 시작하지 않는다. 통합이 끝나면 CTO가 맡긴다.
- **갈래**: 서버·확장 모두 `feat/team-collect-mode` 하나를 기준으로 한다. 동시에 일할 때는 하위 갈래(`feat/team-collect-mode-server`,
  `feat/team-collect-mode-ext`)를 따서 파일이 겹치지 않게 하고 CTO가 기준 갈래로 합친다. 0′(시크릿 창)은 결선 전 단독 수리라
  `fix/incognito-not-allowed`로 따로 간다.
- **계약 먼저**: 단계 1 시작 전에 §4·§5의 스키마·API·wire 필드(`workspace_id`, `collect_window_id`, `window_closed`)를 이 문서 기준으로 고정한다.
  바꿀 일이 생기면 문서를 먼저 고치고 보안 리뷰어에게 diff를 보인다.
- **검증 명령**: 백엔드 `node <Orbit>/company/scripts/locked.mjs python -m pytest -p no:asyncio`, 확장 `pnpm test`·`pnpm compile`·
  `node <Orbit>/company/scripts/locked.mjs pnpm build`. 고친 동작마다 고치기 전 실패 줄을 보고서에 남긴다.

| 단계 | 내용 | 담당 | 완료 조건 |
|---|---|---|---|
| 0′ | 시크릿 창 차단: manifest `incognito: 'not_allowed'` + 수집기 `tab.incognito` 검사(개인·팀 공통) | 배유나 | manifest 산출물 시험, vitest·tsc·build. 팀 수집과 별개로 결선 전 |
| 1 | 스키마: 열 4개(`exploration_events.workspace_id`·`collect_window_id`, `sessions.collect_workspace_id`, `workspaces.collect_allowed`), 표 `workspace_collect_windows`(`withdrawn_at`, 부분 유니크), 러너 인덱스 단계, 모델 | 한지석 | `tests/test_migrations.py`: 러너 멱등, 옛 스키마 DB 기동 시 열·인덱스 생성 |
| 2 | 창 API(시작·정지·`device_id` 없는 전체 정지·조회·돌아보기·`withdraw`(열린 창이면 함께 끝냄)·`restore`), `collect_allowed`, `GET /workspaces` 확장, 정리 규칙(창 먼저 닫는 순서, 탈퇴·추방·팀 삭제·공유 해제=스트림 해제) | 한지석 | §9.1 창·빼기·되돌리기(N1)·정리 시험, 404/403/409, 실DB 정리 순서 경합 시험 |
| 3 | 인제스트 판정: `collect_window_id` 창 하나로(S'1), 시각 규칙(S1), `joined_at`(M3), `withdrawn_at`, 창 행 `FOR SHARE`, 기본 제외·로그인 호스트·제외 목록 설정, 응답 `window_closed` | 한지석 | 경계 시험(손으로 쓴 기대값), 빼기·인제스트 실DB 경합 시험 |
| 4 | 배치: 스트림 claim, 후보 SQL·Qdrant 필터, 반영 재판정(①②③), 자동 공유, 병합 스트림 비교, 팀원 응답 쿼리 삭제(`teammate_url`, §7.3 7경로) | 한지석 | 대기 지점 철회 시험(세션·방문·프롬프트), 쿼리 삭제 7경로, 백엔드 전체 시험 |
| 5 | 보안 검토 1차(서버) | 류건호 | 불변 조건 17개 시험과 보호 코드 제거 대조(N1·S'1 포함), 결함 0 또는 수리 확인 |
| 6 | 확장 로직: 큐 필드(`workspaceId`·`windowId`), 판정(로그인 호스트·기본 제외·리다이렉트 재판정·제목 재판독), `chrome.storage.session` 상태, 로컬 먼저 끄기(정지·만료·계정 전환·로그아웃·onStartup·마지막 창 닫기), `window_closed` 처리, `withdraw`·`restore` 호출 | 배유나 | §9.2 시험, vitest·tsc·build |
| 7 | 화면: 첫 화면 주 버튼, 동의 시트(§7.1 문구·꺼지는 조건), 배지·띠·칩(다른 기기 창), 돌아보기(남은 방문 빼기·되돌리기 실패 표시), 설정(기본 제외 잠금·제외 목록) | 배유나 | 화면 품질 규칙(첫 화면 행동 유도·상호작용 애니메이션·감소 모션·네 상태·키보드), 헤드리스 스크린샷 |
| 8 | 실제 서버 E2E(§9.3 18단계)·누출 검사(§9.4 사건별 재순회) | 한지석 + 류건호 | 18단계 모두 통과 기록, 계정 셋·크롬 프로필별, 시험 DB |
| 9 | 품질 회의(협업팀 + 보안 리뷰어) → 문서 이관(data-model·api-design·IA·UserScenarios, DecisionLog·WorkLog는 CTO) → CTO 통합 | CTO | 회의록, 문서 갱신 |

- 병렬: 단계 1 계약 고정 뒤 1~4(서버)와 6(확장 로직)은 동시에 갈 수 있다(파일이 겹치지 않음). 7은 2의 API가 선 뒤, 8은 4·7 뒤.
- 동시 실행은 AGENTS.md §19 기준 최대 3개(서버·확장·보안 검토).
- 멈추고 올릴 것: 권한 모델·스키마를 이 문서와 다르게 바꿔야 할 때, 외부 비용이 드는 선택, 대표 데이터가 필요한 시험.

---

## 결정 사항 (CTO, 대표 위임 2026-10-22)

1. **세션화 방식** — 결정됨: A(멤버별 + 자동 공유). B는 권한 모델 변경(팀 소유 세션, 쓰기 권한)과 탈퇴 시 요약 이력 누출 문제로 기각.
2. **"보내기 전 대기"** — 결정됨: 넣지 않음. 만료·상시 표시·자동 제외·돌아보기(+ 서버 `withdraw`)로 대신하고, 되돌릴 수 없음을 동의 문안에 밝힌다.
3. **팀원에게 보이는 페이지 주소의 쿼리** — 결정됨: 지운다. 적용 경로와 한계는 §7.3.
4. **시크릿 창** — 결정됨: 개인 수집에서도 막는다(§2.4, 결선 전 별도 수리).
5. **창 길이** — 결정됨: 기본 2시간, 최대 8시간, 브라우저 재시작 시 꺼짐. owner별 설정은 사용 뒤 판단.
6. **팀 수집 기본 제외(S6)** — 결정됨: 웹메일·메신저·검색 결과 페이지는 팀 수집에서 기본 제외, v1은 해제 불가(개인정보 보호 우선).
