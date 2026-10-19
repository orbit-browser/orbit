// 민감 도메인/경로 판정 — "민감 도메인 제외" 설정이 켜졌을 때 본문 수집에서 제외할 대상.
// 탭 자체(제목·URL)는 유지하고 text_content/excerpt만 비워, 세션 복원은 그대로 가능하게 한다.

const SENSITIVE_DOMAIN_PATTERNS: RegExp[] = [
  // 은행/금융
  /(^|\.)(kbstar|shinhan|wooribank|nonghyup|nhbank|scbank)\.com$/i,
  /(^|\.)(kebhana|kakaobank|kbanknow|tossbank)\.com$/i,
  /(^|\.)(ibk|citibank|kdb)\.co\.kr$/i,
  /(^|\.)(kftc|kfcc|suhyup-bank)\.(or\.kr|co\.kr)$/i,
  // 증권/카드/보험
  /(^|\.)(mirae(asset)?|samsungfund|kbfg|nhqv|kiwoom|ebestsec|shinhaninvest)\.com$/i,
  /(^|\.)(kbcard|shinhancard|samsungcard|hyundaicard|lottecard)\.com$/i,
  // 정부/공공 — 공지·안내 페이지는 수집하고, 로그인 후 개인 기록을 다루는 서비스만 제외한다(2026-10-20 결정)
  /(^|\.)gov\.kr$/i, // 정부24
  /(^|\.)(hometax|wetax|minwon|epeople|efine|iros)\.go\.kr$/i, // 홈택스·위택스·민원24·국민신문고·교통민원24·인터넷등기소
  /(^|\.)ecfs\.scourt\.go\.kr$/i, // 전자소송
  // 결제
  /(^|\.)(paypal|stripe|tosspayments|inicis|kakaopay|payco)\.com$/i,
  /(^|\.)toss\.im$/i,
  /(^|\.)kcp\.co\.kr$/i,
  // 의료/건강
  /(^|\.)(nhis|hira)\.or\.kr$/i,
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\/(login|signin|sign-in|logon|auth)(\/|$)/i,
  /\/(checkout|payment|billing)(\/|$)/i,
  /\/(mypage|myaccount|account)\/(password|security|payment)/i,
];

export function isSensitiveUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  const host = url.hostname;
  if (SENSITIVE_DOMAIN_PATTERNS.some((re) => re.test(host))) return true;
  if (SENSITIVE_PATH_PATTERNS.some((re) => re.test(url.pathname))) return true;

  return false;
}
