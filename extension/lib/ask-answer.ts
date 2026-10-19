/**
 * Ask 답변 표시용 정리.
 *
 * 답변은 일반 텍스트(pre-wrap)로 보여 준다. 프롬프트로 막아도 모델이 Markdown 강조·제목을
 * 섞거나 출처 세션 수보다 큰 근거 번호([2] 등)를 붙이는 경우가 있어 표시 직전에 걸러낸다.
 * 코드 블록·인라인 코드는 그대로 두고, 그 밖에서도 `results[0]`처럼 영문·숫자 바로 뒤에 붙은
 * 대괄호나 세 자리 이상 숫자는 근거 번호로 보지 않는다.
 */
const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/;
const CITATION = /(^|[^\w)\]])( ?)\[(\d{1,2})\]/gm;

export function cleanAnswerText(text: string, sourceCount: number): string {
  return text
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : cleanProse(segment, sourceCount)))
    .join('');
}

function cleanProse(text: string, sourceCount: number): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(CITATION, (match, prefix: string, _space: string, value: string) => {
      const index = Number(value);
      return index >= 1 && index <= sourceCount ? match : prefix;
    });
}
