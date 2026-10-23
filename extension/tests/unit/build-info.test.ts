import { expect, it } from 'vitest';
import config from '../../wxt.config';
import { buildInfoLine } from '../../lib/build-info';

it('빌드 줄은 갈래·커밋과 연결된 서버 주소를 보인다(시험 환경에는 빌드 값이 없어 dev)', () => {
  expect(buildInfoLine()).toBe('dev · localhost:8000');
});

it('빌드할 때 갈래와 짧은 커밋을 심는다', async () => {
  const vite = (config.vite as unknown as (env: unknown) => { define: Record<string, string> })({});
  expect(JSON.parse(vite.define.__ORBIT_BUILD__)).toMatch(/^\S+ [0-9a-f]{7,}\+?$/);
});
