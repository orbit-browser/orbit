import orbitCsv from './orbit_trial.csv?raw';
import competitorCsv from './competitor_trials.csv?raw';
import { parseCsv } from './metrics';

/**
 * 현수막 5장 "검증된 숫자" — Orbit 이 100%(또는 0건)인 실측만 싣는다(대표 2026-10-22 "100% 99% 이렇게 내세울 수 있는 것만").
 * 경쟁 비교는 같은 조건 직접 시험(빈 브라우저에 공개 페이지 26개 → 같은 질문 8개, 질문마다 1회)에서만 한다.
 */
const NEGATIVE = ['negative_garden', 'negative_piano'];

/**
 * 원본 CSV 에 열로 없는 값과 그 출처.
 * - 다시 열기: Orbit — fix-ui-trial-defects 의 orbit-ui-trial-fix2/README.md(목표 4개가 열렸고 다른 URL 0),
 *   Comet — competitor_trials.csv 의 logged_in_computer travel_car R(26개를 모두 열었고 그중 그 작업의 페이지 3개).
 * - 팀 격리: test-team-e2e 의 team-e2e/README.md 7단계 — 공유하지 않은 세션이 B 쪽 화면·API 12가지 경로
 *   (검색 팀·개인×세션·기억, Ask 팀·개인, 상세·이벤트, 추천, 오늘 이벤트, 화면 Ask, 네비게이터)와 저장한 응답 18개 어디에도 0건.
 */
const RESTORE = { orbit: { right: 4, opened: 4 }, comet: { right: 3, opened: 26 } };
const TEAM_ISOLATION = { leaks: 0, paths: 12, responses: 18 };

export interface Rate {
  hit: number;
  total: number;
  percent: number;
}

export interface Proven {
  refusal: { orbit: Rate; comet: Rate };
  restorePrecision: { orbit: Rate; comet: Rate };
  teamIsolation: { leaks: number; paths: number; responses: number };
}

const rate = (hit: number, total: number): Rate => ({ hit, total, percent: Math.round((hit / total) * 100) });

function one(rows: Record<string, string>[], id: string): Record<string, string> {
  const matched = rows.filter((row) => row.question_id === id);
  if (matched.length !== 1) throw new Error(`Expected one measured result for ${id}`);
  return matched[0];
}

export function calculateProven(orbitText: string, competitorText: string): Proven {
  const orbit = parseCsv(orbitText);
  const cometMixed = parseCsv(competitorText).filter(
    (row) => row.product === 'Perplexity Comet' && row.condition === 'logged_in_mixed' && row.kind === 'Q',
  );
  const orbitRefused = NEGATIVE.filter((id) => one(orbit, id).found === '1');
  const cometRefused = NEGATIVE.filter((id) => one(cometMixed, id).result === 'correct');
  return {
    refusal: { orbit: rate(orbitRefused.length, NEGATIVE.length), comet: rate(cometRefused.length, NEGATIVE.length) },
    restorePrecision: {
      orbit: rate(RESTORE.orbit.right, RESTORE.orbit.opened),
      comet: rate(RESTORE.comet.right, RESTORE.comet.opened),
    },
    teamIsolation: TEAM_ISOLATION,
  };
}

export const PROVEN = calculateProven(orbitCsv, competitorCsv);
