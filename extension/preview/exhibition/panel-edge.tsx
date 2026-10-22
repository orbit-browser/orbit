/**
 * 앞 가장자리 띠 두 장(455 × 2380mm) — 통로에서 먼저 보이는 부스의 테두리.
 *
 * 차콜(제품 글자색) 바탕에 세로로 선 "Orbit." 하나로 멀리서도 읽힌다. 가려지기 쉬운 자리라
 * 세부 정보는 넣지 않는다. 왼쪽은 핵심 메시지와 시연 안내, 오른쪽은 설치 안내·QR 빈 칸(출력 뒤 스티커)·팀 이름.
 * 행동 유도 문구는 두 띠와 USE 첫머리에 같은 말로 둔다(대표 규칙).
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
        <>
          <p className="ex-edge__message">
            흩어진 탐색을
            <br />
            기억하고,
            <br />
            다시 이어가다.
          </p>
          <p className="ex-edge__cta">
            <i className="ph ph-arrow-right" />
            <b>
              지금 써 보세요
              <br />
              시연은 가운데 화면에서
            </b>
            <span>설치 QR은 오른쪽 끝에</span>
          </p>
        </>
      ) : (
        <div className="ex-edge__try">
          <p className="ex-edge__cta ex-edge__cta--qr">
            <b>
              QR로 설치하고
              <br />
              지금 써 보세요
            </b>
          </p>
          {/* QR 자리 — 흰 바탕과 여백(어두운 띠 위에서도 읽히게) 안에 스티커 칸(모서리 표시)을 둔다 */}
          <div className="ex-qr" style={{ padding: BOOTH.qrMargin }} aria-label={`QR 스티커 자리 ${BOOTH.qr} × ${BOOTH.qr}mm`}>
            <div className="ex-qr__slot" style={{ width: BOOTH.qr, height: BOOTH.qr }}>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <p className="ex-edge__hint">시연은 가운데 화면에서</p>
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
