/**
 * 새 탭·사이드패널을 일반 웹 페이지로 띄우는 미리보기 서버(확장 빌드와 무관).
 *   pnpm preview:ui -- --port 5201
 *   PREVIEW_LABEL="A 기억 데스크" pnpm preview:ui -- --port 5201
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// 루트는 확장 폴더다. Tailwind 가 루트 아래를 훑어 클래스를 만들므로, preview/ 를 루트로 두면
// 사이드패널 컴포넌트의 유틸리티가 빠진다. 미리보기 페이지는 /preview/ 에 있다.
const root = fileURLToPath(new URL('..', import.meta.url));

function branchName(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '현재 화면';
  }
}

/**
 * 확장의 `_favicon/` 대신 쓰는 파비콘. 합성 데이터의 도메인만 묻고, 한 번 받은 것은 기억한다.
 * 받지 못하면 404 를 돌려 화면의 기본 아이콘이 그려지게 한다.
 */
/** 주소만 치고 들어와도 미리보기 겉틀이 열리게. */
function openShell(): Plugin {
  return {
    name: 'orbit-preview-shell',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/' && req.url !== '/index.html') return next();
        res.statusCode = 302;
        res.setHeader('Location', '/preview/');
        res.end();
      });
    },
  };
}

function favicons(): Plugin {
  const cache = new Map<string, { type: string; body: Buffer } | null>();
  return {
    name: 'orbit-preview-favicons',
    configureServer(server) {
      server.middlewares.use('/_favicon', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://preview');
        let host = '';
        try {
          host = new URL(url.searchParams.get('pageUrl') ?? '').hostname;
        } catch {
          // 잘못된 주소
        }
        if (!host) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!cache.has(host)) {
          try {
            const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, {
              signal: AbortSignal.timeout(4000),
            });
            cache.set(host, response.ok
              ? { type: response.headers.get('content-type') ?? 'image/png', body: Buffer.from(await response.arrayBuffer()) }
              : null);
          } catch {
            cache.set(host, null);
          }
        }
        const icon = cache.get(host);
        if (!icon) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', icon.type);
        res.setHeader('Cache-Control', 'max-age=86400');
        res.end(icon.body);
      });
    },
  };
}

export default defineConfig({
  root,
  // 확장 폴더의 .env(실제 백엔드 주소 등)를 읽지 않게 preview/ 를 env 폴더로 둔다.
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [openShell(), react(), tailwindcss(), favicons()],
  define: {
    // 실제 백엔드로 새지 않게, 대역만 받는 주소를 쓴다(preview/api-mock.ts).
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://orbit-preview.invalid'),
    'import.meta.env.VITE_PREVIEW_LABEL': JSON.stringify(process.env.PREVIEW_LABEL ?? branchName()),
  },
  server: { host: '127.0.0.1', strictPort: true },
});
