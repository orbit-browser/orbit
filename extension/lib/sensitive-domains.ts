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
  // 정부/공공
  /\.go\.kr$/i,
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

// 판정용 정규화 — 서버 event_filter._decoded와 같다. 이중 인코딩(%256C)까지 풀고
// 전각 문자(ｌ, ＠)를 반각으로 접는다. 깨진 인코딩은 그 부분만 남긴다(Python unquote와 같음).
function decodedForCheck(text: string): string {
  for (let i = 0; i < 5; i += 1) {
    const decoded = text
      .replace(/(%[0-9a-f]{2})+/gi, (run) => {
        try {
          return decodeURIComponent(run);
        } catch {
          return run;
        }
      })
      .normalize('NFKC');
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

export function isSensitiveUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  // 끝 점 호스트(hometax.go.kr.)와 인코딩한 경로(/%6Cogin/)도 같은 페이지다.
  const host = decodedForCheck(url.hostname).replace(/\.+$/, '');
  const path = decodedForCheck(url.pathname);
  if (SENSITIVE_DOMAIN_PATTERNS.some((re) => re.test(host))) return true;
  if (SENSITIVE_PATH_PATTERNS.some((re) => re.test(path))) return true;

  return false;
}
