// 팀 수집 화면 상태 규칙(docs/team-collect-mode.md §8.1). 띠·칩·첫 화면이 같은 함수로 고른다.
import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, needsReconsent } from '../../lib/settings';
import { formatRemaining, normalizeExcludedDomain, type ActiveCollect } from '../../lib/team-collect';
import type { Workspace } from '../../lib/types';
import { collectPhase, startCta } from '../../lib/useTeamCollect';

const NOW = Date.parse('2026-10-23T10:00:00Z');

function active(minutesLeft: number, clockOffsetMs = 0): ActiveCollect {
  return {
    workspaceId: 'ws-1',
    workspaceName: '리서치',
    hue: '#3aa09a',
    windowId: 'cw-1',
    startedAt: '2026-10-23T09:00:00Z',
    expiresAt: new Date(NOW + minutesLeft * 60_000).toISOString(),
    clockOffsetMs,
  };
}

const team = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-1', name: '리서치', hue: '#3aa09a', role: 'member', memberCount: 2, createdAt: '2026-10-01T00:00:00Z',
  collectAllowed: true, myCollect: null, ...overrides,
});

describe('collectPhase — 띠·칩 상태', () => {
  it('아무것도 없으면 idle', () => {
    expect(collectPhase(null, {}, NOW)).toBe('idle');
  });
  it('남은 시간이 10분보다 많으면 active, 10분 이하면 expiring', () => {
    expect(collectPhase(active(11), {}, NOW)).toBe('active');
    expect(collectPhase(active(10), {}, NOW)).toBe('expiring');
    expect(collectPhase(active(1), {}, NOW)).toBe('expiring');
  });
  it('만료된 창은 수집 중으로 그리지 않는다(서버 시각 보정 포함)', () => {
    expect(collectPhase(active(0), {}, NOW)).toBe('idle');
    expect(collectPhase(active(3, 5 * 60_000), {}, NOW)).toBe('idle');
  });
  it('일시 정지·돌아보기', () => {
    const paused = { workspaceId: 'ws-1', workspaceName: '리서치', hue: '#3aa09a', remainingMs: 1 };
    const ended = { workspaceId: 'ws-1', workspaceName: '리서치', windowId: 'cw-1', endedAt: 'x' };
    expect(collectPhase(null, { paused }, NOW)).toBe('paused');
    expect(collectPhase(null, { ended }, NOW)).toBe('ended');
    expect(collectPhase(active(30), { ended }, NOW)).toBe('active');
  });
});

describe('startCta — 팀 범위 첫 화면 주 행동', () => {
  it('허용된 팀이면 팀 수집 시작', () => {
    expect(startCta(team(), 'idle', null)).toBe('start');
  });
  it('허용 안 된 팀: owner 는 허용하기, 멤버는 안내', () => {
    expect(startCta(team({ collectAllowed: false, role: 'owner' }), 'idle', null)).toBe('allow');
    expect(startCta(team({ collectAllowed: false }), 'idle', null)).toBe('hint');
  });
  it('이 팀으로 이미 수집 중·일시 정지면 첫 화면 버튼을 거두고 칩이 맡는다', () => {
    expect(startCta(team(), 'active', 'ws-1')).toBe('none');
    expect(startCta(team(), 'paused', 'ws-1')).toBe('none');
  });
  it('다른 팀으로 수집 중이면 이 팀의 시작 버튼을 보인다(시트가 바꿀지 묻는다)', () => {
    expect(startCta(team(), 'active', 'ws-other')).toBe('start');
  });
});

describe('표시 형식', () => {
  it('남은 시간은 시:분, 올림', () => {
    expect(formatRemaining(119 * 60_000 + 1)).toBe('2:00');
    expect(formatRemaining(61 * 60_000)).toBe('1:01');
    expect(formatRemaining(-5)).toBe('0:00');
  });
  it('제외 사이트 입력을 호스트로 줄인다', () => {
    expect(normalizeExcludedDomain(' https://Notion.so/page?x=1 ')).toBe('notion.so');
    expect(normalizeExcludedDomain('docs.corp.example')).toBe('docs.corp.example');
    expect(normalizeExcludedDomain('localhost')).toBeNull();
    expect(normalizeExcludedDomain('')).toBeNull();
  });
});

describe('재동의 안내 (CONSENT_VERSION 2)', () => {
  it('옛 문구(1·true)에 동의한 계정만 안내한다', () => {
    expect(CONSENT_VERSION).toBe(2);
    expect(needsReconsent({ a: 1 }, 'a')).toBe(true);
    expect(needsReconsent({ a: true }, 'a')).toBe(true);
    expect(needsReconsent({ a: 2 }, 'a')).toBe(false);
    expect(needsReconsent({ a: false }, 'a')).toBe(false);
    expect(needsReconsent({}, 'a')).toBe(false);
  });
});
