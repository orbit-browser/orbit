import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import {
  appendShortcut,
  faviconUrl,
  loadShortcuts,
  loadShortcutsOpen,
  normalizeShortcutInput,
  saveShortcuts,
  saveShortcutsOpen,
  type Shortcut,
} from '../../lib/shortcuts';

/**
 * 검색창 아래 바로가기 줄. 크롬 기본 새 탭과 같은 자리·같은 역할이다.
 *
 * 처음에는 자주 방문한 사이트(topSites)를 보여주고, 사용자가 추가하거나 지우면
 * 그때부터는 사용자 목록만 쓴다. 펼침 상태는 저장돼 다음에 열 때도 유지된다.
 */
export function Shortcuts() {
  const [items, setItems] = useState<Shortcut[]>([]);
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', url: '' });
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loadedShortcuts, isOpen] = await Promise.all([loadShortcuts(), loadShortcutsOpen()]);
      if (cancelled) return;
      setItems(loadedShortcuts.list);
      setError(loadedShortcuts.error);
      setOpen(isOpen);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 추가 폼이 열리면 주소 칸으로 바로 커서를 보낸다.
  useEffect(() => {
    if (adding) urlInputRef.current?.focus();
  }, [adding]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    void saveShortcutsOpen(next);
  };

  /** 목록을 바꾸면 그 순간부터 "사용자가 편집한 목록"이 되어 topSites 를 더 쓰지 않는다. */
  const commit = async (list: Shortcut[]) => {
    setItems(list);
    setError(await saveShortcuts(list));
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = normalizeShortcutInput(form.title, form.url);
    if (!normalized.ok) {
      setError(normalized.reason);
      return;
    }
    const appended = appendShortcut(items, normalized.shortcut);
    if (!appended.ok) {
      setError(appended.reason);
      return;
    }
    setForm({ title: '', url: '' });
    setError(null);
    setAdding(false);
    void commit(appended.list);
  };

  const closeForm = () => {
    setAdding(false);
    setError(null);
    setForm({ title: '', url: '' });
  };

  // 로드 전에는 자리만 잡아 둔다 — 목록이 뒤늦게 튀어나오며 화면이 밀리지 않게.
  if (!loaded) return <div className="shortcuts shortcuts--placeholder" />;

  return (
    <div className="shortcuts">
      <button
        type="button"
        className="shortcuts__toggle"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="shortcuts-panel"
      >
        <span>바로가기</span>
        <ChevronDown
          size={12}
          className={`shortcuts__caret${open ? ' shortcuts__caret--open' : ''}`}
        />
      </button>

      {open && (
        <div className="shortcuts__panel" id="shortcuts-panel">
          <div className="shortcuts__grid">
            {items.map((item) => (
              <div className="shortcut" key={item.id}>
                <a className="shortcut__link" href={item.url} title={item.url}>
                  <span className="shortcut__tile">
                    <img
                      className="shortcut__icon"
                      src={faviconUrl(item.url)}
                      alt=""
                      width={24}
                      height={24}
                    />
                  </span>
                  <span className="shortcut__label">{item.title}</span>
                </a>
                <button
                  type="button"
                  className="shortcut__remove"
                  aria-label={`${item.title} 바로가기 삭제`}
                  title="삭제"
                  onClick={() => void commit(items.filter((s) => s.id !== item.id))}
                >
                  <X size={11} />
                </button>
              </div>
            ))}

            <div className="shortcut">
              <button type="button" className="shortcut__link" onClick={() => setAdding(true)}>
                <span className="shortcut__tile shortcut__tile--add">
                  <Plus size={20} />
                </span>
                <span className="shortcut__label">바로가기 추가</span>
              </button>
            </div>
          </div>

          {adding && (
            <form className="shortcut-form" onSubmit={handleAdd}>
              <input
                className="shortcut-form__field"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="이름 (선택)"
                aria-label="바로가기 이름"
              />
              <input
                ref={urlInputRef}
                className="shortcut-form__field"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="주소 (예: github.com)"
                aria-label="바로가기 주소"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeForm();
                }}
              />
              <button type="submit" className="shortcut-form__submit">
                추가
              </button>
              <button type="button" className="shortcut-form__cancel" onClick={closeForm}>
                취소
              </button>
            </form>
          )}

          {error && (
            <p className="shortcut-form__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
