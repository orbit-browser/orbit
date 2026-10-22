import orbitCsv from './orbit_trial.csv?raw';
import competitorCsv from './competitor_trials.csv?raw';
import { parseCsv } from './metrics';

interface TrialRate {
  correct: number;
  total: number;
  percent: number;
}

export interface RefusalHighlight {
  orbit: TrialRate;
  comet: TrialRate;
  differencePoints: number;
}

// 비교 문항과 로그인 조건을 고정한다. 양성 검색·재시도·로그아웃 결과는 섞지 않는다.
const QUESTION_IDS = ['negative_garden', 'negative_piano'];

export function calculateRefusalHighlight(orbitText: string, competitorText: string): RefusalHighlight {
  const orbitRows = parseCsv(orbitText).filter((row) => QUESTION_IDS.includes(row.question_id));
  const cometRows = parseCsv(competitorText).filter((row) =>
    row.product === 'Perplexity Comet'
    && row.condition === 'logged_in_mixed'
    && row.kind === 'Q'
    && QUESTION_IDS.includes(row.question_id),
  );

  const rate = (rows: Record<string, string>[], field: string, success: string, failure: string): TrialRate => {
    for (const id of QUESTION_IDS) {
      if (rows.filter((row) => row.question_id === id).length !== 1) {
        throw new Error(`Expected one measured refusal result for ${id}`);
      }
    }
    if (rows.some((row) => ![success, failure].includes(row[field]))) {
      throw new Error('Refusal comparison contains an unmeasured result');
    }
    const correct = rows.filter((row) => row[field] === success).length;
    return { correct, total: rows.length, percent: (correct / rows.length) * 100 };
  };

  const orbit = rate(orbitRows, 'found', '1', '0');
  const comet = rate(cometRows, 'result', 'correct', 'wrong');
  return { orbit, comet, differencePoints: orbit.percent - comet.percent };
}

export const REFUSAL_HIGHLIGHT = calculateRefusalHighlight(orbitCsv, competitorCsv);
