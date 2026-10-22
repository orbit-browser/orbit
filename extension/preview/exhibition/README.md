# Orbit 결선 부스 현수막 7장

족자 현수막 950 × 2,380mm 5장과 455 × 2,380mm 2장이다.
확장 빌드에 포함되지 않는 로컬 미리보기이며 실제 사용자 기록을 쓰지 않는다.
행사는 2026-11-03~05, 출력 파일 확정 목표는 10월 30일이다.

```sh
cd extension
pnpm preview:ui --port 5203
# http://127.0.0.1:5203/preview/exhibition/
```

## 부스 배치

정면에서 왼쪽부터 아래 순서다. 중앙 세 장은 CHAOS → ORBIT → TECHNOLOGY다.
크기·순서·벽 구분은 `booth.ts`에서 관리한다.

| 번호 | 벽 | 내용 | 크기(mm) |
|---|---|---|---|
| 1 | 왼쪽 앞 | Orbit 브랜드 띠 | 455 × 2,380 |
| 2 | 왼쪽 | USE — 쓰는 법과 기록을 다루는 원칙 | 950 × 2,380 |
| 3 | 가운데 | CHAOS — 흩어진 탐색 | 950 × 2,380 |
| 4 | 가운데 | ORBIT — 세션과 페이지 갤러리 | 950 × 2,380 |
| 5 | 가운데 | TECHNOLOGY — 구조·실측·비교 | 950 × 2,380 |
| 6 | 오른쪽 | TEAM — 세션 공유·측정 방법 | 950 × 2,380 |
| 7 | 오른쪽 앞 | Orbit 브랜드 띠·QR 빈 칸 | 455 × 2,380 |

같은 벽의 기둥 간격은 기본 40mm다. 미리보기에서 벽 사이 160mm는 벽을 구분하기 위한 표시다.

## 보기

- `부스 7장 / 가운데 벽 / 1~7`: 전체 배치 또는 장별 확대.
- `화면 맞춤 / 25% / 50% / 100% / 실제 크기`: 100%는 1mm를 1px로 그린다.
  실제 크기는 CSS mm 기준이며 모니터에서 자로 잰 크기를 보장하지 않는다.
- `안전 여백`: 위·옆 50mm, 아래 80mm. 안내선은 인쇄에 나오지 않는다.
- `애니메이션`: CHAOS 카드의 움직임. `인쇄용 정적 모드`는 움직임과 갤러리 조작을 끈다.
- ORBIT 갤러리: 끌기·스와이프, 초점 상태에서 ← →, 카드 클릭, 위 막대의 ↑ ↓ 세션 전환.

보기 옵션은 주소에 남는다. 예: `?view=4&zoom=0.5&still=1&session=0&page=2`.
`session`은 `content.ts`의 `GALLERY_SESSION_IDS` 순서, `page`는 가운데 카드의 0부터 시작하는 번호다.
기존 3장 시안의 번호와 다르다: 예전 1/2/3은 이제 3/4/5다.

## 내보내기

```sh
node preview/exhibition/export.mjs
# PNG 7장(100dpi), 개별 PDF 7개, 혼합 크기의 7쪽 PDF 1개
node preview/exhibition/export.mjs --dpi 150 --panels 4,7 --no-pdf
node preview/exhibition/export.mjs --no-png
```

- 서버가 먼저 실행돼 있어야 한다. 포트 기본값은 5203(`--port`), Chrome 경로는 `CHROME` 환경변수로 바꾼다.
- 통합 PDF 병합은 Python의 `pypdf`를 사용한다(`python -m pip install pypdf`).
  Python 실행 경로는 `ORBIT_PYTHON`으로 지정할 수 있다. PNG만 출력할 때는 필요 없다.
- 결과는 git에서 제외된 `preview/exhibition/out/`에 생긴다.
  `orbit-banner-<번호>-<id>.pdf`가 장별 파일, `orbit-banners.pdf`는 선택한 장을 모은 검토용이다.
  일부 장만 내보내면 통합 PDF도 그 선택만 포함한다.
- `?print=1&panel=all` 또는 `?print=1&panel=1,4,7`은 인쇄 화면이다.
  PDF는 실제 크기의 페이지이며 455mm 두 장에는 별도 페이지 규격을 적용한다.
  내보내기는 PNG 픽셀 크기와 PDF 페이지 수·크기를 확인하고 다르면 실패한다.
- 혼합 폭을 한 번에 브라우저에서 PDF로 저장하면 내용이 자동 축소될 수 있다.
  최종 출력은 내보내기 명령을 사용한다. 개별 PDF를 소프트웨어 렌더링한 뒤,
  통합본은 검증된 파일을 다시 그리거나 축소하지 않고 병합한다.
- 글자는 벡터로, 원근 카드·흐림·그림자는 일부 래스터로 나온다. 글꼴은 Inter, Noto Sans KR,
  JetBrains Mono이며 Google Fonts에서 받는다. 로드 실패 경고가 있으면 출력하지 않는다.
- 출력소의 블리드·CMYK 요구는 아직 미확정이다. 현재 파일은 블리드 없는 재단 크기다.
  PDF를 실제로 렌더링해 글줄·겹침·화면 누락을 확인한 뒤 전달한다.

## 승인된 자산과 QR

- 타사 사이트 캡처·사진·로고를 쓰지 않는다. `demo.ts`와 `pages.tsx`의 가상 페이지,
  `.example` 주소와 코드로 그린 그림만 사용한다. `capture-shots.mjs`는 현수막에 필요 없다.
- Orbit 마크는 제품의 `public/orbit-mark.png`를 쓴다. 팀 이름은 Orbit, 팀원 이름은 넣지 않는다.
- 행사 로고는 대표의 마지막 지시에 따라 제외한다. 나중에 추가할 경우 `frame.tsx`에서 공통 배치를 검토한다.
- QR은 7번 띠에 **100 × 100mm** 빈 칸이다. 대표가 만든 QR 스티커를 붙이며 임의 주소·가짜 QR을 넣지 않는다.
- 경쟁 제품 이름은 비교 그래프의 텍스트로만 쓴다. 사이트 화면·로고 사용과 구분한다.

## 성능 숫자와 비교표

| 파일 | 용도 | 근거 |
|---|---|---|
| `metrics.json` | A–D 실측 숫자·조건·규모별 지연 | `test/exhibition-benchmark`의 `23bd77c`, `benchmarks/exhibition-2026/ef256-rerun/metrics.json` |
| `competitor_matrix.csv` | 직접 시험·문서 기준 기능 비교 | `docs/competitor-research`의 `41c57c4`, `benchmarks/exhibition-2026/competitor-trials/` |
| `orbit_trial.csv`, `orbit-ui-trial.md` | Orbit 실제 수집 UI 시험과 판정 제약 | `test/orbit-ui-trial`(제품 기준 `5aef732`), `benchmarks/exhibition-2026/orbit-ui-trial/` |
| `competitor_trials.csv` | 경쟁 제품 원본 판정 CSV의 동일 사본 | `docs/competitor-research`의 `benchmarks/exhibition-2026/competitor-trials/competitor_trials.csv` |
| `trial-highlights.ts` | 같은 부정 질문의 Orbit·로그인 Comet 비율 계산 | 위 두 실제 UI 시험 CSV |

숫자는 유한한 숫자이며 `status: "measured"`일 때만 표시한다. 그 밖에는 `TBD`.
숫자와 함께 `title`, `scope`, `note`, `method`도 바꿔 측정 범위가 어긋나지 않게 한다.

2026-10-20 재측정은 공개 URL 26개로 만든 합성 세션을 사용했다.
1만 세션의 골든셋은 Top-1 100%, 사전 동결한 새 표현 holdout은 리랭킹 끔 66.7%·켬 40%다.
holdout 88요청 중 공급자 429 오류 22건을 실패에 포함했다. 일반 사용자 정확도나 실제 1년 기록 시험이 아니다.
서버 지연은 HTTP·인증·화면 표시를 제외한다. 리랭킹 설정을 켰어도 골든셋의 실제 LLM 호출은 0회였다.

Orbit도 같은 URL·질문·방문 순서/체류 조건으로 실제 UI 시험을 완료했다.
정답 URL 포함 후보 3/6(그중 1건 답변 모순), 부정 거절 2/2, 첫 후보 복원은 목표 4/9와
다른 페이지 5개다. 일반 사용자 정확도나 깔끔한 작업 복원 성공률로 바꿔 쓰지 않는다.
Headless Chrome 확장 방식과 제주항공 403 등 콘텐츠 차이를 명시했다.
합성 검색 벤치마크와 분리하며 제품 간 속도 배수는 주장하지 않는다.

### 전면 배너에 선별한 강점

대표의 후속 요청으로 5번은 전체 비교표 대신 기록 없음 판별 비율을 강조한다.
`negative_garden`, `negative_piano`의 사전 고정 두 질문에 대해 Orbit 100%, Comet 50%,
차이 +50%p다. Comet은 `logged_in_mixed`·`Q` 행만 사용한다. 로그아웃·재시도·Chrome의
단순 빈 결과는 섞지 않는다. 판정 누락·중복·미측정이면 숫자를 표시하지 않고 오류를 낸다.

인쇄면에서 `(2/2)` 같은 분수 표기는 쓰지 않는다. 제목 옆에 소규모 시험임을 표시하고,
아래에 두 질문·각 1회와 실행/콘텐츠 차이를 적는다. 일반 검색 정확도나 전체 제품 우위로
확장하지 않는다. 서버 성능은 A/B/D를 표시한다. C의 골든/holdout 결과, 실패 결과와
전체 비교표는 원본 파일 및 이 문서에 그대로 남긴다.
