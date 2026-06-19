import { useState } from 'react';
import { Globe } from 'lucide-react';

// 파비콘 이미지를 시도하고, 실패 시 중립 아이콘으로 폴백합니다.
export function Favicon({ src, size = 16 }: { src?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        className="rounded-sm shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return <Globe size={size} className="text-orbit-muted shrink-0" />;
}
