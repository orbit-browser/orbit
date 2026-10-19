// 본문 텍스트 선택 규칙 — DOM 접근은 content script가 하고, 여기서는 어떤 텍스트를 쓸지만 정한다.

/**
 * Readability 결과가 이보다 짧으면 추출 실패로 보고 폴백한다.
 * 실측: 리멤버 채용공고는 엉뚱한 블록 211자, 네이버 블로그는 최상위 문서가 비어 0자.
 */
export const MIN_READABLE_LENGTH = 500;

/** 공백 연속·빈 줄을 접는다 — 원문 공백이 상한을 잡아먹지 않게(백엔드 split_passages와 같은 규칙). */
export function normalizeText(text: string): string {
  return text
    .replace(/​/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Readability 본문 → (짧으면) same-origin iframe 문서의 Readability 본문 → 화면 전체 텍스트 순으로 고른다.
 * 폴백 입력은 비용이 커서(iframe 파싱, innerText 레이아웃) 필요할 때만 호출한다.
 */
export function pickPageText(
  readableText: string,
  frameTexts: () => string[],
  bodyText: () => string,
): string {
  const main = normalizeText(readableText);
  if (main.length >= MIN_READABLE_LENGTH) return main;

  const frame = frameTexts()
    .map(normalizeText)
    .reduce((best, text) => (text.length > best.length ? text : best), '');
  if (frame.length >= MIN_READABLE_LENGTH) return frame;

  const body = normalizeText(bodyText());
  return body.length > main.length ? body : main;
}
