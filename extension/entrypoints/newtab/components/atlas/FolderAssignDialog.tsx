import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderNode, SessionNode } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

interface FolderAssignDialogProps {
  folder: FolderNode;
  /** 고를 수 있는 전체 세션 — 이미 이 폴더에 있는 세션은 목록에서 뺀다. */
  sessions: SessionNode[];
  /** 폴더 이름 표시용. 다른 폴더에 있던 세션은 "이동"이라고 알려 준다. */
  folderNameById: ReadonlyMap<string, string>;
  pending: boolean;
  error: string | null;
  onSubmit: (sessionIds: string[]) => void;
  onClose: () => void;
}

/**
 * 세션 다중 선택 후 한 번에 폴더로 옮기는 대화상자.
 *
 * 드래그앤드롭만 두면 포인터를 못 쓰는 사용자가 정리를 아예 할 수 없다 —
 * 이 경로가 드래그와 동등한 대체 수단이다.
 */
export function FolderAssignDialog({
  folder,
  sessions,
  folderNameById,
  pending,
  error,
  onSubmit,
  onClose,
}: FolderAssignDialogProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sessions
      .filter((session) => session.folderId !== folder.id)
      .filter(
        (session) =>
          !normalized ||
          session.title.toLowerCase().includes(normalized) ||
          session.summary.overview.toLowerCase().includes(normalized),
      );
  }, [folder.id, query, sessions]);

  const toggle = (sessionId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const submit = () => {
    if (picked.size === 0 || pending) return;
    // 화면에 보이는 순서대로 보낸다 — 결과의 assigned 순서와 눈으로 맞춰 볼 수 있다.
    onSubmit(candidates.filter((session) => picked.has(session.id)).map((session) => session.id));
  };

  return (
    <div className="atlas-modal" role="dialog" aria-modal="true" aria-label={`${folder.name}에 세션 추가`}>
      <div className="atlas-modal__backdrop" onClick={onClose} />
      <div className="atlas-modal__panel">
        <div className="atlas-modal__head">
          <div>
            <div className="atlas-modal__title">
              <span className="atlas-modal__dot" style={{ background: folder.hue }} />
              {folder.name}
            </div>
            <div className="atlas-modal__sub">넣을 세션을 고르세요</div>
          </div>
          <button type="button" className="atlas-modal__close" onClick={onClose} aria-label="닫기">
            <i className="ph ph-x" />
          </button>
        </div>

        <input
          ref={searchRef}
          type="text"
          className="atlas-modal__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="세션 검색"
          spellCheck={false}
        />

        <div className="atlas-modal__list">
          {candidates.length === 0 && (
            <div className="atlas-modal__empty">
              {query ? '일치하는 세션이 없습니다' : '넣을 수 있는 세션이 없습니다'}
            </div>
          )}

          {candidates.map((session) => {
            const currentFolder = session.folderId
              ? folderNameById.get(session.folderId)
              : undefined;
            return (
              <label
                key={session.id}
                className={cx('atlas-modal__row', picked.has(session.id) && 'atlas-modal__row--on')}
              >
                <input
                  type="checkbox"
                  checked={picked.has(session.id)}
                  onChange={() => toggle(session.id)}
                />
                <span className="atlas-modal__row-body">
                  <span className="atlas-modal__row-title">{session.title}</span>
                  <span className="atlas-modal__row-meta">
                    {session.date} · 페이지 {session.pages.length}
                    {/* 단일 소속이라 다른 폴더에서 빠져나온다 — 미리 알려 준다. */}
                    {currentFolder && <span className="atlas-modal__moved">{currentFolder}에서 이동</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {error && <div className="atlas-modal__error" role="alert">{error}</div>}

        <div className="atlas-modal__foot">
          <span className="atlas-modal__count">{picked.size}개 선택됨</span>
          <div className="atlas-modal__actions">
            <button type="button" onClick={onClose}>취소</button>
            <button
              type="button"
              className="atlas-modal__primary"
              onClick={submit}
              disabled={picked.size === 0 || pending}
            >
              {pending ? '추가하는 중...' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
