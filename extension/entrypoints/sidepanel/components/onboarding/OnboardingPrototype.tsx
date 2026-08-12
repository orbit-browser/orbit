import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, CheckCheck, ExternalLink, Search, Settings } from 'lucide-react';
import type { OpenTabItem, Session } from '../../../../lib/types';
import { openTabLocationLabel } from '../../../../lib/tab-actions';
import { completeOnboarding, setOnboardingStep } from '../../../../lib/onboarding';
import { Favicon } from '../Favicon';
import { SessionRow } from '../SessionRow';
import { CollectionOptInNotice } from '../timeline/CollectionOptInNotice';
import { TimelineDateHeader } from '../timeline/TimelineDateHeader';
import { TimelineItem, type TimelineEventLike } from '../timeline/TimelineItem';
import type { TimelineBadge } from '../../hooks/useTimeline';

const STEPS = [
  {
    target: 'collection',
    title: '탐색 기록 수집을 켜세요',
    description: '방문 흐름을 기록해야 타임라인과 세션이 만들어져요. 민감한 페이지는 자동으로 제외됩니다.',
    action: null,
    hint: '강조된 수집 켜기를 눌러주세요',
  },
  {
    target: 'timeline',
    title: '방문 흐름은 타임라인에 쌓여요',
    description: '시간, 제목, 분류 상태, 머문 시간을 한눈에 보고 방금 지나온 탐색 흐름을 다시 찾을 수 있어요.',
    action: '다음',
    hint: null,
  },
  {
    target: 'sessions-tab',
    title: '이제 세션 탭으로 이동해보세요',
    description: 'Orbit이 같은 목적의 방문 기록을 어떻게 묶었는지 직접 확인해볼게요.',
    action: null,
    hint: '강조된 세션 탭을 눌러주세요',
  },
  {
    target: 'sessions',
    title: '관련 페이지는 세션으로 묶여요',
    description: '한 줄이 하나의 탐색 주제예요. 펼치면 요약과 방문한 페이지, 이어서 할 행동을 확인할 수 있어요.',
    action: '다음',
    hint: null,
  },
  {
    target: 'tabs-tab',
    title: '열린 탭도 직접 확인해보세요',
    description: '지금 브라우저에 흩어진 탭을 한곳에서 찾고 정리할 수 있어요.',
    action: null,
    hint: '강조된 열린 탭을 눌러주세요',
  },
  {
    target: 'open-tabs',
    title: '열린 탭을 찾고 북마크해요',
    description: '제목이나 주소로 검색하고, 필요한 탭을 골라 북마크하거나 바로 이동할 수 있어요.',
    action: '다음',
    hint: null,
  },
  {
    target: 'ask',
    title: '기억에 바로 질문하세요',
    description: '제목이 기억나지 않아도 자연어로 물어보면 관련 세션과 페이지를 찾아줘요.',
    action: 'Orbit 시작하기',
    hint: null,
  },
] as const;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function useSpotlight(target: string): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const element = document.querySelector<HTMLElement>(`[data-onboarding="${target}"]`);
      if (!element) return setRect(null);
      const next = element.getBoundingClientRect();
      setRect({ top: next.top, left: next.left, width: next.width, height: next.height });
    };
    measure();
    const element = document.querySelector<HTMLElement>(`[data-onboarding="${target}"]`);
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [target]);

  return rect;
}

const MOCK_TIMELINE: { event: TimelineEventLike; badge: TimelineBadge }[] = [
  ['mobbin.com', '좋은 온보딩 사례 모음', '14:32', 8, { kind: 'pending' }],
  ['developer.chrome.com', 'Chrome Side Panel API', '14:18', 12, { kind: 'pending' }],
  ['notion.so', '사용자 활성화 퍼널 정리', '13:54', 5, { kind: 'pending' }],
  ['nngroup.com', 'Product tours and contextual help', '13:41', 11, { kind: 'session', sessionId: 'mock-onboarding-research', title: '새 제품 온보딩 리서치' }],
  ['wxt.dev', 'WXT browser extension guide', '13:20', 7, { kind: 'session', sessionId: 'mock-chrome-sidepanel', title: 'Chrome 확장 사이드패널 구현' }],
  ['github.com', 'microsoft/playwright-mcp', '12:48', 14, { kind: 'session', sessionId: 'mock-chrome-sidepanel', title: 'Chrome 확장 사이드패널 구현' }],
  ['tailwindcss.com', 'Responsive design utilities', '12:17', 6, { kind: 'synced' }],
  ['react.dev', 'Managing state in React', '11:52', 9, { kind: 'synced' }],
  ['figma.com', 'Orbit onboarding flow', '11:28', 16, { kind: 'session', sessionId: 'mock-orbit-interaction', title: 'Orbit 인터랙션 디자인' }],
  ['linear.app', 'Onboarding prototype feedback', '10:46', 4, { kind: 'synced' }],
].map(([domain, title, time, minutes, badge], index) => ({
  event: {
    id: `mock-timeline-${index + 1}`,
    url: `https://${domain}/`,
    title: String(title),
    domain: String(domain),
    visitedAt: `2026-08-12T${time}:00+09:00`,
    durationMs: Number(minutes) * 60_000,
  },
  badge: badge as TimelineBadge,
}));

const MOCK_SESSIONS: Session[] = [
  {
    id: 'mock-onboarding-research',
    title: '새 제품 온보딩 리서치',
    alias: null,
    tabs: [
      { id: 'mock-tab-1', title: '좋은 온보딩 사례 모음', url: 'https://mobbin.com/' },
      { id: 'mock-tab-2', title: 'Activation patterns', url: 'https://www.nngroup.com/' },
      { id: 'mock-tab-3', title: '제품 투어 메모', url: 'https://www.notion.so/' },
    ],
    createdAt: '2026-08-12T13:42:00+09:00',
    updatedAt: '2026-08-12T14:32:00+09:00',
    lastActivityAt: '2026-08-12T14:32:00+09:00',
    timeLabel: '8/12 14:32',
    summary: { overview: '사용자 활성화 흐름과 제품 투어 사례를 비교했어요.', highlights: [] },
    summaryStatus: 'done',
  },
  {
    id: 'mock-chrome-sidepanel',
    title: 'Chrome 확장 사이드패널 구현',
    alias: null,
    tabs: [
      { id: 'mock-tab-4', title: 'Chrome Side Panel API', url: 'https://developer.chrome.com/' },
      { id: 'mock-tab-5', title: 'WXT 가이드', url: 'https://wxt.dev/' },
    ],
    createdAt: '2026-08-12T12:50:00+09:00',
    updatedAt: '2026-08-12T14:18:00+09:00',
    lastActivityAt: '2026-08-12T14:18:00+09:00',
    timeLabel: '8/12 14:18',
    summary: { overview: 'Side Panel API와 설치 이벤트 동작을 살펴봤어요.', highlights: [] },
    summaryStatus: 'done',
  },
  {
    id: 'mock-orbit-interaction',
    title: 'Orbit 인터랙션 디자인',
    alias: null,
    tabs: [
      { id: 'mock-tab-6', title: '사용자 활성화 퍼널 정리', url: 'https://www.notion.so/' },
      { id: 'mock-tab-7', title: 'Interface patterns', url: 'https://mobbin.com/' },
    ],
    createdAt: '2026-08-12T11:20:00+09:00',
    updatedAt: '2026-08-12T13:54:00+09:00',
    lastActivityAt: '2026-08-12T13:54:00+09:00',
    timeLabel: '8/12 13:54',
    summary: { overview: '사이드패널의 정보 위계와 강조 방식을 정리했어요.', highlights: [] },
    summaryStatus: 'done',
  },
  {
    id: 'mock-search-history',
    title: '검색 기록 UX 개선',
    alias: null,
    tabs: [
      { id: 'mock-tab-8', title: 'Recent search patterns', url: 'https://www.algolia.com/' },
      { id: 'mock-tab-9', title: '검색 기록 드롭다운', url: 'https://www.figma.com/' },
    ],
    createdAt: '2026-08-12T10:05:00+09:00',
    updatedAt: '2026-08-12T11:40:00+09:00',
    lastActivityAt: '2026-08-12T11:40:00+09:00',
    timeLabel: '8/12 11:40',
    summary: { overview: '최근 검색어를 다시 쓰는 흐름과 삭제 동작을 비교했어요.', highlights: [] },
    summaryStatus: 'done',
  },
  {
    id: 'mock-memory-search',
    title: '탐색 기억 검색 품질 점검',
    alias: null,
    tabs: [
      { id: 'mock-tab-10', title: 'Vector search evaluation', url: 'https://qdrant.tech/' },
      { id: 'mock-tab-11', title: 'Retrieval evaluation notes', url: 'https://www.notion.so/' },
      { id: 'mock-tab-12', title: 'Embedding models', url: 'https://huggingface.co/' },
    ],
    createdAt: '2026-08-11T16:10:00+09:00',
    updatedAt: '2026-08-11T18:24:00+09:00',
    lastActivityAt: '2026-08-11T18:24:00+09:00',
    timeLabel: '8/11 18:24',
    summary: { overview: '검색 질문별로 관련 세션이 잘 노출되는지 점검했어요.', highlights: [] },
    summaryStatus: 'done',
  },
  {
    id: 'mock-weekend-trip',
    title: '주말 부산 여행 준비',
    alias: null,
    tabs: [
      { id: 'mock-tab-13', title: '부산 전시 일정', url: 'https://www.visitbusan.net/' },
      { id: 'mock-tab-14', title: '해운대 숙소 후보', url: 'https://www.google.com/travel/' },
      { id: 'mock-tab-15', title: '부산 맛집 지도', url: 'https://map.naver.com/' },
    ],
    createdAt: '2026-08-10T19:12:00+09:00',
    updatedAt: '2026-08-10T21:08:00+09:00',
    lastActivityAt: '2026-08-10T21:08:00+09:00',
    timeLabel: '8/10 21:08',
    summary: { overview: '숙소와 전시, 이동 동선을 한 번에 비교했어요.', highlights: [] },
    summaryStatus: 'done',
  },
];

const MOCK_OPEN_TABS: OpenTabItem[] = [
  ['101', '받은메일함(7051) : 네이버 메일', 'https://mail.naver.com/', true],
  ['102', 'Branches · orbit-browser/orbit', 'https://github.com/orbit-browser/orbit/branches', false],
  ['103', '좋은 하루가 열리는 순간 · YouTube', 'https://www.youtube.com/watch?v=orbit', false],
  ['104', 'AI ROOKIE 대회', 'https://ai-rookie.or.kr/rookie/notice', false],
  ['105', 'Chrome Side Panel API', 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel', false],
  ['106', 'WXT — Next-gen Web Extension Framework', 'https://wxt.dev/', false],
  ['107', 'Orbit 온보딩 화면', 'https://www.figma.com/design/orbit', false],
  ['108', 'Playwright MCP', 'https://github.com/microsoft/playwright-mcp', false],
].map(([id, title, url, active], index) => ({
  id: String(id),
  title: String(title),
  url: String(url),
  windowId: 1,
  index,
  active: Boolean(active),
  bookmarkable: true,
}));

function MockTimeline({
  showCollection,
  onEnableCollection,
}: {
  showCollection: boolean;
  onEnableCollection: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {showCollection && (
        <div data-onboarding="collection" className="shrink-0 px-3 pt-2.5">
          <CollectionOptInNotice compact onEnabled={onEnableCollection} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        <section>
          <div data-onboarding="timeline">
            <TimelineDateHeader
              label="오늘"
              status={{ pendingCount: 3, lastSyncAt: null }}
              onClassify={() => {}}
            />
            <div className="space-y-0.5">
              {MOCK_TIMELINE.slice(0, 4).map(({ event, badge }) => (
                <TimelineItem key={event.id} event={event} badge={badge} />
              ))}
            </div>
          </div>
          <div className="space-y-0.5">
            {MOCK_TIMELINE.slice(4).map(({ event, badge }) => (
              <TimelineItem key={event.id} event={event} badge={badge} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MockSessions() {
  return (
    <div className="h-full overflow-y-auto px-2 py-2">
      <section>
        <div data-onboarding="sessions">
          <p className="sticky top-0 z-10 bg-orbit-bg px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">
            오늘
          </p>
          {MOCK_SESSIONS.slice(0, 4).map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
        <p className="sticky top-0 z-10 mt-3 bg-orbit-bg px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-orbit-muted">
          최근 7일
        </p>
        {MOCK_SESSIONS.slice(4).map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </section>
    </div>
  );
}

function MockOpenTabs() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div data-onboarding="open-tabs" className="shrink-0 px-3 pt-2.5">
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
          <p className="text-xs font-semibold text-orbit-muted">
            열린 탭 <span className="ml-1 font-normal tabular-nums">{MOCK_OPEN_TABS.length}</span>
          </p>
          <div className="flex items-center gap-2 text-[10px] font-semibold text-orbit-muted">
            <span className="flex items-center gap-1"><CheckCheck size={11} /> 전체 선택</span>
            <Search size={12} />
          </div>
        </div>
        <div className="space-y-0.5">
          {MOCK_OPEN_TABS.slice(0, 5).map((tab) => (
            <MockOpenTabRow key={tab.id} tab={tab} />
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-0.5">
        <div className="space-y-0.5">
          {MOCK_OPEN_TABS.slice(5).map((tab) => (
            <MockOpenTabRow key={tab.id} tab={tab} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MockOpenTabRow({ tab }: { tab: OpenTabItem }) {
  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5">
      <input
        type="checkbox"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none h-3.5 w-3.5 shrink-0 accent-orbit-primary"
      />
      <Favicon pageUrl={tab.url} />
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-medium text-orbit-text">{tab.title}</p>
            {tab.active && (
              <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold text-orbit-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-orbit-primary" /> 현재
              </span>
            )}
          </div>
          <p className="truncate text-[10px] leading-4 text-orbit-muted">{openTabLocationLabel(tab.url)}</p>
        </div>
        <ExternalLink size={12} className="shrink-0 text-orbit-muted" />
      </div>
    </div>
  );
}

function MockAskDock() {
  return (
    <div data-onboarding="ask" className="z-30 shrink-0 border-t border-orbit-border/60 bg-orbit-bg px-3 py-2.5">
      <div className="flex items-center gap-2 rounded-full border border-orbit-border bg-orbit-surface py-1.5 pl-4 pr-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-orbit-muted/60">
          지금 열린 GitHub 탭 찾아서 이동해줘
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orbit-border text-orbit-muted/60">
          <ArrowUp size={16} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}

function TourOverlay({ step, onNext, onSkip }: { step: number; onNext: () => void; onSkip: () => void }) {
  const current = STEPS[step];
  const rect = useSpotlight(current.target);
  const hasRect = rect !== null;
  const actionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    actionRef.current?.focus({ preventScroll: true });
  }, [step, hasRect]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSkip]);

  const padded = rect
    ? {
        top: Math.max(0, rect.top - 5),
        left: Math.max(0, rect.left - 5),
        width: Math.min(window.innerWidth, rect.left + rect.width + 5) - Math.max(0, rect.left - 5),
        height: Math.min(window.innerHeight, rect.top + rect.height + 5) - Math.max(0, rect.top - 5),
      }
    : null;
  const gap = 12;
  const targetIsInteractive = step === 0 || step === 2 || step === 4;
  const tooltipStyle = padded
    ? step === STEPS.length - 1
      ? {
          bottom: window.innerHeight - padded.top + gap,
          maxHeight: Math.max(120, padded.top - gap * 2),
        }
      : {
          top: padded.top + padded.height + gap,
          maxHeight: Math.max(120, window.innerHeight - padded.top - padded.height - gap * 2),
        }
    : undefined;
  const dimmerClass = 'pointer-events-auto fixed bg-black/70';

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-live="polite">
      {padded ? (
        <>
          <div aria-hidden="true" className={dimmerClass} style={{ inset: '0 0 auto 0', height: padded.top }} />
          <div
            aria-hidden="true"
            className={dimmerClass}
            style={{ top: padded.top + padded.height, right: 0, bottom: 0, left: 0 }}
          />
          <div
            aria-hidden="true"
            className={dimmerClass}
            style={{ top: padded.top, left: 0, width: padded.left, height: padded.height }}
          />
          <div
            aria-hidden="true"
            className={dimmerClass}
            style={{ top: padded.top, right: 0, left: padded.left + padded.width, height: padded.height }}
          />
          {!targetIsInteractive && (
            <div aria-hidden="true" className="pointer-events-auto fixed" style={padded} />
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-xl border-2 border-orbit-primary"
            style={{ ...padded, boxShadow: '0 0 0 5px rgba(240, 117, 80, 0.18)' }}
          />
        </>
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/70" />
      )}

      {padded && (
        <section
          role="dialog"
          aria-labelledby="tour-title"
          aria-describedby="tour-description"
          className="pointer-events-auto fixed left-3 right-3 overflow-y-auto rounded-2xl border border-orbit-border bg-orbit-surface p-4 shadow-orbit-overlay"
          style={tooltipStyle}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold text-orbit-primary">{step + 1} / {STEPS.length}</span>
            <button type="button" onClick={onSkip} className="cursor-pointer text-[11px] text-orbit-muted hover:text-orbit-text">
              건너뛰기
            </button>
          </div>
          <h2 id="tour-title" className="mt-2 text-sm font-bold text-orbit-text">{current.title}</h2>
          <p id="tour-description" className="mt-1.5 text-xs leading-relaxed text-orbit-muted">{current.description}</p>
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((_, index) => (
              <span key={index} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-5 bg-orbit-primary' : 'w-1.5 bg-orbit-border'}`} />
            ))}
            {current.action ? (
              <button
                ref={actionRef}
                type="button"
                onClick={onNext}
                className="ml-auto cursor-pointer rounded-full bg-orbit-primary px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-95"
              >
                {current.action}
              </button>
            ) : (
              <span className="ml-auto text-[11px] font-semibold text-orbit-primary">{current.hint}</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

type MockView = 'timeline' | 'sessions' | 'tabs';

function viewForStep(step: number): MockView {
  if (step >= 5) return 'tabs';
  if (step >= 3) return 'sessions';
  return 'timeline';
}

export function OnboardingPrototype({ initialStep }: { initialStep: number }) {
  const safeInitialStep = Math.min(initialStep, STEPS.length - 1);
  const [step, setStep] = useState(safeInitialStep);
  const [view, setView] = useState<MockView>(() => viewForStep(safeInitialStep));

  function skip() {
    void completeOnboarding();
  }

  function goToStep(nextStep: number) {
    setStep(nextStep);
    void setOnboardingStep(nextStep);
  }

  function next() {
    if (step === STEPS.length - 1) {
      void completeOnboarding();
      return;
    }
    goToStep(step + 1);
  }

  function selectView(nextView: MockView) {
    if (step === 2 && nextView === 'sessions') {
      setView('sessions');
      goToStep(3);
    }
    if (step === 4 && nextView === 'tabs') {
      setView('tabs');
      goToStep(5);
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-orbit-border bg-orbit-surface px-3">
        <div className="flex rounded-full border border-orbit-border/30 bg-orbit-bg p-0.5">
          {[
            { view: 'timeline' as const, label: '타임라인', target: undefined },
            { view: 'sessions' as const, label: '세션', target: 'sessions-tab' },
            { view: 'tabs' as const, label: '열린 탭', target: 'tabs-tab' },
          ].map((item) => {
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                data-onboarding={item.target}
                onClick={() => selectView(item.view)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-bold ${active ? 'bg-orbit-surface text-orbit-primary shadow-orbit-raised' : 'text-orbit-muted'}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <Settings size={14} className="text-orbit-muted" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === 'sessions' ? (
          <MockSessions />
        ) : view === 'tabs' ? (
          <MockOpenTabs />
        ) : (
          <MockTimeline showCollection={step === 0} onEnableCollection={next} />
        )}
      </div>

      <MockAskDock />
      <TourOverlay step={step} onNext={next} onSkip={skip} />
    </div>
  );
}
