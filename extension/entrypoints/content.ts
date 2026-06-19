export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // 골격 — 현재는 동작하지 않습니다.
    // 후속 단계: @mozilla/readability 로 페이지 본문을 추출해
    // background → 백엔드(임베딩/요약)로 전달합니다.
  },
});
