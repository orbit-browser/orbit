# AI Rookie 결선 전시 현수막 3장

세로형 현수막 3장(각 950 × 2,380mm, 나란히 2,850mm)을 브라우저에서 보고, 인쇄 파일로 내보낸다.
미리보기 서버 안의 독립 페이지다. 확장 빌드(`pnpm build`)에는 들어가지 않고, 앱 화면을 고치지 않는다.

```sh
cd extension
pnpm preview:ui --port 5203          # http://127.0.0.1:5203/preview/exhibition/
node preview/capture-shots.mjs       # 카드 속 페이지 화면(처음 한 번). 인쇄용은 SHOT_SCALE=1.5 를 붙인다
```

## 보기

| 조작 | 하는 일 |
|---|---|
| 보기 `세 장 / 1 / 2 / 3` | 나란히 보기, 한 장씩 확대 |
| 크기 `화면 맞춤 / 25% / 50% / 100% / 실제 크기` | 100% = 1mm 가 1px, 실제 크기 = 1mm 가 1mm |
| 간격 | 현수막 사이(부스 기둥 폭). 기본 50mm |
| 안전 여백 | 걸이·틀이 가릴 수 있는 테두리(옆·위 50mm, 아래 80mm). 인쇄에는 나오지 않는다 |
| 애니메이션 | 1번 카드가 천천히 떠다닌다. 2번 갤러리는 저절로 돌지 않는다(아틀라스와 같다) |
| 인쇄용 정적 모드 | 움직임·조작을 끄고 인쇄될 한 프레임만 |
| 페이지 화면 | 끄면 남의 사이트 화면 없이 회색 자리표시로 그린다 |

2번 갤러리: 끌기·스와이프, ← →(갤러리에 초점), 카드 누르기, 위 막대의 ↑ ↓ 로 세션 전환.
모든 옵션은 주소에 남는다 — 예: `?view=2&zoom=0.5&still=1&session=0&page=2`.
`page` 는 인쇄될 가운데 카드(0부터), `session` 은 `content.ts` 의 `GALLERY_SESSION_IDS` 순서다.

## 인쇄 파일

```sh
node preview/exhibition/export.mjs                 # PNG 3장(100dpi) + PDF 1개(3쪽, 950 × 2380mm)
node preview/exhibition/export.mjs --dpi 150 --panels 2 --no-pdf
```

- 결과: `preview/exhibition/out/`(git 제외). 서버가 떠 있어야 한다(`--port` 기본 5203).
- 인쇄 화면은 `?print=1&panel=all|1|2|1,3` 이다. 브라우저에서 열고 인쇄(PDF 저장)해도 쪽 크기가 950 × 2380mm 로 잡힌다.
- 현수막은 1px = 1mm 로 그리고 인쇄에서 3.78배(96/25.4) 키운다. 글자는 벡터로, 원근 카드·흐림·그림자는 래스터로 나간다.
- 글꼴(Google Fonts)을 못 불러오면 화면과 인쇄 맨 위에 빨간 경고 띠가 뜬다. 그대로 내보내지 말고 연결을 확인한다.
- PNG 는 크롬이 큰 그림을 한 번에 그리는 한계 때문에 GPU 메모리 한도를 올려 찍는다. 출력소에는 PDF 를 넘기고, PNG 는 눈으로 확인한다.
- 출력소에 넘기기 전에 재단 여분(블리드)과 색 공간(CMYK) 요구를 출력소에 확인한다. 이 페이지는 블리드 없이 재단선 크기로 그린다.

## 숫자와 비교표 바꾸기

| 파일 | 내용 | 원본 |
|---|---|---|
| `metrics.json` | Orbit 성능 A–D, 측정 조건 | 경쟁·벤치마크팀 `benchmarks/exhibition-2026/benchmark_results.csv` |
| `competitor_matrix.csv` | 과거 탐색 검색 기능 비교 | 같은 팀 `benchmarks/exhibition-2026/competitor_matrix.csv` (열: product, capability, value, basis, source_ids, checked_on) |

- 숫자는 `"status": "measured"` 이고 값이 숫자일 때만 그린다. 그 밖에는 `TBD`. 측정 조건 한 줄은 지표의 `note` 에 적는다.
- D 의 그래프는 `scaling` 에 `{ "sessions": 1000, "p50": …, "p95": …, "status": "measured" }` 를 넣으면 그 점만 그린다.
- 비교표는 CSV 를 그대로 덮어쓰면 된다. 제품·기능은 처음 나온 순서대로, 행과 열이 늘거나 줄어도 그린다.
  `value` 가 찾음·못 찾음·기능 없음이면 기호를 붙이고, 비었거나 TBD 면 시험 전, 그 밖의 값은 글자 그대로 쓴다.
  `basis` 에 "문서"나 "doc" 이 들어간 칸은 공식 문서 기준(†, 빗금)으로 따로 묶인다.
- 제품 사이 속도는 비교하지 않는다(조건이 다르다). 표는 기능 비교만 담는다.

## 자산

- 브랜드 마크: `extension/public/orbit-mark.png`(제품이 쓰는 것). 큰 크기로 쓰려면 벡터 원본이 필요하다.
- 글꼴: Inter · Noto Sans KR · JetBrains Mono(Google Fonts, 미리보기 전용). 제품 글꼴 스택의 Inter·Noto Sans KR 이다.
- 카드 속 화면: `capture-shots.mjs` 가 공개 웹페이지를 새 임시 프로필(로그인 없음)로 찍은 것. 쓰지 않을 화면은 `content.ts` 의 `EXCLUDED_SHOTS`.
- 세션·방문·요약: 미리보기 합성 데이터(`preview/fixtures.ts`). 실제 사용자 기록은 쓰지 않는다.

## 아직 비어 있는 자리

- AI Rookie 행사 로고, Orbit 팀 로고·이름, 체험 QR — 3번 아래 점선 칸. 파일을 받으면 넣는다.
- 3번의 성능 숫자와 비교표 값 — 측정·조사 결과가 오면 위 두 파일만 바꾼다.
- 인쇄물에 들어가는 남의 사이트 화면 — 쓸지 말지는 대표 결정. 끄면(`페이지 화면`) 자리표시로 나간다.
