import { useState } from 'react';
import { faviconUrl } from '../../../../lib/favicon';

interface PageFaviconProps {
  url: string;
  domain: string;
  className?: string;
}

const initialOf = (domain: string) => domain.replace(/^WWW\./i, '').charAt(0).toUpperCase();

/**
 * 페이지 파비콘. 못 구하면 도메인 첫 글자로 대체한다.
 *
 * 폴백을 남겨 두는 이유는 크롬이 캐시하지 않은 사이트(한 번도 안 열어본 URL,
 * about:/file: 등)에서는 내장 파비콘이 비어 오기 때문이다.
 */
export function PageFavicon({ url, domain, className }: PageFaviconProps) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url, 64);

  if (!src || failed) {
    return <span className={className}>{initialOf(domain)}</span>;
  }

  return (
    <span className={className}>
      <img
        className="page-favicon__img"
        src={src}
        alt=""
        onError={() => setFailed(true)}
      />
    </span>
  );
}
