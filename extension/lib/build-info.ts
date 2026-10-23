import { apiBaseUrl } from './api';

declare const __ORBIT_BUILD__: string | undefined;

/** 이 확장이 어떤 빌드이고 어느 서버에 붙는지 한 줄(예: `main 3e32eaf · 127.0.0.1:8000`). */
export function buildInfoLine(): string {
  const build = typeof __ORBIT_BUILD__ === 'string' ? __ORBIT_BUILD__ : 'dev';
  let server = apiBaseUrl;
  try {
    server = new URL(apiBaseUrl).host;
  } catch {
    // 주소가 깨졌으면 그대로 보인다
  }
  return `${build} · ${server}`;
}
