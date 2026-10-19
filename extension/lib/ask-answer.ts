/**
 * Ask 답변 표시용 정리.
 *
 * 답변은 일반 텍스트(pre-wrap)로 보여 준다. 프롬프트로 막아도 모델이 Markdown 강조·제목을
 * 섞거나 출처 세션 수보다 큰 근거 번호([2] 등)를 붙이는 경우가 있어 표시 직전에 걸러낸다.
 * 코드가 섞인 답변을 망가뜨리지 않도록 같은 줄 안의 `**강조**`와 줄머리 제목 표시만 벗긴다.
 */
export function cleanAnswerText(text: string, sourceCount: number): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/ ?\[(\d+)\]/g, (match, value: string) => {
      const index = Number(value);
      return index >= 1 && index <= sourceCount ? match : '';
    });
}
