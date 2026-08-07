import { describe, expect, it } from 'vitest';
import {
  MAX_SHORTCUTS,
  appendShortcut,
  fromTopSites,
  normalizeShortcutInput,
  shortcutKey,
  type Shortcut,
} from '../../entrypoints/newtab/lib/shortcuts';

const make = (url: string, title = 't'): Shortcut => ({ id: url, title, url });

describe('shortcutKey', () => {
  it('프로토콜과 끝 슬래시 차이를 같은 것으로 본다', () => {
    expect(shortcutKey('https://github.com/')).toBe(shortcutKey('http://github.com'));
  });

  it('경로와 쿼리가 다르면 다른 것으로 본다', () => {
    expect(shortcutKey('https://github.com/a')).not.toBe(shortcutKey('https://github.com/b'));
    expect(shortcutKey('https://x.com/?a=1')).not.toBe(shortcutKey('https://x.com/?a=2'));
  });
});

describe('normalizeShortcutInput', () => {
  it('스킴 없는 주소를 정규화한다', () => {
    const result = normalizeShortcutInput('깃허브', 'github.com');
    expect(result).toEqual({
      ok: true,
      shortcut: { title: '깃허브', url: 'https://github.com/' },
    });
  });

  it('이름을 비우면 호스트명을 쓰고 www 는 뗀다', () => {
    const result = normalizeShortcutInput('  ', 'https://www.youtube.com/');
    expect(result).toEqual({
      ok: true,
      shortcut: { title: 'youtube.com', url: 'https://www.youtube.com/' },
    });
  });

  it('주소가 아니면 거부한다', () => {
    expect(normalizeShortcutInput('메모', '오늘 할 일')).toEqual({
      ok: false,
      reason: '주소 형식이 아니에요. 예: github.com',
    });
  });

  it('빈 주소를 거부한다', () => {
    expect(normalizeShortcutInput('이름', '   ')).toEqual({
      ok: false,
      reason: '주소를 입력해 주세요.',
    });
  });

  it('위험 스킴을 거부한다 — 바로가기로 특권 스킴이 실행되면 안 된다', () => {
    for (const hostile of ['javascript:alert(1)', 'chrome://settings', 'data:text/html,x']) {
      expect(normalizeShortcutInput('x', hostile).ok).toBe(false);
    }
  });
});

describe('fromTopSites', () => {
  it('중복 주소를 걸러낸다', () => {
    const list = fromTopSites([
      { title: 'A', url: 'https://a.com/' },
      { title: 'A again', url: 'http://a.com' },
      { title: 'B', url: 'https://b.com/' },
    ]);
    expect(list.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('제목이 비면 호스트명으로 채운다', () => {
    expect(fromTopSites([{ title: '', url: 'https://www.naver.com/' }])[0].title).toBe('naver.com');
  });

  it('상한을 넘기지 않는다', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, url: `https://s${i}.com/` }));
    expect(fromTopSites(many)).toHaveLength(MAX_SHORTCUTS);
  });
});

describe('appendShortcut', () => {
  it('새 항목을 뒤에 붙인다', () => {
    const result = appendShortcut([make('https://a.com/')], { title: 'B', url: 'https://b.com/' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.list).toHaveLength(2);
  });

  it('이미 있는 주소는 거부한다', () => {
    const result = appendShortcut([make('https://a.com/')], { title: 'A2', url: 'http://a.com' });
    expect(result).toEqual({ ok: false, reason: '이미 있는 바로가기예요.' });
  });

  it('상한에 도달하면 거부한다', () => {
    const full = Array.from({ length: MAX_SHORTCUTS }, (_, i) => make(`https://s${i}.com/`));
    const result = appendShortcut(full, { title: 'X', url: 'https://new.com/' });
    expect(result.ok).toBe(false);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const original = [make('https://a.com/')];
    appendShortcut(original, { title: 'B', url: 'https://b.com/' });
    expect(original).toHaveLength(1);
  });
});
