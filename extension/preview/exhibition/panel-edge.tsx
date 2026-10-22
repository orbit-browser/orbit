/**
 * 앞 가장자리 띠 두 장(455 × 2380mm) — 통로에서 먼저 보이는 부스의 테두리.
 *
 * 차콜(제품 글자색) 바탕에 세로로 선 "Orbit." 하나로 멀리서도 읽힌다. 가려지기 쉬운 자리라
 * 세부 정보는 넣지 않는다. 왼쪽은 핵심 메시지, 오른쪽은 팀 이름과 QR 빈 칸(출력 뒤 스티커).
 */
import { BOOTH } from './booth';
import { SafeGuide } from './frame';

export function EdgeBanner({ side }: { side: 'left' | 'right' }) {
  return (
    <article className={`ex-banner ex-edge ex-edge--${side}`} aria-label={side === 'left' ? '현수막 — 왼쪽 앞 띠' : '현수막 — 오른쪽 앞 띠'}>
      <p className="ex-edge__word" aria-label="Orbit">
        Orbit<span>.</span>
      </p>
      {side === 'left' ? (
        <p className="ex-edge__message">
          흩어진 탐색을
          <br />
          기억하고,
          <br />
          다시 이어가다.
        </p>
      ) : (
        <div className="ex-edge__try">
          {/* QR 빈 칸 — 대표가 만든 QR 을 출력 뒤 스티커로 붙인다. 모서리 표시만 둔다 */}
          <div className="ex-qr" style={{ width: BOOTH.qr, height: BOOTH.qr }} aria-label={`QR 자리 ${BOOTH.qr} × ${BOOTH.qr}mm`}>
            <i />
            <i />
            <i />
            <i />
          </div>
          <p className="ex-edge__team">TEAM {BOOTH.team}</p>
        </div>
      )}
      {/* 브랜드 마크는 아래에 서명처럼 — 위에 두면 마침표와 주황 원 둘이 맞붙는다 */}
      <img className="ex-edge__mark" src="/orbit-mark.png" alt="" />
      <p className="ex-edge__foot">{side === 'left' ? 'PERSONAL EXPLORATION MEMORY' : 'FROM CHAOS TO MEMORY'}</p>
      <SafeGuide />
    </article>
  );
}
