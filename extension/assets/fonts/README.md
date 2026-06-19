# Fonts

폰트는 현재 시스템 폰트 스택(`system-ui, "Noto Sans KR"`)으로 폴백합니다.

브랜드 일관성을 위해 Pretendard 를 번들하려면 이 폴더에 woff2 파일을 넣고
`entrypoints/sidepanel/styles/tailwind.css` 의 `@font-face` 로 등록하세요.
(원격 폰트 CDN 은 MV3 CSP 때문에 권장하지 않습니다 — 로컬 번들 사용.)
