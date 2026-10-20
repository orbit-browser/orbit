// 현수막 3장을 인쇄용 파일로 내보낸다 — 헤드리스 크롬으로 미리보기 서버의 인쇄 화면(?print=1)을 찍는다.
//   pnpm preview:ui --port 5203                         (다른 터미널에서 먼저)
//   node preview/exhibition/export.mjs                  PNG 3장(100dpi) + PDF 1개(3쪽, 950 × 2380mm)
//   node preview/exhibition/export.mjs --dpi 150 --panels 2 --no-pdf
// 결과는 preview/exhibition/out/(git 에 올리지 않는다). 크롬 경로는 CHROME=<경로> 로 바꿀 수 있다.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const CHROME =
  process.env.CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : 'google-chrome');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = option('port', '5203');
const dpi = Number(option('dpi', '100'));
const panels = option('panels', '1,2,3').split(',').map(Number).filter((panel) => panel >= 1 && panel <= 3);
const wantPng = !args.includes('--no-png');
const wantPdf = !args.includes('--no-pdf');
// 이 크기가 현수막 한 장(1px = 1mm). 인쇄 화면은 이 크기로 그린다.
const WIDTH_MM = 950;
const HEIGHT_MM = 2380;

if (!Number.isFinite(dpi) || dpi < 20 || dpi > 300) {
  console.error('--dpi must be between 20 and 300');
  process.exit(2);
}

const base = `http://127.0.0.1:${port}/preview/exhibition/`;
try {
  const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  console.error(`Preview server is not reachable at ${base} (${error.message}).`);
  console.error(`Start it first: cd extension && pnpm preview:ui --port ${port}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const run = (extra, url) =>
  new Promise((resolve) => {
    const profile = mkdtempSync(join(tmpdir(), 'orbit-exhibit-'));
    execFile(
      CHROME,
      [
        '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        `--user-data-dir=${profile}`,
        // 글꼴·페이지 화면·파비콘이 들어올 때까지 기다린다
        '--virtual-time-budget=25000',
        ...extra,
        url,
      ],
      { timeout: 240_000 },
      (error) => {
        rmSync(profile, { recursive: true, force: true });
        resolve(error);
      },
    );
  });

/** PNG 머리(IHDR)에서 가로·세로를 읽는다 — 내보낸 크기가 맞는지 확인하려고. */
function pngSize(file) {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(24);
  readSync(fd, header, 0, 24, 0);
  closeSync(fd);
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

let failed = 0;
if (wantPng) {
  const scale = dpi / 25.4;
  for (const panel of panels) {
    const file = join(OUT, `orbit-banner-${panel}-${dpi}dpi.png`);
    const error = await run(
      // 원근 카드 하나하나가 합성 레이어라 고해상도에서는 GPU 메모리 기본 한도를 넘어 일부가 빠진다 — 한도를 올린다.
      [`--window-size=${WIDTH_MM},${HEIGHT_MM}`, `--force-device-scale-factor=${scale.toFixed(4)}`, '--force-gpu-mem-available-mb=16384', `--screenshot=${file}`],
      `${base}?print=1&panel=${panel}`,
    );
    if (error || !existsSync(file)) {
      failed += 1;
      console.error(`FAIL png ${panel}: ${error?.message ?? 'no output'}`);
      continue;
    }
    const [width, height] = pngSize(file);
    console.log(`ok   ${file} (${width} x ${height} px, ${(statSync(file).size / 1e6).toFixed(1)} MB)`);
  }
}

if (wantPdf) {
  const file = join(OUT, 'orbit-banners.pdf');
  const error = await run(['--no-pdf-header-footer', `--print-to-pdf=${file}`], `${base}?print=1&panel=${panels.join(',')}`);
  if (error || !existsSync(file)) {
    failed += 1;
    console.error(`FAIL pdf: ${error?.message ?? 'no output'}`);
  } else {
    console.log(`ok   ${file} (${WIDTH_MM} x ${HEIGHT_MM} mm per page, ${(statSync(file).size / 1e6).toFixed(1)} MB)`);
  }
}

if (wantPng) console.log('Check the PNGs by eye before sending them anywhere; the PDF is the print master.');
process.exit(failed ? 1 : 0);
