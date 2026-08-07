import { RotateCw } from 'lucide-react';
import type { SessionNode } from '../atlas/data';
import { formatMinutes } from '../atlas/data';
import type { RestoreTarget } from '../../lib/restore';

interface ExploreCardProps {
  session: SessionNode;
  /** 좌측 상단 배지 */
  badge: string;
  /** 우측 상단 보조 정보 */
  meta: string;
  /** 카드가 추천된 이유 (있을 때만) */
  reason?: string;
  variant?: 'active' | 'plain';
  /** 이 세션의 대시보드(아틀라스)로 이동 */
  onOpenDashboard: () => void;
  /** 세션에 속한 페이지를 탭으로 되살린다 */
  onRestore: (target: RestoreTarget) => void;
}

/**
 * "이어서 탐색하기" · "추천 세션" 이 함께 쓰는 카드.
 *
 * 상세 보기는 별도 모달을 띄우지 않고 해당 세션의 대시보드로 이동한다.
 * 복원 버튼에 올리면 "새 창으로" 옵션이 왼쪽으로 펼쳐진다(세션 상세와 같은 조작).
 */
export function ExploreCard({
  session,
  badge,
  meta,
  reason,
  variant = 'plain',
  onOpenDashboard,
  onRestore,
}: ExploreCardProps) {
  return (
    <article className={`explore-card${variant === 'active' ? ' explore-card--active' : ''}`}>
      <div className="explore-card__top">
        <span
          className="badge"
          style={variant === 'plain' ? { background: 'rgba(28, 25, 23, 0.05)', color: 'var(--text-main)' } : undefined}
        >
          {badge}
        </span>
        <span className="explore-card__meta">{meta}</span>
      </div>

      <h3 className="explore-card__title">{session.title}</h3>

      <p className="explore-card__desc">{session.summary.overview}</p>

      <div className="explore-card__stats">
        <span style={{ color: session.hue }}>
          <i className={`ph ${session.icon}`} /> 탐색 세션
        </span>
        <span className="dot-sep" />
        <span>페이지 {session.pages.length}개</span>
        <span className="dot-sep" />
        <span>{formatMinutes(session.minutes)}</span>
      </div>

      {reason && <p className="explore-card__reason">{reason}</p>}

      <div className="explore-card__foot">
        <button type="button" className="btn-secondary" onClick={onOpenDashboard}>
          상세 보기
        </button>

        <div className="restore-group">
          <button
            type="button"
            className="restore-group__alt"
            onClick={() => onRestore('new-window')}
          >
            새 창으로 세션 복원
          </button>
          <button
            type="button"
            className="btn-primary restore-group__main"
            onClick={() => onRestore('current')}
          >
            <RotateCw size={15} />
            <span>세션 복원</span>
          </button>
        </div>
      </div>
    </article>
  );
}
