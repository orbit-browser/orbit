import { describe, expect, it } from 'vitest';
import { parseOmniboxInput } from '../../lib/omnibox';

describe('parseOmniboxInput — 이동', () => {
  it('http/https 스킴이 명시되면 그대로 이동한다', () => {
    expect(parseOmniboxInput('https://github.com/orbit-browser')).toEqual({
      kind: 'navigate',
      url: 'https://github.com/orbit-browser',
    });
    expect(parseOmniboxInput('http://example.com/')).toEqual({
      kind: 'navigate',
      url: 'http://example.com/',
    });
  });

  it('스킴 없는 도메인에는 https 를 붙인다', () => {
    expect(parseOmniboxInput('github.com')).toEqual({
      kind: 'navigate',
      url: 'https://github.com/',
    });
    expect(parseOmniboxInput('sub.example.co.kr/path?q=1')).toEqual({
      kind: 'navigate',
      url: 'https://sub.example.co.kr/path?q=1',
    });
  });

  it('localhost 와 루프백 IP 는 TLD 가 없어도 주소로 보고, http 로 붙인다', () => {
    // 크롬 주소창도 localhost 는 HTTPS-First 대상에서 제외한다.
    expect(parseOmniboxInput('localhost:5173')).toEqual({
      kind: 'navigate',
      url: 'http://localhost:5173/',
    });
    expect(parseOmniboxInput('127.0.0.1:8000/docs')).toEqual({
      kind: 'navigate',
      url: 'http://127.0.0.1:8000/docs',
    });
  });

  it('루프백이 아닌 IP 는 https 로 붙인다', () => {
    expect(parseOmniboxInput('192.168.0.10')).toEqual({
      kind: 'navigate',
      url: 'https://192.168.0.10/',
    });
  });

  it('앞뒤 공백은 제거한다', () => {
    expect(parseOmniboxInput('  github.com  ')).toEqual({
      kind: 'navigate',
      url: 'https://github.com/',
    });
  });

  it('file 스킴은 허용한다', () => {
    expect(parseOmniboxInput('file:///Users/me/notes.txt')).toEqual({
      kind: 'navigate',
      url: 'file:///Users/me/notes.txt',
    });
  });
});

describe('parseOmniboxInput — 검색', () => {
  it('공백이 섞인 문장은 검색한다', () => {
    expect(parseOmniboxInput('orbit 세션 클러스터링')).toEqual({
      kind: 'search',
      query: 'orbit 세션 클러스터링',
    });
  });

  it('점이 있어도 TLD 형태가 아니면 검색한다', () => {
    expect(parseOmniboxInput('1.5')).toEqual({ kind: 'search', query: '1.5' });
    expect(parseOmniboxInput('vite 8.2 릴리스')).toEqual({
      kind: 'search',
      query: 'vite 8.2 릴리스',
    });
  });

  it('점 없는 단어는 검색한다', () => {
    expect(parseOmniboxInput('typescript')).toEqual({
      kind: 'search',
      query: 'typescript',
    });
  });

  it('허용하지 않은 스킴은 이동시키지 않고 검색으로 강등한다', () => {
    for (const hostile of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'chrome://settings',
      'chrome-extension://abc/page.html',
      'mailto:hi@example.com',
    ]) {
      expect(parseOmniboxInput(hostile)).toEqual({ kind: 'search', query: hostile });
    }
  });

  it('대소문자를 섞은 위험 스킴도 막는다', () => {
    expect(parseOmniboxInput('JavaScript:alert(1)')).toEqual({
      kind: 'search',
      query: 'JavaScript:alert(1)',
    });
  });

  it('빈 입력은 빈 검색으로 돌려준다', () => {
    expect(parseOmniboxInput('   ')).toEqual({ kind: 'search', query: '' });
  });
});
