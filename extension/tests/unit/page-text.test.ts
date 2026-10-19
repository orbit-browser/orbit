import { describe, expect, it, vi } from 'vitest';
import { MIN_READABLE_LENGTH, normalizeText, pickPageText } from '../../lib/page-text';

const long = (word: string) => `${word} `.repeat(MIN_READABLE_LENGTH).trim();

describe('normalizeText', () => {
  it('공백 연속과 빈 줄을 접고 zero-width space를 지운다', () => {
    expect(normalizeText('  제목  입니다 \n\n\t \n 본문​ 한 줄\r\n  끝  ')).toBe(
      '제목 입니다\n본문 한 줄\n끝',
    );
  });
});

describe('pickPageText', () => {
  it('Readability 본문이 충분하면 폴백 입력을 계산하지 않는다', () => {
    const frames = vi.fn(() => [long('프레임')]);
    const body = vi.fn(() => long('화면'));
    expect(pickPageText(long('본문'), frames, body)).toBe(long('본문'));
    expect(frames).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it('Readability가 비면 가장 긴 same-origin iframe 본문을 쓴다(네이버 블로그)', () => {
    const body = vi.fn(() => '');
    expect(pickPageText('', () => ['광고', long('글'), '짧은 프레임'], body)).toBe(long('글'));
    expect(body).not.toHaveBeenCalled();
  });

  it('Readability가 짧고 iframe도 짧으면 화면 텍스트로 폴백한다(리멤버)', () => {
    expect(pickPageText('직무 소개', () => ['광고'], () => `메뉴\n\n${long('공고')}`)).toBe(
      `메뉴\n${long('공고')}`,
    );
  });

  it('화면 텍스트가 더 짧으면 Readability 결과를 유지한다', () => {
    expect(pickPageText('짧은 본문 문단', () => [], () => '짧음')).toBe('짧은 본문 문단');
  });

  it('짧은 iframe 본문이라도 다른 후보가 비면 남긴다', () => {
    expect(pickPageText('', () => ['짧은 iframe 글'], () => '')).toBe('짧은 iframe 글');
  });

  it('추출할 것이 없으면 빈 문자열', () => {
    expect(pickPageText('', () => [], () => ' \n ')).toBe('');
  });
});
