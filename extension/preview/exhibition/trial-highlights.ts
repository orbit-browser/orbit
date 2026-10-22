import orbitCsv from './orbit_trial.csv?raw';
import competitorCsv from './competitor_trials.csv?raw';
import { parseCsv } from './metrics';

/**
 * 같은 조건 직접 시험(빈 브라우저에 공개 페이지 26개 방문 → 같은 질문 8개, 질문마다 1회)의 정면 비교.
 * Orbit 은 검색 품질 2차 뒤 재시험(fix2), 경쟁 제품은 CTO 직접 시험 결과를 쓴다. 조건이 다른 결과는 섞지 않는다.
 */
const POSITIVE = ['travel_car', 'travel_flight', 'dev_shared', 'dev_reset', 'gpu_specs', 'gpu_benchmark'];
const NEGATIVE = ['negative_garden', 'negative_piano'];

/**
 * 원본 CSV 에 열로 없는 두 값. 출처: Orbit — fix-ui-trial-defects 의 orbit-ui-trial-fix2/summary.json(복원 때 함께 열린
 * 다른 URL 0), Comet — competitor_trials.csv 의 logged_in_computer travel_car R(26개를 모두 열고 그중 정답 3개).
 */
const RESTORE_EXTRA = { orbit: 0, comet: 26 - 3 };
/** Comet 이 찾은 한 건은 에이전트가 기록 화면을 뒤져 300초 시점에도 진행 중이었다(competitor_trials.csv). */
const COMET_FIND_SECONDS_AT_LEAST = 300;

export interface Rate {
  hit: number;
  total: number;
  percent: number;
}

export interface HeadToHead {
  found: { orbit: Rate; comet: Rate; chrome: Rate };
  refusal: { orbit: Rate; comet: Rate };
  orbitFindMs: number;
  cometFindSecondsAtLeast: number;
  restoreExtra: { orbit: number; comet: number };
}

const rate = (hit: number, total: number): Rate => ({ hit, total, percent: Math.round((hit / total) * 100) });

function one(rows: Record<string, string>[], id: string): Record<string, string> {
  const matched = rows.filter((row) => row.question_id === id);
  if (matched.length !== 1) throw new Error(`Expected one measured result for ${id}`);
  return matched[0];
}

export function calculateHeadToHead(orbitText: string, competitorText: string): HeadToHead {
  const orbit = parseCsv(orbitText);
  const competitors = parseCsv(competitorText);
  const comet = competitors.filter((row) => row.product === 'Perplexity Comet');
  const chrome = competitors.filter((row) => row.product === 'Google Chrome' && row.condition === 'history_search_kr');

  const orbitFound = POSITIVE.map((id) => one(orbit, id)).filter((row) => row.found === '1');
  // Comet 은 로그인·에이전트 모드의 첫 질문(Q)만 센다 — 앞선 시험 대화의 메모리로 찾은 Q2 는 오염이라 뺀다.
  const cometAgent = comet.filter((row) => row.condition === 'logged_in_computer' && row.kind === 'Q');
  const cometFound = POSITIVE.filter((id) => one(cometAgent, id).result.startsWith('found'));
  const chromeFound = POSITIVE.filter((id) => one(chrome, id).result.startsWith('found'));

  const cometMixed = comet.filter((row) => row.condition === 'logged_in_mixed' && row.kind === 'Q');
  const cometRefused = NEGATIVE.filter((id) => one(cometMixed, id).result === 'correct');
  const orbitRefused = NEGATIVE.filter((id) => one(orbit, id).found === '1');

  const times = orbitFound.map((row) => Number(row.correct_ms)).sort((a, b) => a - b);
  if (times.length === 0 || times.some((ms) => !Number.isFinite(ms))) throw new Error('Orbit find time is not measured');
  const middle = Math.floor(times.length / 2);
  const orbitFindMs = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;

  return {
    found: {
      orbit: rate(orbitFound.length, POSITIVE.length),
      comet: rate(cometFound.length, POSITIVE.length),
      chrome: rate(chromeFound.length, POSITIVE.length),
    },
    refusal: { orbit: rate(orbitRefused.length, NEGATIVE.length), comet: rate(cometRefused.length, NEGATIVE.length) },
    orbitFindMs,
    cometFindSecondsAtLeast: COMET_FIND_SECONDS_AT_LEAST,
    restoreExtra: RESTORE_EXTRA,
  };
}

export const HEAD_TO_HEAD = calculateHeadToHead(orbitCsv, competitorCsv);
