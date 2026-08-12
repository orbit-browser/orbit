import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { navigateToAtlas } from '../../lib/navigation';
import { patchNavState } from '../../lib/nav-state';
import { parseOmniboxInput } from '../../../../lib/omnibox';
import {
  filterSearchHistory,
  loadSearchHistory,
  recordSearchQuery,
  removeSearchQuery,
  saveSearchHistory,
  type SearchHistoryEntry,
} from '../../lib/search-history';
import { SearchHistoryDropdown } from './SearchHistoryDropdown';
import { Shortcuts } from './Shortcuts';

const HISTORY_LISTBOX_ID = 'hero-search-history';

interface OrbitHeroProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onAskAI: (prompt: string) => void;
  isAsking: boolean;
  mode: 'search' | 'ai';
  onModeChange: (mode: 'search' | 'ai') => void;
}

export function OrbitHero({
  searchQuery,
  onSearchChange,
  onAskAI,
  isAsking,
  mode,
  onModeChange,
}: OrbitHeroProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [focused, setFocused] = useState(false);
  /** Esc 로 목록만 닫은 상태. 다시 입력하거나 ↓ 를 누르면 풀린다. */
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    void loadSearchHistory().then((list) => {
      if (!cancelled) setHistory(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 입력 중이면 그 값으로 좁힌다. AI 모드의 질문은 검색 기록이 아니므로 목록을 띄우지 않는다.
  const visibleHistory = useMemo(
    () => (mode === 'search' ? filterSearchHistory(history, searchQuery) : []),
    [mode, history, searchQuery],
  );
  const historyOpen = focused && !dismissed && visibleHistory.length > 0;
  const activeEntry = historyOpen ? visibleHistory[activeIndex] : undefined;

  /**
   * 시안에서는 검색 모드가 아무 동작도 하지 않았다.
   * 확장에서는 이 입력창이 새 탭의 주소창 역할을 겸하므로,
   * 주소면 이동하고 아니면 사용자의 기본 검색엔진으로 넘긴다(`lib/omnibox.ts`).
   */
  const runSearch = async (raw: string) => {
    if (!raw.trim()) return;

    setError(null);
    const intent = parseOmniboxInput(raw);
    if (intent.kind === 'navigate') {
      window.location.assign(intent.url);
      return;
    }

    // 결과 페이지가 이 탭을 대체하면 이후 저장이 실행되지 않으므로 검색보다 먼저 기록한다.
    setHistory(await recordSearchQuery(intent.query));

    try {
      // 새 탭 자신을 결과 페이지로 대체 — 기본 브라우저 동작과 같다.
      await chrome.search.query({ text: intent.query, disposition: 'CURRENT_TAB' });
    } catch (err) {
      // 조용히 삼키면 사용자는 엔터가 먹히지 않은 것으로만 보인다.
      console.error('[Orbit] 검색 실패', err);
      setError('검색을 시작하지 못했어요. 크롬 기본 검색엔진 설정을 확인해 주세요.');
    }
  };

  const closeHistory = () => {
    setDismissed(true);
    setActiveIndex(-1);
  };

  /** 최근 기록에서 고른 항목은 입력창에도 반영한 뒤 곧바로 검색한다. */
  const selectHistoryEntry = (query: string) => {
    onSearchChange(query);
    closeHistory();
    void runSearch(query);
  };

  const handleRemoveHistory = async (query: string) => {
    const next = removeSearchQuery(history, query);
    setHistory(next);
    setActiveIndex(-1);
    await saveSearchHistory(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() && !activeEntry) return;

    if (mode === 'ai') {
      setError(null);
      onAskAI(searchQuery);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return;
    }

    // ↑↓ 로 고른 항목이 있으면 입력값 대신 그 검색어를 쓴다.
    if (activeEntry) {
      selectHistoryEntry(activeEntry.query);
      return;
    }

    closeHistory();
    await runSearch(searchQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      onModeChange(mode === 'search' ? 'ai' : 'search');
      return;
    }

    if (mode !== 'search') return;

    if (e.key === 'ArrowDown') {
      if (visibleHistory.length === 0) return;
      e.preventDefault();
      if (dismissed) {
        // Esc 로 닫아둔 목록은 ↓ 로 다시 열고 첫 항목을 고른다.
        setDismissed(false);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((prev) => (prev + 1) % visibleHistory.length);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!historyOpen) return;
      // 맨 위에서 한 번 더 올리면 선택을 풀어 원래 입력값으로 돌아간다.
      setActiveIndex((prev) => (prev <= 0 ? -1 : prev - 1));
      return;
    }

    if (e.key === 'Escape' && historyOpen) {
      e.preventDefault();
      closeHistory();
    }
  };

  return (
    <div className="composer-section">
      {/*
        시그니처 Orbit 그래픽 — 특정 세션이 아니라 대시보드 전체를 둘러보러 가는 입구다.
        이 경로로만 네비게이터를 펼친 채 연다(카드·타임라인에서 특정 세션으로 들어갈 때는
        오른쪽 내용에 집중하도록 닫힌 채 둔다).
      */}
      <div
        className="signature-orbit"
        title="대시보드 열기"
        onClick={() => {
          patchNavState({ open: true });
          navigateToAtlas();
        }}
      >
        <svg viewBox="0 0 240 240" width="208" height="208" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="saturnGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent-orange)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--accent-orange)" stopOpacity="0" />
            </radialGradient>
            {/* 고리 한쪽이 밝고 반대쪽이 흐려져 회전이 더 잘 읽힌다 */}
            <linearGradient id="ringSheen" x1="0" y1="0.1" x2="1" y2="0.9">
              <stop offset="0%" stopColor="var(--accent-orange)" stopOpacity="0.25" />
              <stop offset="42%" stopColor="var(--accent-orange)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--accent-orange)" stopOpacity="0.35" />
            </linearGradient>
          </defs>

          <circle cx="120" cy="120" r="46" fill="url(#saturnGlow)" className="glow-backdrop" pointerEvents="none" />

          <g className="saturn">
            {/* 행성 뒤로 지나가는 고리 (위쪽 반원) */}
            <g className="saturn__band saturn__band--back">
              <path className="ring ring--inner" d="M 68 120 A 52 15 0 0 1 172 120" />
              <path className="ring ring--dust" d="M 42 120 A 78 22 0 0 1 198 120" />
              <path className="ring ring--outer" d="M 20 120 A 100 28 0 0 1 220 120" />
            </g>

            {/* 행성 */}
            <g className="saturn__planet">
              <circle cx="120" cy="120" r="24" fill="var(--accent-orange)" />
              <circle cx="120" cy="120" r="24" stroke="#ffffff" strokeWidth="1" opacity="0.22" />
            </g>

            {/* 행성 앞으로 지나오는 고리 (아래쪽 반원) */}
            <g className="saturn__band saturn__band--front">
              {/* 케이싱 — 행성과 겹치는 구간에서 고리가 묻히지 않게 분리선을 만든다 */}
              <path className="ring ring--casing ring--inner" d="M 68 120 A 52 15 0 0 0 172 120" />
              <path className="ring ring--casing ring--dust" d="M 42 120 A 78 22 0 0 0 198 120" />
              <path className="ring ring--casing ring--outer" d="M 20 120 A 100 28 0 0 0 220 120" />

              <path className="ring ring--inner" d="M 68 120 A 52 15 0 0 0 172 120" />
              <path className="ring ring--dust" d="M 42 120 A 78 22 0 0 0 198 120" />
              <path className="ring ring--outer" d="M 20 120 A 100 28 0 0 0 220 120" />
            </g>

          </g>
        </svg>
      </div>

      {/* 검색창 — 모드 전환을 입력창 안에 넣어 요소 수를 줄였다 */}
      <div className="search-container">
        <form onSubmit={handleSubmit}>
          <div className="search-shell">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                // 입력이 바뀌면 목록 후보도 바뀐다. 다시 열고 선택은 푼다.
                setDismissed(false);
                setActiveIndex(-1);
              }}
              onFocus={() => {
                setFocused(true);
                setDismissed(false);
              }}
              onBlur={() => {
                setFocused(false);
                setActiveIndex(-1);
              }}
              role="combobox"
              aria-expanded={historyOpen}
              aria-controls={HISTORY_LISTBOX_ID}
              aria-activedescendant={
                activeEntry ? `${HISTORY_LISTBOX_ID}-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
              autoComplete="off"
              placeholder={
                mode === 'search'
                  ? '검색어 또는 주소를 입력하세요'
                  : '질문하거나 “GitHub 탭으로 이동해줘”라고 말해보세요'
              }
              className="search-field"
              onKeyDown={handleKeyDown}
            />

            <div className="search-shell__actions">
              <span className="search-shell__hint">
                <kbd>Tab</kbd> 전환
              </span>
              <div className="search-shell__modes">
                <button
                  type="button"
                  className={`search-shell__mode${mode === 'search' ? ' search-shell__mode--active' : ''}`}
                  onClick={() => onModeChange('search')}
                >
                  검색
                </button>
                <button
                  type="button"
                  className={`search-shell__mode${mode === 'ai' ? ' search-shell__mode--active' : ''}`}
                  onClick={() => onModeChange('ai')}
                >
                  AI에게 질문
                </button>
              </div>
              {mode === 'ai' && (
                <button
                  type="submit"
                  className="search-shell__submit"
                  aria-label="질문 보내기"
                  disabled={isAsking}
                >
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>

          {historyOpen && (
            <SearchHistoryDropdown
              entries={visibleHistory}
              activeIndex={activeIndex}
              onActiveIndexChange={setActiveIndex}
              onSelect={selectHistoryEntry}
              onRemove={(query) => void handleRemoveHistory(query)}
              listboxId={HISTORY_LISTBOX_ID}
            />
          )}
        </form>

        {error && (
          <p className="search-error" role="alert">
            {error}
          </p>
        )}

        <Shortcuts />
      </div>
    </div>
  );
}
