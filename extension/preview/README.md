# 새 탭·사이드패널 미리보기

확장을 설치하지 않고 새 탭(홈·아틀라스)과 사이드패널을 일반 웹 페이지로 띄운다. 화면 후보를 나란히 비교하거나, 실제 컴포넌트를 손으로 만져 볼 때 쓴다.

```sh
cd extension
pnpm preview:ui --port 5200                      # http://127.0.0.1:5200
PREVIEW_LABEL="A 기억 데스크" pnpm preview:ui --port 5201
```

- 합성 데이터(`fixtures.ts`)만 쓴다. 백엔드로 아무것도 보내지 않는다(`api-mock.ts`가 `fetch`를 가로챈다).
- 새 탭과 사이드패널은 같은 저장소를 쓴다. 한쪽에서 범위를 바꾸거나 세션을 공유하면 다른 쪽도 따라간다.
- 탭 열기·창 만들기는 실제로 열지 않고 아래쪽 안내로 보여 준다.
- "데이터 처음으로"는 미리보기 저장소를 지우고 다시 시드한다.
- 파비콘은 미리보기 서버가 합성 데이터의 도메인만 받아 온다. 확장 빌드(`pnpm build`)에는 이 폴더가 들어가지 않는다.
- 아틀라스 궤도 카드의 실제 페이지 화면은 `node preview/capture-shots.mjs`로 찍는다(새 임시 프로필의 헤드리스 크롬, 결과는 git에 올리지 않는 `preview/shots/`). 지어낸 주소는 같은 사이트의 실제 화면으로 대신 찍고, 안 찍힌 페이지는 회색 자리표시로 나온다.

## 주소 옵션 (같은 화면을 다시 열거나 스크린샷을 찍을 때)

- `/preview/?route=atlas&theme=dark&scope=w-capstone&panel=0`
  - `route=atlas`: 새 탭을 아틀라스로 연다(없으면 홈)
  - `theme=light|dark|system`, `scope=<팀 id>`(빈 값이면 개인 기록), `panel=0`: 사이드패널 숨김
  - 팀 id: `w-capstone`(졸업 프로젝트 팀, 내가 owner), `w-travel`(여행 동아리, 내가 member)
- `/preview/team.html?theme=dark`: 팀 설정과 공유 시트를 사이드패널 폭으로 나란히

헤드리스 크롬 스크린샷(대표의 화면을 건드리지 않는다):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir=/tmp/orbit-preview-shots --window-size=1440,900 --virtual-time-budget=15000 \
  --screenshot=home-dark.png "http://127.0.0.1:5200/preview/?theme=dark&panel=0"
```

Windows 에서는 크롬 경로만 다르다: `"C:\Program Files\Google\Chrome\Application\chrome.exe"`, 프로필 폴더는 `--user-data-dir=%TEMP%\orbit-preview-shots`.

새 파일을 만들면 미리보기 서버를 다시 띄워야 Tailwind 가 그 파일의 클래스를 만든다.

## 디자인 방향 시안

`/preview/mockups/` — 같은 합성 데이터로 홈·아틀라스·팀 범위를 조작해 보는 방향 시안 ①기록 보관소 ②탐색 표본 ③관측 장비. 시안의 글꼴은 Google Fonts 에서 불러온다(미리보기 전용. 확장에 들일 때는 로컬 번들로 넣는다).

## 결선 전시 현수막

`/preview/exhibition/` — 결선 부스의 족자 현수막 7장(950 × 2,380mm 5장 + 455 × 2,380mm 2장). 부스 배치 보기·확대·안전 여백·인쇄용 정적 모드·
인쇄 파일 내보내기(`node preview/exhibition/export.mjs`). 자세한 것은 `exhibition/README.md`.
