import { describe, expect, it } from 'vitest';
import { cleanAnswerText } from '../../lib/ask-answer';

describe('cleanAnswerText', () => {
  it('Markdown 강조와 제목 표시를 벗긴다', () => {
    expect(cleanAnswerText('### 요약\n최저가는 **689,000원**입니다 [1]', 1)).toBe(
      '요약\n최저가는 689,000원입니다 [1]',
    );
  });

  it('출처 세션 수를 넘는 근거 번호를 지운다', () => {
    expect(cleanAnswerText('대한항공은 15kg 무료 [2]. 제주항공은 유료 [1].', 1)).toBe(
      '대한항공은 15kg 무료. 제주항공은 유료 [1].',
    );
    expect(cleanAnswerText('찾지 못했어요 [1]', 0)).toBe('찾지 못했어요');
  });

  it('코드 표기는 건드리지 않는다', () => {
    const code = 'def f(*args, **kwargs):\n    return __name__';
    expect(cleanAnswerText(code, 1)).toBe(code);
  });
});
