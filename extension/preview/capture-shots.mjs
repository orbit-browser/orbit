// 미리보기 카드에 쓸 실제 페이지 화면을 찍는다 — fixtures.ts 에 있는 페이지 주소 전부.
// 새 임시 프로필(로그인·쿠키 없음)의 헤드리스 크롬으로 찍어서 내 계정 화면이 섞이지 않는다.
// 결과는 preview/shots/(git 에 올리지 않는다). 미리보기 서버가 index.json 을 읽어 카드에 붙인다.
//   node preview/capture-shots.mjs            (CHROME=<크롬 경로> 로 바꿀 수 있다)
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const CHROME =
  process.env.CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'google-chrome');
// 헤드리스 표시가 붙은 UA 를 막는 사이트가 있어 보통 크롬 UA 로 찍는다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * 예시 데이터의 주소는 지어낸 것이 많아(없는 글·영상) 그대로 찍으면 오류 화면이 나온다.
 * 그런 페이지는 같은 사이트의 실제 화면(첫 화면·검색 결과)을 대신 찍는다. 카드의 키는 원래 주소다.
 */
const ALTERNATE = {
  'https://flight.naver.com/flights/domestic/GMP-CJU': 'https://flight.naver.com/',
  'https://blog.naver.com/jejutrip/223101': 'https://section.blog.naver.com/Search/Post.naver?keyword=제주%203박%204일%20동선',
  'https://github.com/qdrant/qdrant/discussions/2416': 'https://github.com/qdrant/qdrant',
  'https://stackoverflow.com/questions/72921178': 'https://stackoverflow.com/questions/tagged/fastapi',
  'https://velog.io/@vector/qdrant-filter': 'https://velog.io/search?q=qdrant',
  'https://velog.io/@react/react19': 'https://velog.io/search?q=react19',
  'https://velog.io/@nlp/summary-metrics': 'https://velog.io/search?q=요약%20평가',
  'https://velog.io/@web/fetch-stream-abort': 'https://velog.io/search?q=fetch%20stream',
  'https://www.youtube.com/watch?v=5070noise': 'https://www.youtube.com/results?search_query=rtx+5070+소음',
  'https://www.youtube.com/watch?v=toss-template': 'https://www.youtube.com/results?search_query=토익스피킹+템플릿',
  'https://brunch.co.kr/@techtalk/42': 'https://brunch.co.kr/',
  'https://blog.naver.com/osaka_eat/2231': 'https://section.blog.naver.com/Search/Post.naver?keyword=오사카%20맛집',
  'https://blog.naver.com/gadget/2231': 'https://section.blog.naver.com/Search/Post.naver?keyword=에어팟%20프로%203',
  'https://blog.naver.com/toss_im3/2231': 'https://section.blog.naver.com/Search/Post.naver?keyword=토스%20IM3',
  'https://blog.naver.com/runner/2231': 'https://section.blog.naver.com/Search/Post.naver?keyword=러닝화%20추천',
  'https://blog.naver.com/fukuoka/2231': 'https://section.blog.naver.com/Search/Post.naver?keyword=후쿠오카%201박%202일',
  'https://www.molit.go.kr/jeonse': 'https://www.molit.go.kr/',
  'https://www.hankyung.com/article/2026091512': 'https://www.hankyung.com/',
  'https://www.nike.com/kr/t/pegasus-42': 'https://www.nike.com/kr/',
  'https://subway.city.fukuoka.lg.jp/route/': 'https://subway.city.fukuoka.lg.jp/',
  'https://www.diningcode.com/list.dc?query=애월카페': 'https://www.diningcode.com/list.dc?query=애월카페',
};

/** 헤드리스를 막아 빈 화면·보안 확인만 찍히는 페이지. 카드가 회색 자리표시로 그린다. */
const BLOCKED = new Set(['https://stackoverflow.com/questions/72921178', 'https://tabelog.com/osaka/rstLst/']);

const fixtures = readFileSync(join(HERE, 'fixtures.ts'), 'utf8');
const urls = [...new Set([...fixtures.matchAll(/\[\s*'[^']*',\s*'(https?:[^']+)',\s*\d+\s*\]/g)].map((match) => match[1]))];

mkdirSync(OUT, { recursive: true });
const indexPath = join(OUT, 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};

const capture = (url, file) =>
  new Promise((resolve) => {
    const profile = mkdtempSync(join(tmpdir(), 'orbit-shot-'));
    execFile(
      CHROME,
      [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run',
        '--no-default-browser-check', '--disable-extensions', `--user-data-dir=${profile}`,
        // 카드가 세로(200×260)라 세로로 긴 화면을 반 해상도로 찍는다.
        // 네트워크가 끝나지 않는 사이트도 있어 12초가 지나면 그때 화면을 찍는다.
        '--window-size=1000,1300', '--force-device-scale-factor=0.5', '--timeout=12000',
        `--user-agent=${UA}`, `--screenshot=${file}`, url,
      ],
      { timeout: 40_000 },
      (error) => {
        rmSync(profile, { recursive: true, force: true });
        resolve(!error && existsSync(file));
      },
    );
  });

let next = 0;
const worker = async () => {
  while (next < urls.length) {
    const n = next++;
    const url = urls[n];
    if (BLOCKED.has(url) || (index[url] && existsSync(join(HERE, index[url])))) continue;
    const name = `shot-${String(n).padStart(2, '0')}.jpg`;
    const ok = await capture(ALTERNATE[url] ?? url, join(OUT, name));
    if (ok) index[url] = `shots/${name}`;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${url}`);
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);
writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log(`${Object.keys(index).length}/${urls.length} pages -> ${OUT}`);
