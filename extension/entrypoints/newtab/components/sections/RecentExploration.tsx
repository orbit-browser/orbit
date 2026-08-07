import type { OrbitNode, SessionNode } from '../atlas/data';
import { formatMinutes } from '../atlas/data';

export interface ExplorationEntry {
  orbit: OrbitNode;
  session: SessionNode;
}

interface RecentExplorationProps {
  items: ExplorationEntry[];
  onSelect: (entry: ExplorationEntry) => void;
}

export function RecentExploration({ items, onSelect }: RecentExplorationProps) {
  return (
    <div className="recent">
      <h3 className="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.8 }}>
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
        최근 탐색
      </h3>

      <div className="timeline">
        {items.map((entry, index) => {
          const { orbit, session } = entry;
          return (
            <button
              key={session.id}
              type="button"
              className="timeline-item"
              onClick={() => onSelect(entry)}
            >
              <span className="timeline-node" style={index > 0 ? { opacity: 0.5 } : undefined} />

              <span className="timeline-meta" style={index > 0 ? { color: 'var(--text-muted)' } : undefined}>
                {session.date}
              </span>

              <span className="timeline-content">
                <span className="timeline-title">{session.title}</span>

                <span className="timeline-info">
                  <span>{formatMinutes(session.minutes)}</span>
                  <span className="dot-sep" />
                  <span style={{ color: orbit.hue }}>{orbit.title}</span>
                  <span className="dot-sep" />
                  <span>페이지 {session.pages.length}개</span>
                </span>

                <span className="page-tags">
                  {session.pages.slice(0, 3).map((page) => (
                    <span key={page.id} className="page-tag">
                      {page.title}
                    </span>
                  ))}
                  {session.pages.length > 3 && (
                    <span className="page-tag page-tag--more">외 {session.pages.length - 3}개</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
