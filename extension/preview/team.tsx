/**
 * 사이드패널의 팀 화면만 따로 띄운다: 팀 설정(TeamSettingsSection)과 공유 시트(ShareSessionDialog).
 * 사이드패널 안에서는 설정 화면까지 눌러 들어가야 보이므로, 비교·스크린샷용으로 한 페이지에 나란히 둔다.
 *   /preview/team.html?theme=dark
 */
import './boot';
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fetchSessions } from '../lib/api';
import { queryClient } from '../lib/query-client';
import { ShareSessionDialog } from '../entrypoints/sidepanel/components/team/ShareSessionDialog';
import { TeamSettingsSection } from '../entrypoints/sidepanel/components/team/TeamSettingsSection';
import '../entrypoints/sidepanel/styles/tailwind.css';

const theme = new URLSearchParams(location.search).get('theme');
const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme = dark ? 'dark' : 'light';

/** 사이드패널 폭(380px)의 칸. transform 이 있어 시트의 fixed 배치가 이 칸 안에 갇힌다. */
function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ width: 380, transform: 'translateZ(0)' }} className="flex h-[860px] flex-col overflow-hidden rounded-xl border border-orbit-border bg-orbit-bg">
      <p className="border-b border-orbit-border px-4 py-2 text-[11px] font-semibold text-orbit-muted">{title}</p>
      <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function ShareSheet() {
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions });
  const [open, setOpen] = useState(true);
  const session = sessions?.[0];
  if (!session) return <p className="p-4 text-xs text-orbit-muted">불러오는 중…</p>;
  return (
    <div className="p-4">
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-orbit-border px-3 py-1.5 text-xs">
        「{session.title}」 공유 시트 열기
      </button>
      {open && <ShareSessionDialog session={session} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TeamPreview() {
  return (
    <div className="flex min-h-screen items-start gap-6 bg-orbit-surface p-6 text-orbit-text">
      <Column title="설정 · 팀">
        <div className="p-4">
          <TeamSettingsSection />
        </div>
      </Column>
      <Column title="세션 공유 시트">
        <ShareSheet />
      </Column>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TeamPreview />
    </QueryClientProvider>
  </React.StrictMode>,
);
