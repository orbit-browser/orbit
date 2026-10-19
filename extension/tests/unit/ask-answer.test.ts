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
    expect(cleanAnswerText('첫 결과는 results[0]이고 포트는 ports = [8000] [1]', 1)).toBe(
      '첫 결과는 results[0]이고 포트는 ports = [8000] [1]',
    );
    const fenced = '설정 [2]\n```python\n# 주석\nitems[2] = **x**\n```';
    expect(cleanAnswerText(fenced, 1)).toBe('설정\n```python\n# 주석\nitems[2] = **x**\n```');
    expect(cleanAnswerText('`arr[3]` 를 보세요 [3]', 1)).toBe('`arr[3]` 를 보세요');
  });

  it('한글 바로 뒤에 붙은 근거 번호도 범위를 확인한다', () => {
    expect(cleanAnswerText('무료[2] 유료[1]', 1)).toBe('무료 유료[1]');
  });
});
