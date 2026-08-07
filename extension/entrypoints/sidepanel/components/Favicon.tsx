import { useState } from 'react';
import { Globe } from 'lucide-react';
import { faviconUrl } from '../../../lib/favicon';

interface FaviconProps {
  /** 페이지 URL — 있으면 확장 내장 파비콘으로 그린다(네트워크 요청 없음). */
  pageUrl?: string;
  /** 탭이 들고 있던 파비콘 주소. `pageUrl` 이 실패했을 때만 쓴다. */
  src?: string;
  size?: number;
}

/**
 * 파비콘.
 *
 * 우선순위: 확장 내장 `_favicon/` → 저장된 favIconUrl → 중립 아이콘.
 * 내장 파비콘을 먼저 쓰는 이유는 Auto Session 이 방문 이벤트로 만들어져
 * 탭 파비콘을 들고 있지 않을 때가 많고, 저장된 주소도 시간이 지나면 죽기 때문이다.
 */
export function Favicon({ pageUrl, src, size = 16 }: FaviconProps) {
  const [failedBuiltIn, setFailedBuiltIn] = useState(false);
  const [failedSrc, setFailedSrc] = useState(false);

  const builtIn = pageUrl ? faviconUrl(pageUrl, size * 2) : '';

  if (builtIn && !failedBuiltIn) {
    return (
      <img
        src={builtIn}
        width={size}
        height={size}
        alt=""
        className="rounded-sm shrink-0"
        onError={() => setFailedBuiltIn(true)}
      />
    );
  }

  if (src && !failedSrc) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        className="rounded-sm shrink-0"
        onError={() => setFailedSrc(true)}
      />
    );
  }

  return <Globe size={size} className="text-orbit-muted shrink-0" />;
}
