import { describe, expect, it } from 'vitest';
import { faviconLetter } from '../../lib/favicon';

describe('faviconLetter', () => {
  it('URL 의 호스트 첫 글자를 대문자로 쓴다', () => {
    expect(faviconLetter('https://github.com/orbit-browser/orbit/branches')).toBe('G');
    expect(faviconLetter('https://velog.io/@a/post')).toBe('V');
  });

  it('www. 는 건너뛴다 — 모든 사이트가 W 가 되면 구분이 안 된다', () => {
    expect(faviconLetter('https://www.youtube.com/watch?v=x')).toBe('Y');
  });

  it('도메인 문자열만 들어와도 동작한다', () => {
    expect(faviconLetter('mail.naver.com')).toBe('M');
  });

  it('빈 값이나 파싱 불가는 물음표로 떨어진다', () => {
    expect(faviconLetter('')).toBe('?');
    expect(faviconLetter('   ')).toBe('?');
  });
});
