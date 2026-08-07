import { useState } from 'react';
import { faviconUrl } from '../../../../lib/favicon';
import type { PageNode } from './data';

interface SessionFaviconsProps {
  pages: PageNode[];
  /** 겹쳐 보여줄 최대 개수 */
  max?: number;
  /** 파비콘을 못 그릴 때 쓰는 세션 색 */
  hue: string;
}

/** 같은 사이트가 여러 번 나오면 한 번만 — 겹친 아이콘이 전부 같은 그림이면 의미가 없다. */
function distinctByDomain(pages: PageNode[], max: number): PageNode[] {
  const seen = new Set<string>();
  const out: PageNode[] = [];
  for (const page of pages) {
    const key = page.domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(page);
    if (out.length === max) break;
  }
  return out;
}

function FaviconChip({ page, hue }: { page: PageNode; hue: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(page.url, 32);

  if (!src || failed) {
    // 파비콘을 못 구하면 도메인 첫 글자로 대체한다 — 빈 원보다 구분이 된다.
    return (
      <span className="session-favicon session-favicon--letter" style={{ color: hue }}>
        {page.domain.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="session-favicon"
      src={src}
      alt=""
      title={page.domain}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 세션에 실제로 들어 있는 탭들의 파비콘을 겹쳐서 보여준다.
 *
 * 모든 세션에 같은 기호를 쓰면 목록에서 서로 구분되지 않는다.
 * 실제 방문한 사이트를 보여주면 제목을 읽기 전에 어떤 세션인지 알아볼 수 있다.
 */
export function SessionFavicons({ pages, max = 3, hue }: SessionFaviconsProps) {
  const shown = distinctByDomain(pages, max);
  if (shown.length === 0) return null;

  return (
    <span className="session-favicons" aria-hidden="true">
      {shown.map((page) => (
        <FaviconChip key={page.id} page={page} hue={hue} />
      ))}
    </span>
  );
}
