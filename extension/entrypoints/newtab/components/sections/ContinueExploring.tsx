import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ExploreCard } from './ExploreCard';
import type { ExplorationEntry } from './RecentExploration';
import type { RestoreTarget } from '../../lib/restore';
import type { RecommendationKind, RecommendedSession } from '../../../../lib/api';

/** 추천 성격 배지 문구 — 왜 이 성격으로 뽑혔는지 한눈에 보이게 한다. */
const KIND_LABEL: Record<RecommendationKind, string> = {
  continue: '이어가기',
  related: '지금과 연관',
  rediscover: '다시 보기',
};


interface ContinueExploringProps {
  active: ExplorationEntry | null;
  recommended: ExplorationEntry[];
  /** 세션 id → 추천 성격·이유. 서버 추천이 없으면 비어 있다. */
  reasons?: Map<string, RecommendedSession>;
  /** 해당 세션의 대시보드(아틀라스)로 이동 */
  onOpenDashboard: (entry: ExplorationEntry) => void;
  /** 세션에 속한 페이지를 탭으로 되살린다 */
  onRestore: (entry: ExplorationEntry, target: RestoreTarget) => void;
}

/** 추천 세션이 자동으로 넘어가는 간격 */
// 12초 — 카드 본문(요약 2~3줄 + 추천 이유)을 읽을 시간이 필요하다.
// 너무 빠르면 읽는 도중에 바뀌어 오히려 안 읽게 된다.
const ROTATE_MS = 12000;

export function ContinueExploring({
  active,
  recommended,
  reasons,
  onOpenDashboard,
  onRestore,
}: ContinueExploringProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || recommended.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % recommended.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, recommended.length]);

  const current = recommended[index];
  const go = (dir: 1 | -1) =>
    setIndex((i) => (i + dir + recommended.length) % recommended.length);

  useEffect(() => {
    if (index >= recommended.length) setIndex(0);
  }, [index, recommended.length]);

  return (
    <div className="right-column">
      <section>
        <h3 className="section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.8 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          이어서 탐색하기
        </h3>

        {active && (
          <ExploreCard
            session={active.session}
            badge={active.session.status === 'live' ? '진행 중' : '최근 세션'}
            meta={active.session.date}
            variant="active"
            onOpenDashboard={() => onOpenDashboard(active)}
            onRestore={(target) => onRestore(active, target)}
          />
        )}
      </section>

      <section
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {current && <h3 className="section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.8 }}>
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
          </svg>
          추천 세션
        </h3>}

        {/* key 로 카드를 교체해 전환 애니메이션이 매번 다시 실행되게 한다 */}
        {current && <div className="rec-slot" key={current.session.id}>
          <ExploreCard
            session={current.session}
            badge={
              reasons?.get(current.session.id)
                ? KIND_LABEL[reasons.get(current.session.id)!.kind]
                : current.session.category
            }
            meta={current.session.date}
            reason={reasons?.get(current.session.id)?.reason}
            onOpenDashboard={() => onOpenDashboard(current)}
            onRestore={(target) => onRestore(current, target)}
          />
        </div>}

        {recommended.length > 1 && (
          <div className="carousel-controls">
            <div className="dots">
              {recommended.map((entry, i) => (
                <button
                  key={entry.session.id}
                  type="button"
                  className={`dot${i === index ? ' active' : ''}`}
                  aria-label={`추천 세션 ${i + 1}`}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
            <div className="nav-arrows">
              <button className="arrow-btn" type="button" aria-label="이전 추천" onClick={() => go(-1)}>
                <ChevronLeft size={16} />
              </button>
              <button className="arrow-btn" type="button" aria-label="다음 추천" onClick={() => go(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
