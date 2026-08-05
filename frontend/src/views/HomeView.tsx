import { useState } from 'react';
import { Search, Archive, Sparkles, Layers } from 'lucide-react';
import { useSessions, useSearch } from '../hooks/useSessions';
import { SessionCard } from '../components/SessionCard';
import { AnalyticsSection } from '../components/analytics/AnalyticsSection';

type LocalMode = 'sessions' | 'search';

const QUICK_TASKS = [
  {
    id: 'ai-restore',
    gradient: 'linear-gradient(135deg, #7c6ef6 0%, #a78bfa 100%)',
    Icon: Sparkles,
    title: 'AI로 세션 복원',
    description: '자연어로 원하는 세션을 찾아 탭을 한 번에 열어요.',
    action: 'AI 검색 시작하기',
    targetMode: 'search' as LocalMode,
  },
  {
    id: 'browse',
    gradient: 'linear-gradient(135deg, #ec4899 0%, #c084fc 100%)',
    Icon: Archive,
    title: '세션 모두 보기',
    description: '저장한 모든 탭 세션을 한눈에 확인하고 정리해요.',
    action: '세션 목록 열기',
    targetMode: 'sessions' as LocalMode,
  },
  {
    id: 'extension',
    gradient: 'linear-gradient(135deg, #f97316 0%, #fbbf24 100%)',
    Icon: Layers,
    title: '익스텐션으로 저장',
    description: 'Chrome 익스텐션으로 현재 탭을 세션으로 저장해요.',
    action: '익스텐션 설치하기',
    targetMode: 'sessions' as LocalMode,
  },
];

export function HomeView() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<LocalMode>('sessions');

  const { data: sessions, isLoading: sessionsLoading, isError: sessionsError } = useSessions();
  const { data: searchResults, isLoading: searchLoading } = useSearch(
    mode === 'search' && query.trim() ? query : '',
  );

  const isLoading = mode === 'sessions' ? sessionsLoading : query.trim() ? searchLoading : sessionsLoading;
  const displayData = mode === 'sessions' ? sessions : query.trim() ? searchResults : sessions;
  const hasError = sessionsError && mode === 'sessions';

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (e.target.value.trim()) setMode('search');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      setMode((m) => (m === 'sessions' ? 'search' : 'sessions'));
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-orbit-bg px-4 pb-16">

      {/* ── Hero: 로고 + 검색바를 뷰포트 수직 중앙에 배치 ── */}
      <div className="flex min-h-screen w-full flex-col items-center justify-center pb-24">
        <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-full border border-orbit-border bg-orbit-surface shadow-sm">
          <span className="text-xl font-bold text-orbit-primary">O</span>
        </div>

        <div className="w-full max-w-[660px]">
          <div
            className={[
              'flex items-center gap-2 rounded-2xl border bg-orbit-surface px-3 py-2.5 transition',
              mode === 'search'
                ? 'border-orbit-primary/50 shadow-[0_0_0_3px_rgba(242,102,10,0.08)]'
                : 'border-orbit-border shadow-sm',
            ].join(' ')}
          >
            <Search size={16} className="shrink-0 text-orbit-muted" />
            <input
              type="text"
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="세션을 검색하거나 AI에게 물어보세요…"
              className="min-w-0 flex-1 bg-transparent text-sm text-orbit-text outline-none placeholder:text-orbit-muted"
            />
            <span className="hidden shrink-0 text-[11px] text-orbit-muted sm:inline">Tab 으로 전환</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => { setMode('sessions'); setQuery(''); }}
                className={[
                  'rounded-lg px-3 py-1 text-xs font-medium transition',
                  mode === 'sessions'
                    ? 'bg-orbit-text text-white'
                    : 'text-orbit-muted hover:text-orbit-text',
                ].join(' ')}
              >
                검색
              </button>
              <button
                type="button"
                onClick={() => setMode('search')}
                className={[
                  'rounded-lg px-3 py-1 text-xs font-medium transition',
                  mode === 'search'
                    ? 'bg-orbit-primary text-white'
                    : 'text-orbit-muted hover:text-orbit-text',
                ].join(' ')}
              >
                AI 검색
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sessions section (첫 화면에 표시) ── */}
      <div className="w-full max-w-[860px]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-0.5 rounded-xl bg-black/[0.06] p-1">
            <button
              type="button"
              onClick={() => { setMode('sessions'); setQuery(''); }}
              className={[
                'rounded-[8px] px-3.5 py-1.5 text-[13px] transition',
                mode === 'sessions'
                  ? 'bg-white font-semibold text-orbit-text shadow-sm'
                  : 'font-normal text-orbit-muted hover:text-orbit-text',
              ].join(' ')}
            >
              세션 목록
            </button>
            <button
              type="button"
              onClick={() => setMode('search')}
              className={[
                'rounded-[8px] px-3.5 py-1.5 text-[13px] transition',
                mode === 'search'
                  ? 'bg-white font-semibold text-orbit-text shadow-sm'
                  : 'font-normal text-orbit-muted hover:text-orbit-text',
              ].join(' ')}
            >
              AI 검색
            </button>
          </div>
          {sessions && sessions.length > 0 && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-[13px] text-orbit-muted transition hover:text-orbit-text"
            >
              모두 보기 <span className="text-base leading-none">›</span>
            </button>
          )}
        </div>

        {/* 세션 목록 — 세션이 없을 때도 추천 작업이 스크롤 아래로 밀리도록 min-h 보장 */}
        <div className="min-h-[260px]">
          {isLoading && (
            <p className="py-8 text-center text-sm text-orbit-muted">불러오는 중…</p>
          )}
          {hasError && (
            <p className="py-8 text-center text-sm text-red-500">
              백엔드에 연결할 수 없어요. 서버가 실행 중인지 확인해 주세요.
            </p>
          )}
          {!isLoading && !hasError && displayData?.length === 0 && (
            <p className="py-8 text-center text-sm text-orbit-muted">
              {mode === 'search' && query.trim()
                ? '검색 결과가 없어요'
                : '저장된 세션이 없어요. Chrome 익스텐션으로 탭을 저장해보세요.'}
            </p>
          )}
          {!isLoading && displayData && displayData.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {displayData.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
            </div>
          )}
        </div>
      </div>

      <AnalyticsSection />

      {/* ── Suggested tasks (스크롤해야 보임) ── */}
      <div className="mt-20 w-full max-w-[860px]">
        <h2 className="mb-4 text-[15px] font-semibold text-orbit-text">추천 작업</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {QUICK_TASKS.map(({ id, gradient, Icon, title, description, action, targetMode }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(targetMode)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-orbit-border bg-orbit-surface text-left transition hover:shadow-md"
            >
              <div
                className="flex h-[120px] w-full items-center justify-center"
                style={{ background: gradient }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/25">
                  <Icon size={20} className="text-white" />
                </div>
              </div>
              <div className="p-4">
                <p className="font-semibold text-orbit-text">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-orbit-muted">{description}</p>
                <p className="mt-3 flex items-center gap-1 text-[13px] font-medium text-orbit-primary">
                  {action}
                  <span className="transition group-hover:translate-x-0.5">↗</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
