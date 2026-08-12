import { Clock, X } from 'lucide-react';
import type { SearchHistoryEntry } from '../../lib/search-history';

interface SearchHistoryDropdownProps {
  entries: SearchHistoryEntry[];
  /** 키보드 ↑↓ 로 고른 항목. 마우스만 쓸 때는 -1 이다. */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  /** 목록 전체를 감싸는 listbox 의 id — 입력창의 aria-controls 와 짝을 맞춘다. */
  listboxId: string;
}

/**
 * 검색창 포커스 시 아래로 열리는 최근 검색 기록.
 *
 * 항목을 고르면 곧바로 검색이 실행된다(크롬·구글 새 탭과 같은 동작).
 * 목록은 절대 배치라 아래 바로가기 줄을 밀어내지 않는다.
 */
export function SearchHistoryDropdown({
  entries,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  onRemove,
  listboxId,
}: SearchHistoryDropdownProps) {
  return (
    <ul className="search-history" id={listboxId} role="listbox" aria-label="최근 검색 기록">
      {entries.map((entry, index) => (
        <li
          key={entry.query}
          id={`${listboxId}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={`search-history__item${index === activeIndex ? ' search-history__item--active' : ''}`}
          // 입력창의 blur 가 클릭보다 먼저 일어나 목록이 닫히면 클릭이 사라진다.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onSelect(entry.query)}
        >
          <Clock size={15} className="search-history__icon" aria-hidden />
          <span className="search-history__query">{entry.query}</span>
          <button
            type="button"
            className="search-history__remove"
            aria-label={`최근 검색 기록에서 "${entry.query}" 삭제`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(entry.query);
            }}
          >
            <X size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
