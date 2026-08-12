import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate } from '../../lib/navigation';
import { SessionFavicons } from './SessionFavicons';
import { FolderAssignDialog } from './FolderAssignDialog';
import { loadSeenSessions, markSessionSeen } from '../../lib/seen-sessions';
import { useSessionSync } from '../../hooks/useSessionSync';
import { useFolderMutations } from '../../hooks/useFolders';
import { sortSessions, type FolderNode, type SessionNode, type SessionSort } from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

/** 드래그 중인 세션을 실어 나르는 키. 다른 곳에서 온 드롭은 무시한다. */
const DRAG_TYPE = 'application/x-orbit-session';

interface AtlasNavigatorProps {
  folders: FolderNode[];
  unfiled: SessionNode[];
  /** 폴더 소속과 무관한 전체 세션 — 검색과 일괄 추가 후보에 쓴다. */
  sessions: SessionNode[];
  query: string;
  onQueryChange: (value: string) => void;
  focusedFolderId: string | null;
  focusedSessionId: string | null;
  selectedPageId: string | null;
  expandedFolderIds: Set<string>;
  expandedSessionIds: Set<string>;
  onToggleFolder: (id: string) => void;
  onToggleSession: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onSelectSession: (id: string) => void;
  onSelectPage: (sessionId: string, pageId: string) => void;
  onCollapseAll: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  resizable?: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
  sort: SessionSort;
  onSortChange: (sort: SessionSort) => void;
}

const SORT_LABEL: Record<SessionSort, string> = {
  recent: '최신순',
  title: '가나다순',
};

const SORT_ICON: Record<SessionSort, string> = {
  recent: 'ph-clock-counter-clockwise',
  title: 'ph-sort-ascending',
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="atlas-nav__mark">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

const NAV_MIN_WIDTH = 216;
const NAV_MAX_WIDTH = 420;

export function AtlasNavigator({
  folders,
  unfiled,
  sessions,
  query,
  onQueryChange,
  focusedFolderId,
  focusedSessionId,
  selectedPageId,
  expandedFolderIds,
  expandedSessionIds,
  onToggleFolder,
  onToggleSession,
  onSelectFolder,
  onSelectSession,
  onSelectPage,
  onCollapseAll,
  width,
  onWidthChange,
  resizable = true,
  searchOpen,
  onSearchOpenChange,
  searchInputRef,
  sort,
  onSortChange,
}: AtlasNavigatorProps) {
  /**
   * "새로 저장됨" 점을 이미 확인한 세션들. 사용자가 세션을 열면 표시를 지운다.
   */
  const [seenSessions, setSeenSessions] = useState<Set<string>>(() => new Set());

  // 사이드패널에서 병합하면 새로고침 없이 여기 목록이 따라 바뀐다.
  const { absorbingId, survivingId } = useSessionSync();
  const { create, rename, remove, assign, unassign, renameSessionAlias } = useFolderMutations();

  /** 드롭 대상 강조 — 'unfiled' 는 폴더에서 빼는 자리. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /**
   * 세션을 끄는 중인지. "정리 안 됨" 자리는 비었으면 감추지만, 끌고 있는 동안에는
   * 폴더에서 빼는 유일한 드롭 대상이라 도로 꺼내 준다.
   */
  const [draggingSession, setDraggingSession] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** 이름을 고치고 있는 세션. 폴더 이름 편집과 상태를 나눠 둔다(id 가 겹칠 수 있다). */
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSeenSessions().then((seen) => {
      if (!cancelled) setSeenSessions(seen);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);
      void markSessionSeen(seenSessions, sessionId).then(setSeenSessions);
    },
    [onSelectSession, seenSessions],
  );

  useEffect(() => {
    if (query && !searchOpen) onSearchOpenChange(true);
  }, [query, searchOpen, onSearchOpenChange]);

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  /**
   * 검색은 폴더 계층을 무시하고 평면 결과를 낸다.
   *
   * 2뎁스에서는 세션이 어느 폴더에 있는지 모르면 찾을 수 없다 — 잘못 넣어 둔 세션도
   * 검색으로는 반드시 나와야 한다.
   */
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;

    return sessions.flatMap((session) => {
      const sessionHit =
        session.title.toLowerCase().includes(normalized) ||
        session.summary.overview.toLowerCase().includes(normalized);
      const pages = session.pages.filter(
        (page) =>
          page.title.toLowerCase().includes(normalized) ||
          page.domain.toLowerCase().includes(normalized),
      );
      if (!sessionHit && pages.length === 0) return [];
      return [{ session, pageIds: sessionHit ? null : new Set(pages.map((page) => page.id)) }];
    });
  }, [query, sessions]);

  const runFolderAction = useCallback(
    async (action: () => Promise<unknown>, failure: string) => {
      setFolderError(null);
      try {
        await action();
        return true;
      } catch {
        // 원인 문자열에는 내부 경로가 섞여 있어 그대로 보여주지 않는다.
        setFolderError(failure);
        return false;
      }
    },
    [],
  );

  /**
   * 새 폴더 확정.
   *
   * Enter 와 blur 가 같은 함수를 부른다 — 요청을 기다리는 동안 입력창을 남겨 두면
   * 성공 뒤 입력창이 사라지며 blur 가 한 번 더 발화해 같은 이름으로 폴더가 두 개
   * 생긴다. 그래서 **먼저 입력창을 닫고** 요청을 보내며, 실패했을 때만 되돌린다.
   */
  const submitNewFolder = async () => {
    const name = draftName.trim();
    setCreating(false);
    setDraftName('');
    if (!name) return;
    const ok = await runFolderAction(() => create.mutateAsync(name), '폴더를 만들지 못했어요');
    if (!ok) {
      setDraftName(name);
      setCreating(true);
    }
  };

  /** 새 폴더와 같은 이유로 입력창을 먼저 닫는다 — blur 가 요청을 한 번 더 보내지 않도록. */
  const submitRename = async (folderId: string) => {
    const name = draftName.trim();
    setRenamingId(null);
    setDraftName('');
    if (!name) return;
    const ok = await runFolderAction(
      () => rename.mutateAsync({ folderId, name }),
      '이름을 바꾸지 못했어요',
    );
    if (!ok) {
      setDraftName(name);
      setRenamingId(folderId);
    }
  };

  /**
   * 세션 이름 확정 — 폴더와 같은 이유로 입력창을 먼저 닫고 요청을 보낸다.
   *
   * 서버에는 별칭으로 저장되고 AI 가 만든 원래 이름은 그대로 남는다. 비우면 별칭을
   * 지워 원래 이름으로 돌아간다.
   */
  const submitSessionName = async (session: SessionNode) => {
    const name = draftName.trim();
    setRenamingSessionId(null);
    setDraftName('');
    if (name === (session.alias ?? '')) return;

    const ok = await runFolderAction(
      () => renameSessionAlias.mutateAsync({ sessionId: session.id, alias: name }),
      '이름을 바꾸지 못했어요',
    );
    if (!ok) {
      setDraftName(name);
      setRenamingSessionId(session.id);
    }
  };

  const deleteFolderWithConfirm = async (folder: FolderNode) => {
    const message =
      folder.sessions.length > 0
        ? `"${folder.name}" 폴더를 지울까요?\n안에 있던 세션 ${folder.sessions.length}개는 지워지지 않고 정리 안 됨으로 돌아갑니다.`
        : `"${folder.name}" 폴더를 지울까요?`;
    if (!window.confirm(message)) return;
    await runFolderAction(() => remove.mutateAsync(folder.id), '폴더를 지우지 못했어요');
  };

  const handleDropOnFolder = async (folderId: string, event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const sessionId = event.dataTransfer.getData(DRAG_TYPE);
    if (!sessionId) return;
    await runFolderAction(
      () => assign.mutateAsync({ folderId, sessionIds: [sessionId] }),
      '세션을 옮기지 못했어요',
    );
  };

  const handleDropOnUnfiled = async (event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const sessionId = event.dataTransfer.getData(DRAG_TYPE);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session?.folderId) return;
    await runFolderAction(
      () => unassign.mutateAsync({ folderId: session.folderId as string, sessionId }),
      '세션을 빼지 못했어요',
    );
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: PointerEvent) => {
      onWidthChange(
        Math.min(NAV_MAX_WIDTH, Math.max(NAV_MIN_WIDTH, startWidth + moveEvent.clientX - startX)),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('atlas-resizing');
    };
    document.body.classList.add('atlas-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 세션 한 줄과 그 아래 페이지들. 폴더 안이든 미정리든 같은 모양으로 그린다. */
  const renderSession = (session: SessionNode, visiblePageIds: Set<string> | null) => {
    const isOpen = visiblePageIds !== null || expandedSessionIds.has(session.id);
    const visiblePages = visiblePageIds
      ? session.pages.filter((page) => visiblePageIds.has(page.id))
      : session.pages;

    return (
      <div className="atlas-branch" key={session.id}>
        <div
          className={cx(
            'atlas-row',
            'atlas-row--session',
            focusedSessionId === session.id && 'atlas-row--focused',
            absorbingId === session.id && 'atlas-row--absorbing',
            survivingId === session.id && 'atlas-row--surviving',
          )}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, session.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingSession(true);
          }}
          onDragEnd={() => setDraggingSession(false)}
          onClick={() => renamingSessionId !== session.id && handleSelectSession(session.id)}
          onKeyDown={(event) =>
            event.key === 'Enter' &&
            renamingSessionId !== session.id &&
            handleSelectSession(session.id)
          }
          role="button"
          tabIndex={0}
          title={`${session.title} — ${session.date}`}
        >
          <button
            type="button"
            className="atlas-row__caret"
            aria-label={isOpen ? '접기' : '펼치기'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSession(session.id);
            }}
          >
            <i className={isOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'} />
          </button>
          {renamingSessionId === session.id ? (
            <input
              autoFocus
              className="atlas-row__input"
              value={draftName}
              placeholder={session.title}
              maxLength={100}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void submitSessionName(session)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') void submitSessionName(session);
                // 이름을 먼저 비워야 뒤따르는 blur 가 별칭을 덮어쓰지 않는다.
                if (event.key === 'Escape') {
                  setDraftName('');
                  setRenamingSessionId(null);
                }
              }}
            />
          ) : (
            <span className="atlas-row__label">
              <Highlight text={session.title} query={query} />
            </span>
          )}
          <span className="atlas-row__meta">{session.pages.length}p</span>
          {/* 대표 아이콘은 오른쪽 끝 — 제목이 길어져도 자리가 흔들리지 않는다 */}
          <span className="atlas-row__trailing">
            <button
              type="button"
              className="atlas-row__action"
              aria-label={`${session.title} 이름 바꾸기`}
              title="이름 바꾸기"
              onClick={(event) => {
                event.stopPropagation();
                setFolderError(null);
                // 별칭이 없으면 빈 칸으로 시작하고 원래 이름을 placeholder 로 보여 준다.
                setDraftName(session.alias ?? '');
                setRenamingSessionId(session.id);
              }}
            >
              <i className="ph ph-pencil-simple" />
            </button>
            {session.folderId && (
              <button
                type="button"
                className="atlas-row__unfile"
                aria-label="폴더에서 빼기"
                title="폴더에서 빼기"
                onClick={(event) => {
                  event.stopPropagation();
                  void runFolderAction(
                    () =>
                      unassign.mutateAsync({
                        folderId: session.folderId as string,
                        sessionId: session.id,
                      }),
                    '세션을 빼지 못했어요',
                  );
                }}
              >
                <i className="ph ph-arrow-line-up-right" />
              </button>
            )}
            {session.status === 'live' && !seenSessions.has(session.id) ? (
              <span className="atlas-row__live" title="새로 저장된 세션" />
            ) : (
              <SessionFavicons pages={session.pages} hue={session.hue} />
            )}
          </span>
        </div>

        {isOpen && (
          <div
            className="atlas-branch__children"
            style={{ '--branch-hue': session.hue } as React.CSSProperties}
          >
            {visiblePages.map((page) => (
              <div
                key={page.id}
                className={cx(
                  'atlas-row',
                  'atlas-row--page',
                  selectedPageId === page.id && 'atlas-row--active',
                )}
                onClick={() => onSelectPage(session.id, page.id)}
                onKeyDown={(event) => event.key === 'Enter' && onSelectPage(session.id, page.id)}
                role="button"
                tabIndex={0}
                title={`${page.title} — ${page.domain}`}
              >
                <span className="atlas-row__dot" />
                <span className="atlas-row__label">
                  <Highlight text={page.title} query={query} />
                </span>
                {page.visits > 1 && (
                  <span className="atlas-row__meta atlas-row__meta--revisit">×{page.visits}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const assignFolder = assignTarget
    ? folders.find((folder) => folder.id === assignTarget)
    : undefined;

  return (
    <aside className="atlas-nav" style={{ width }}>
      <div className="atlas-nav__head">
        <button type="button" title="메인으로" aria-label="메인으로" onClick={() => navigate('#/')}>
          <i className="ph ph-house" />
        </button>
        <div className="atlas-nav__head-actions">
          <button
            type="button"
            title="새 폴더"
            aria-label="새 폴더"
            onClick={() => {
              setDraftName('');
              setCreating(true);
            }}
          >
            <i className="ph ph-folder-plus" />
          </button>
          <button
            type="button"
            title={`정렬: ${SORT_LABEL[sort]} (눌러서 ${SORT_LABEL[sort === 'recent' ? 'title' : 'recent']}으로)`}
            aria-label={`세션 정렬 ${SORT_LABEL[sort]}`}
            onClick={() => onSortChange(sort === 'recent' ? 'title' : 'recent')}
          >
            <i className={`ph ${SORT_ICON[sort]}`} />
          </button>
          <button type="button" title="모두 접기" aria-label="모두 접기" onClick={onCollapseAll}>
            <i className="ph ph-arrows-in-line-vertical" />
          </button>
        </div>
      </div>

      {folderError && (
        <div className="atlas-nav__error" role="alert">
          {folderError}
        </div>
      )}

      <div className="atlas-nav__tree">
        {searchResults !== null ? (
          <>
            {searchResults.length === 0 && (
              <div className="atlas-nav__empty">
                <i className="ph ph-magnifying-glass" />
                <span>“{query}” 와 일치하는 항목이 없습니다</span>
              </div>
            )}
            {searchResults.map(({ session, pageIds }) => (
              <div key={session.id}>
                {session.folderId && (
                  <div className="atlas-nav__crumb">
                    <i className="ph ph-folder-simple" />
                    {folderNameById.get(session.folderId) ?? '알 수 없는 폴더'}
                  </div>
                )}
                {renderSession(session, pageIds)}
              </div>
            ))}
          </>
        ) : (
          <>
            {creating && (
              <div className="atlas-row atlas-row--folder atlas-row--drafting">
                <i className="ph ph-folder-simple atlas-row__icon" />
                <input
                  autoFocus
                  className="atlas-row__input"
                  value={draftName}
                  placeholder="폴더 이름"
                  maxLength={60}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void submitNewFolder()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitNewFolder();
                    // 이름을 먼저 비워야 뒤따르는 blur 가 폴더를 만들지 않는다.
                    if (event.key === 'Escape') {
                      setDraftName('');
                      setCreating(false);
                    }
                  }}
                />
              </div>
            )}

            {folders.map((folder) => {
              const isOpen = expandedFolderIds.has(folder.id);
              return (
                <div className="atlas-folder" key={folder.id}>
                  <div
                    className={cx(
                      'atlas-row',
                      'atlas-row--folder',
                      focusedFolderId === folder.id && 'atlas-row--focused',
                      dropTarget === folder.id && 'atlas-row--drop',
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropTarget(folder.id);
                    }}
                    onDragLeave={() => setDropTarget((prev) => (prev === folder.id ? null : prev))}
                    onDrop={(event) => void handleDropOnFolder(folder.id, event)}
                    onClick={() => onSelectFolder(folder.id)}
                    onKeyDown={(event) => event.key === 'Enter' && onSelectFolder(folder.id)}
                    role="button"
                    tabIndex={0}
                    title={`${folder.name} — 세션 ${folder.sessions.length}개`}
                  >
                    <button
                      type="button"
                      className="atlas-row__caret"
                      aria-label={isOpen ? '접기' : '펼치기'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFolder(folder.id);
                      }}
                    >
                      <i className={isOpen ? 'ph ph-caret-down' : 'ph ph-caret-right'} />
                    </button>
                    {/* 폴더 색은 캔버스 궤도 색과 같다 — 아이콘으로 두 화면을 잇는다 */}
                    <i
                      className="ph ph-folder-simple atlas-row__icon"
                      style={{ color: folder.hue }}
                      aria-hidden
                    />

                    {renamingId === folder.id ? (
                      <input
                        autoFocus
                        className="atlas-row__input"
                        value={draftName}
                        maxLength={60}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={() => void submitRename(folder.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void submitRename(folder.id);
                          if (event.key === 'Escape') {
                            setDraftName('');
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="atlas-row__label">{folder.name}</span>
                    )}

                    <span className="atlas-row__trailing">
                      <span className="atlas-row__meta">{folder.sessions.length}</span>
                      <button
                        type="button"
                        className="atlas-row__action"
                        aria-label={`${folder.name}에 세션 추가`}
                        title="세션 추가"
                        onClick={(event) => {
                          event.stopPropagation();
                          setFolderError(null);
                          setAssignTarget(folder.id);
                        }}
                      >
                        <i className="ph ph-plus" />
                      </button>
                      <button
                        type="button"
                        className="atlas-row__action"
                        aria-label={`${folder.name} 이름 바꾸기`}
                        title="이름 바꾸기"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraftName(folder.name);
                          setRenamingId(folder.id);
                        }}
                      >
                        <i className="ph ph-pencil-simple" />
                      </button>
                      <button
                        type="button"
                        className="atlas-row__action"
                        aria-label={`${folder.name} 삭제`}
                        title="폴더 삭제"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteFolderWithConfirm(folder);
                        }}
                      >
                        <i className="ph ph-trash" />
                      </button>
                    </span>
                  </div>

                  {isOpen && (
                    <div className="atlas-folder__children">
                      {folder.sessions.length === 0 ? (
                        <div className="atlas-folder__empty">
                          세션을 여기로 끌어다 놓거나 + 로 추가하세요
                        </div>
                      ) : (
                        sortSessions(folder.sessions, sort).map((session) =>
                          renderSession(session, null),
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 비어 있으면 감춘다 — 0 만 적힌 줄은 아무것도 알려주지 않는다. */}
            {(unfiled.length > 0 || draggingSession) && (
              <div
                className={cx(
                  'atlas-nav__section',
                  dropTarget === 'unfiled' && 'atlas-nav__section--drop',
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget('unfiled');
                }}
                onDragLeave={() => setDropTarget((prev) => (prev === 'unfiled' ? null : prev))}
                onDrop={(event) => {
                  setDraggingSession(false);
                  void handleDropOnUnfiled(event);
                }}
              >
                정리 안 됨
                <span className="atlas-nav__section-count">{unfiled.length}</span>
              </div>
            )}

            {unfiled.length === 0 && folders.length === 0 && (
              <div className="atlas-nav__empty">
                <i className="ph ph-folder-simple-dashed" />
                <span>저장된 세션이 없습니다</span>
              </div>
            )}

            {sortSessions(unfiled, sort).map((session) => renderSession(session, null))}
          </>
        )}
      </div>

      <div className={cx('atlas-nav__search', searchOpen && 'atlas-nav__search--open')}>
        <button
          type="button"
          className="atlas-nav__search-btn"
          aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
          aria-expanded={searchOpen}
          onClick={() => onSearchOpenChange(!searchOpen || Boolean(query))}
        >
          <i className="ph ph-magnifying-glass" />
        </button>
        <input
          ref={searchInputRef}
          type="text"
          className="atlas-nav__search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="세션 · 페이지 검색"
          spellCheck={false}
          tabIndex={searchOpen ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onQueryChange('');
              onSearchOpenChange(false);
              event.currentTarget.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="atlas-nav__search-clear"
            aria-label="검색어 지우기"
            onClick={() => onQueryChange('')}
          >
            <i className="ph ph-x" />
          </button>
        )}
      </div>

      {resizable && (
        <div
          className="atlas-nav__resizer"
          onPointerDown={handleResizeStart}
          onDoubleClick={() => onWidthChange(272)}
          role="separator"
          aria-orientation="vertical"
          aria-label="네비게이터 너비 조절"
        />
      )}

      {assignFolder && (
        <FolderAssignDialog
          folder={assignFolder}
          sessions={sessions}
          folderNameById={folderNameById}
          pending={assign.isPending}
          error={folderError}
          onSubmit={(sessionIds) => {
            void runFolderAction(
              () => assign.mutateAsync({ folderId: assignFolder.id, sessionIds }),
              '세션을 추가하지 못했어요',
            ).then((ok) => {
              if (ok) setAssignTarget(null);
            });
          }}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </aside>
  );
}
