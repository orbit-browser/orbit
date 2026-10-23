// 현수막 7장을 인쇄용 파일로 내보낸다 — 헤드리스 크롬으로 미리보기 서버의 인쇄 화면(?print=1)을 찍는다.
//   pnpm preview:ui --port 5203                         (다른 터미널에서 먼저)
//   node preview/exhibition/export.mjs                  장마다 PNG(100dpi)와 PDF, 그리고 모아 본 PDF 하나
//   node preview/exhibition/export.mjs --dpi 150 --panels 4,7 --no-pdf
//   node preview/exhibition/export.mjs --variant span    실제 화면 시안(가운데 벽 3·4·5번) — out/variant-span/ 에 따로
// 결과는 preview/exhibition/out/(git 에 올리지 않는다). 크롬 경로는 CHROME=<경로> 로 바꿀 수 있다.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// 장의 순서·가로 크기와 세로 길이는 booth.ts 한 곳에서만 정한다(1px = 1mm 로 그린다).
const booth = readFileSync(join(HERE, 'booth.ts'), 'utf8');
const PANELS = [...booth.matchAll(/id: '([\w-]+)', width: (\d+)/g)].map(([, id, width]) => ({ id, width: Number(width) }));
const HEIGHT_MM = Number(booth.match(/height: (\d+)/)?.[1]);
if (PANELS.length === 0 || !HEIGHT_MM) {
  console.error('Could not read the panel list from booth.ts');
  process.exit(2);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = option('port', '5203');
const dpi = Number(option('dpi', '100'));
const picked = option('panels', PANELS.map((_, index) => index + 1).join(','))
  .split(',')
  .map(Number)
  .filter((n) => n >= 1 && n <= PANELS.length);
const wantPng = !args.includes('--no-png');
// 실제 화면 시안은 지금 인쇄판과 섞이지 않게 하위 폴더에 낸다
const variant = option('variant', '');
const variantQuery = variant ? `&variant=${variant}` : '';
const OUT_DIR = variant ? join(OUT, `variant-${variant}`) : OUT;
const wantPdf = !args.includes('--no-pdf');

if (!Number.isFinite(dpi) || dpi < 20 || dpi > 300) {
  console.error('--dpi must be between 20 and 300');
  process.exit(2);
}
if (variant && variant !== 'span') {
  console.error('--variant must be span');
  process.exit(2);
}
if (picked.length === 0) {
  console.error(`--panels must list numbers between 1 and ${PANELS.length}`);
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

mkdirSync(OUT_DIR, { recursive: true });

const run = (extra, url) =>
  new Promise((resolve) => {
    const profile = mkdtempSync(join(tmpdir(), 'orbit-exhibit-'));
    execFile(
      CHROME,
      [
        '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        `--user-data-dir=${profile}`,
        // 글꼴과 갤러리가 자리 잡을 때까지 기다린다
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

const crc32 = (bytes) => {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
};

/**
 * PNG 에 해상도(pHYs)를 적는다 — 크롬 스크린샷에는 없어 72dpi 로 읽히고, 출력소가 크기를 1.4배로 잡는다.
 * 이미 있으면 값만 바꾸고, 없으면 첫 IDAT 앞에 넣는다.
 */
function setPngDpi(file, dpi) {
  const png = readFileSync(file);
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8); // 단위: 미터
  const body = Buffer.concat([Buffer.from('pHYs'), data]);
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), 17);
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'pHYs' || type === 'IDAT') {
      const end = type === 'pHYs' ? offset + 12 + length : offset;
      writeFileSync(file, Buffer.concat([png.subarray(0, offset), chunk, png.subarray(end)]));
      return;
    }
    offset += 12 + length;
  }
}

/** PDF 쪽마다 크기(mm). Chrome과 pypdf가 쓰는 비압축 MediaBox를 읽는다. */
function pdfPagesMm(file) {
  const text = readFileSync(file, 'latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(([, w, h]) => [(Number(w) * 25.4) / 72, (Number(h) * 25.4) / 72]);
}

/** PDF에 묻힌 글꼴 이름(부분 집합 접두어 'ABCDEF+' 제외). Chrome은 글꼴 사전을 압축하지 않는다. */
const pdfFonts = (file) => [...new Set([...readFileSync(file, 'latin1').matchAll(/\/FontName\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)].map(([, font]) => font))];
// 현수막 글꼴과 아이콘 글꼴. Google Fonts를 못 받으면 시스템 글꼴(.SFNS, AppleSDGothicNeo, Menlo 등)로 그려져
// 글줄이 달라지고 맨 위에 경고 띠가 찍힌다 — 그래도 쪽 크기 검사는 통과하므로 글꼴 이름으로 막는다.
const BANNER_FONTS = /^(Inter|NotoSansKR|JetBrainsMono|Phosphor)/;

/** 쪽 크기가 장 크기와 1mm 안에서 맞는지 — 이름 있는 쪽(@page narrow)이 빠지면 455 장이 950 으로 나온다. */
function checkPdf(file, panels) {
  const pages = pdfPagesMm(file);
  const wrong = panels.filter((panel, index) => {
    const [width, height] = pages[index] ?? [0, 0];
    return Math.abs(width - panel.width) > 1 || Math.abs(height - HEIGHT_MM) > 1;
  });
  if (pages.length !== panels.length || wrong.length) {
    const got = pages.map(([w, h]) => `${w.toFixed(0)}x${h.toFixed(0)}`).join(', ');
    return `expected ${panels.map((panel) => `${panel.width}x${HEIGHT_MM}`).join(', ')} mm, got ${got || 'no pages'}`;
  }
  return null;
}

const name = (n) => `orbit-banner-${n}-${PANELS[n - 1].id}`;
let failed = 0;
const fail = (what, why) => {
  failed += 1;
  console.error(`FAIL ${what}: ${why}`);
};

if (wantPng) {
  const scale = dpi / 25.4;
  for (const n of picked) {
    const { width } = PANELS[n - 1];
    const file = join(OUT_DIR, `${name(n)}-${dpi}dpi.png`);
    const error = await run(
      // 원근 카드 하나하나가 합성 레이어라 고해상도에서는 GPU 메모리 기본 한도를 넘어 일부가 빠진다 — 한도를 올린다.
      [`--window-size=${width},${HEIGHT_MM}`, `--force-device-scale-factor=${scale.toFixed(4)}`, '--force-gpu-mem-available-mb=16384', `--screenshot=${file}`],
      `${base}?print=1&panel=${n}${variantQuery}`,
    );
    if (error || !existsSync(file)) {
      fail(`png ${n}`, error?.message ?? 'no output');
      continue;
    }
    const [px, py] = pngSize(file);
    if (Math.abs(px - width * scale) > 2 || Math.abs(py - HEIGHT_MM * scale) > 2) {
      fail(`png ${n}`, `${px} x ${py} px, expected ${Math.round(width * scale)} x ${Math.round(HEIGHT_MM * scale)}`);
      continue;
    }
    setPngDpi(file, dpi);
    console.log(`ok   ${file} (${px} x ${py} px at ${dpi} dpi, ${(statSync(file).size / 1e6).toFixed(1)} MB)`);
  }
}

if (wantPdf) {
  const jobs = picked.map((n) => ({ file: join(OUT_DIR, `${name(n)}.pdf`), panels: [PANELS[n - 1]], query: String(n) }));
  const verified = [];
  for (const job of jobs) {
    // macOS 헤드리스 GPU가 3D 카드를 PDF로 그린 뒤 종료 중 멈추는 경우가 있다.
    // PNG 합성은 유지하고 PDF만 소프트웨어 렌더링으로 출력한다.
    const error = await run(['--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${job.file}`], `${base}?print=1&panel=${job.query}${variantQuery}`);
    if (error || !existsSync(job.file)) {
      fail(`pdf ${job.query}`, error?.message ?? 'no output');
      continue;
    }
    const wrong = checkPdf(job.file, job.panels);
    if (wrong) {
      fail(`pdf ${job.query}`, wrong);
      continue;
    }
    const fonts = pdfFonts(job.file);
    const stray = fonts.filter((font) => !BANNER_FONTS.test(font));
    if (fonts.length === 0 || stray.length) {
      fail(`pdf ${job.query}`, fonts.length ? `fonts other than the banner fonts (did Google Fonts load?): ${stray.join(', ')}` : 'no embedded fonts found');
      continue;
    }
    const sizes = job.panels.map((panel) => `${panel.width}x${HEIGHT_MM}`).join(' + ');
    console.log(`ok   ${job.file} (${sizes} mm, ${(statSync(job.file).size / 1e6).toFixed(1)} MB)`);
    verified.push(job.file);
  }
  // 폭이 다른 CSS 페이지를 한 번에 인쇄하면 Chrome이 내용만 75%로 줄인다.
  // MediaBox 검사로는 잡히지 않으므로 검증된 개별 PDF를 다시 그리지 않고 합친다.
  if (verified.length === jobs.length) {
    const file = join(OUT_DIR, 'orbit-banners.pdf');
    const script = [
      'import sys',
      'from pypdf import PdfWriter',
      'writer = PdfWriter()',
      'for source in sys.argv[2:]: writer.append(source)',
      'writer.write(sys.argv[1])',
      'writer.close()',
    ].join('\n');
    const error = await new Promise((resolve) => {
      execFile(process.env.ORBIT_PYTHON ?? 'python', ['-c', script, file, ...verified], { timeout: 60_000 }, resolve);
    });
    const wrong = error ? error.message : checkPdf(file, picked.map((n) => PANELS[n - 1]));
    if (wrong) {
      fail('combined pdf', wrong);
    } else {
      console.log(`ok   ${file} (${picked.length} pages, merged without rescaling)`);
    }
  } else {
    fail('combined pdf', 'not all individual PDFs passed validation');
  }
}

if (wantPng) console.log('Check the PNGs by eye before sending them anywhere; the PDFs are the print masters.');
process.exit(failed ? 1 : 0);
