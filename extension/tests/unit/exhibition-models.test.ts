import { describe, expect, it } from 'vitest';
import { MODELS, PIPELINE } from '../../preview/exhibition/panel-tech';

// 현수막의 단계별 모델 표기는 실제 1순위 배정과 같아야 한다. 기준은 DecisionLog 2026-10-23(최종 공급자 배정)이고,
// 백엔드 쪽 같은 표는 backend/tests/test_llm_provider_order.py·test_llm_stream.py가 지킨다.
const PRIMARY_BY_STEP: Record<string, keyof typeof MODELS> = {
  '의도 판단': 'ax', // R1 A.X-K2 → KT
  요약: 'ax', // R3 A.X-K2 → K-EXAONE
  '답과 복원': 'exaone', // R9 K-EXAONE → A.X-K2
};

describe('exhibition model labels', () => {
  it('names each step with its primary model from the 2026-10-23 assignment', () => {
    const items = new Map(PIPELINE.flatMap((stage) => stage.items.map(([name, text]) => [name, text] as const)));
    const llmNames = [MODELS.ax, MODELS.exaone, MODELS.kt];

    for (const [step, key] of Object.entries(PRIMARY_BY_STEP)) {
      const text = items.get(step);
      expect(text, step).toBeDefined();
      expect(text, step).toContain(MODELS[key]);
      for (const other of llmNames.filter((name) => name !== MODELS[key])) {
        expect(text, step).not.toContain(other);
      }
    }
  });
});
