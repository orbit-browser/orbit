import { describe, expect, it } from 'vitest';
import {
  filterSettingsNav,
  SETTINGS_NAV,
} from '../../entrypoints/newtab/components/layout/settings-nav';

const ids = (groups: ReturnType<typeof filterSettingsNav>) =>
  groups.flatMap((group) => group.items.map((item) => item.id));

describe('설정 분류', () => {
  it('모든 분류가 정확히 한 번씩만 나온다', () => {
    const all = ids(SETTINGS_NAV);
    expect(new Set(all).size).toBe(all.length);
  });

  it('검색어가 없으면 원본 그대로다', () => {
    expect(filterSettingsNav('')).toBe(SETTINGS_NAV);
    expect(filterSettingsNav('   ')).toBe(SETTINGS_NAV);
  });

  it('분류 이름으로 찾는다', () => {
    expect(ids(filterSettingsNav('개인정보'))).toEqual(['privacy']);
  });

  it('분류 이름에 없는 실제 설정 이름으로도 찾는다', () => {
    // "본문 저장" 은 어느 분류 이름에도 없다 — 키워드가 없으면 검색이 무용지물이다.
    expect(ids(filterSettingsNav('본문'))).toEqual(['collection']);
    expect(ids(filterSettingsNav('로그아웃'))).toEqual(['data']);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(ids(filterSettingsNav('ai'))).toContain('ai');
    expect(ids(filterSettingsNav('AI'))).toContain('ai');
  });

  it('맞는 항목이 없는 그룹은 통째로 빠진다', () => {
    const groups = filterSettingsNav('개인정보');
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('설정');
  });

  it('아무것도 맞지 않으면 빈 목록이다', () => {
    expect(filterSettingsNav('존재하지-않는-설정')).toEqual([]);
  });
});
