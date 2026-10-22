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

// ── 팀 수집 전용 판정 (docs/team-collect-mode.md §2.1) ─────────────────────
// 서버 event_filter.is_team_blocked_url 과 같은 값이다. 한쪽을 바꾸면 다른 쪽과 팀 수집 동의 문구 버전도 함께 바꾼다.
// 개인 수집에는 쓰지 않는다.

const LOGIN_HOST_PREFIXES = ['login.', 'accounts.', 'sso.', 'auth.', 'signin.'];
const LOGIN_PATHS: Record<string, string[]> = { 'github.com': ['/session'] };
const TEAM_EXCLUDED_HOSTS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.naver.com',
  'mail.daum.net',
  'web.whatsapp.com',
  'web.telegram.org',
  'app.slack.com',
  'teams.microsoft.com',
  'messenger.com',
];
const TEAM_EXCLUDED_PATHS: Record<string, string> = { 'discord.com': '/channels', 'instagram.com': '/direct' };
const TEAM_SEARCH_PAGES: Record<string, string[]> = {
  'search.daum.net': ['/search'],
  'm.search.daum.net': ['/search'],
  'm.search.naver.com': ['/search.naver'],
  'search.naver.com': ['/search.naver'],
  'html.duckduckgo.com': ['/html'],
  'search.yahoo.com': ['/search'],
  'www.ecosia.org': ['/search'],
};

/** 설정 화면이 잠금으로 보여 주는 기본 제외(해제 불가). */
export const TEAM_COLLECT_DEFAULT_EXCLUSIONS = [
  '웹메일 (Gmail·Outlook·네이버·다음 메일)',
  '메신저 (WhatsApp·Telegram·Slack·Teams·Discord·Messenger·Instagram DM)',
  '검색 결과 페이지 (Google·네이버·다음·YouTube·Bing·DuckDuckGo·Yahoo·Ecosia)',
  '로그인·결제 주소로 보이는 페이지',
  '은행·증권·카드·결제·일부 공공·건강보험 사이트',
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function underPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** 서버 `_search_param` 과 같은 검색엔진 결과 페이지(경로는 디코딩 전 값으로 본다). */
function isSearchResultPage(host: string, rawPath: string): boolean {
  if (/(^|\.)google\./i.test(host) && rawPath === '/search') return true;
  if (host === 'search.naver.com' && rawPath === '/search.naver') return true;
  if ((host === 'youtube.com' || host === 'www.youtube.com') && rawPath === '/results') return true;
  return (host === 'bing.com' || host === 'www.bing.com') && rawPath === '/search';
}

/** 팀 스트림으로 보내지 않을 주소인가. 판정할 수 없는 주소도 막는다(실패 시 닫힘). */
export function isTeamBlockedUrl(rawUrl: string, excludedDomains: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  const host = decodedForCheck(url.hostname).replace(/\.+$/, '').toLowerCase();
  if (!host) return true;
  const path = decodedForCheck(url.pathname);
  if (isSensitiveUrl(rawUrl)) return true;
  if (LOGIN_HOST_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  for (const [domain, paths] of Object.entries(LOGIN_PATHS)) {
    if (hostMatches(host, domain) && paths.some((p) => underPath(path, p))) return true;
  }
  if (TEAM_EXCLUDED_HOSTS.some((domain) => hostMatches(host, domain))) return true;
  for (const [domain, prefix] of Object.entries(TEAM_EXCLUDED_PATHS)) {
    if (hostMatches(host, domain) && underPath(path, prefix)) return true;
  }
  if (isSearchResultPage(host, url.pathname)) return true;
  if ((TEAM_SEARCH_PAGES[host] ?? []).some((p) => underPath(path, p))) return true;
  if ((host === 'duckduckgo.com' || host === 'www.duckduckgo.com') && url.searchParams.has('q')) return true;
  return excludedDomains.some((domain) => {
    const d = domain.replace(/^\.+|\.+$/g, '').toLowerCase();
    return d !== '' && hostMatches(host, d);
  });
}
