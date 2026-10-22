import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { resolveAssistantRoute, resolveOpenTabAction, streamAsk } from '../../../lib/api';
import { onSessionChange } from '../../../lib/auth';
import { activateOpenTab, getAllOpenTabs } from '../../../lib/chrome-bridge';
import { isSensitiveUrl } from '../../../lib/sensitive-domains';
import { getSettings, subscribeSettings } from '../../../lib/settings';
import {
  findBestOpenTab,
  parseOpenTabNavigationIntent,
} from '../../../lib/tab-actions';
import type {
  AskHistoryTurn,
  AskVerificationIssue,
  AssistantRetrievalIntent,
  OpenTabItem,
  Session,
} from '../../../lib/types';

export type AskTurnStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface AskTurn {
  id: string;
  query: string;
  answer: string;
  sources: Session[];
  status: AskTurnStatus;
  model: string | null;
  error: string | null;
  /** 서버 검증이 기록에서는 비슷한 다른 대상의 값으로 본 답변 속 값들. 답변은 그대로 두고 경고로만 보여 준다. */
  verificationIssues: AskVerificationIssue[];
  tabCandidates: OpenTabItem[];
  tabCandidateError: string | null;
}

interface AskConversationState {
  turns: AskTurn[];
  isStreaming: boolean;
  workspaceId: string | null;
}

const EMPTY_TURNS: AskTurn[] = [];
const MAX_HISTORY_TURNS = 3;
const TAB_ACTION_MODELS = new Set(['local-tab-action', 'semantic-tab-action']);

/** 후속 질문용 최근 대화 — 답변이 끝난 Ask 턴만 보낸다. 탭 이동 결과는 대화 맥락이 아니다. */
export function buildAskHistory(turns: AskTurn[]): AskHistoryTurn[] {
  return turns
    .filter((turn) =>
      turn.status === 'done' && turn.answer.trim() !== '' && !TAB_ACTION_MODELS.has(turn.model ?? ''),
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      query: turn.query,
      answer: turn.answer,
      sourceSessionIds: turn.sources.map((session) => session.id),
    }));
}

let turnSequence = 0;
let activeController: AbortController | null = null;
let activeTurnId: string | null = null;

const nextTurnId = () => `ask-${Date.now()}-${turnSequence++}`;

const useAskConversationStore = create<AskConversationState>(() => ({
  turns: [],
  isStreaming: false,
  workspaceId: null,
}));

function resetConversation(workspaceId = useAskConversationStore.getState().workspaceId) {
  activeController?.abort();
  activeController = null;
  activeTurnId = null;
  useAskConversationStore.setState({ turns: [], isStreaming: false, workspaceId });
}

// 마운트 여부와 무관하게 다른 화면에서 바꾼 계정·범위도 즉시 반영한다.
// 저장소 이벤트의 이전 값을 비교하므로 초기 조회와 변경 알림 사이의 경합이 없다.
onSessionChange((session, previous) => {
  if (session?.user.id !== previous?.user.id) resetConversation();
});
subscribeSettings((settings, previous) => {
  if (settings.activeWorkspaceId !== previous.activeWorkspaceId) resetConversation();
});

export function getAskConversationSnapshot(): AskConversationState {
  return useAskConversationStore.getState();
}

function updateTurn(id: string, update: (turn: AskTurn) => AskTurn) {
  useAskConversationStore.setState((state) => ({
    turns: state.turns.map((turn) => (turn.id === id ? update(turn) : turn)),
  }));
}

function errorMessage(code: string, partial: boolean): string {
  if (code === 'stream_interrupted' || partial) {
    return '답변 연결이 중간에 끊겼어요. 일부 답변만 표시됐습니다.';
  }
  return '답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function cancelActiveTurn() {
  const turnId = activeTurnId;
  activeController?.abort();
  activeController = null;
  activeTurnId = null;
  if (turnId) {
    // 답변이 끝난 뒤 검증 경고를 기다리던 턴은 답변 그대로 둔다(경고만 받지 못한다).
    updateTurn(turnId, (turn) => (turn.status === 'streaming'
      ? { ...turn, status: 'cancelled', error: '답변 생성을 중단했어요.' }
      : turn));
  }
  useAskConversationStore.setState({ isStreaming: false });
}

interface LocalTabCommandResult {
  answer: string;
  model: 'local-tab-action' | 'semantic-tab-action';
  tabCandidates?: OpenTabItem[];
}

interface RoutedAskRequest {
  command: LocalTabCommandResult | null;
  intent: AssistantRetrievalIntent;
}

async function runSemanticOpenTabCommand(
  query: string,
  tabs: OpenTabItem[],
  signal: AbortSignal,
): Promise<LocalTabCommandResult | null> {
  const excludeSensitive = await getSettings()
    .then((settings) => settings.excludeSensitive)
    .catch(() => true);
  signal.throwIfAborted();
  const semanticCandidates = excludeSensitive
    ? tabs.filter((tab) => !isSensitiveUrl(tab.url))
    : tabs;
  if (semanticCandidates.length === 0) {
    return null;
  }

  let resolved;
  try {
    resolved = await resolveOpenTabAction(query, semanticCandidates, signal);
  } catch {
    signal.throwIfAborted();
    return null;
  }
  signal.throwIfAborted();
  if (resolved.reason === 'non_navigation') return null;
  if (resolved.action !== 'navigate_tab' || !resolved.tabId) {
    const candidateTabs = resolved.candidates
      .map((candidate) => semanticCandidates.find((tab) => tab.id === candidate.tabId))
      .filter((tab): tab is OpenTabItem => tab !== undefined);
    if (candidateTabs.length < 2) return null;
    return {
      model: 'semantic-tab-action',
      answer: '비슷한 열린 탭이 여러 개 있어요. 이동할 탭을 선택해 주세요.',
      tabCandidates: candidateTabs,
    };
  }

  const matchedTab = semanticCandidates.find((tab) => tab.id === resolved.tabId);
  if (!matchedTab) {
    return null;
  }

  await activateOpenTab(matchedTab);
  return {
    model: 'semantic-tab-action',
    answer: `“${matchedTab.title}” 탭으로 이동했어요.`,
  };
}

async function routeAskRequest(
  query: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<RoutedAskRequest> {
  const localIntent = parseOpenTabNavigationIntent(query);
  if (localIntent && !localIntent.target) {
    return {
      intent: 'search_memory',
      command: {
        model: 'local-tab-action',
        answer: '이동할 탭의 제목이나 주소를 함께 말해 주세요. 예: “유튜브 탭으로 이동해줘”',
      },
    };
  }

  let tabs: OpenTabItem[] | null = null;
  if (localIntent) {
    tabs = await getAllOpenTabs();
    signal.throwIfAborted();
    if (tabs.length === 0) {
      return { intent: 'search_memory', command: null };
    }
    const localMatch = findBestOpenTab(tabs, localIntent.target);
    if (localMatch) {
      if (localMatch.matchCount > 1) {
        return {
          intent: 'search_memory',
          command: {
            model: 'local-tab-action',
            answer: '일치하는 열린 탭이 여러 개 있어요. 이동할 탭을 선택해 주세요.',
            tabCandidates: localMatch.candidates.slice(0, 3),
          },
        };
      }
      await activateOpenTab(localMatch.tab);
      return {
        intent: 'search_memory',
        command: {
          model: 'local-tab-action',
          answer: localMatch.matchCount > 1
            ? `“${localMatch.tab.title}” 탭으로 이동했어요. 일치하는 탭 ${localMatch.matchCount}개 중 가장 가까운 결과를 선택했어요.`
            : `“${localMatch.tab.title}” 탭으로 이동했어요.`,
        },
      };
    }
  }

  if (localIntent) {
    return {
      intent: 'search_memory',
      command: await runSemanticOpenTabCommand(query, tabs ?? [], signal),
    };
  }

  let route;
  try {
    route = await resolveAssistantRoute(query, sessionId, signal);
  } catch {
    signal.throwIfAborted();
    return { command: null, intent: sessionId ? 'search_session' : 'search_memory' };
  }
  signal.throwIfAborted();
  if (route.intent !== 'navigate_tab') {
    return { command: null, intent: route.intent };
  }

  tabs = await getAllOpenTabs();
  signal.throwIfAborted();
  if (tabs.length === 0) {
    return { intent: 'search_memory', command: null };
  }
  return {
    intent: 'search_memory',
    command: await runSemanticOpenTabCommand(query, tabs, signal),
  };
}

export function useAskConversation({
  rerank = true,
  sessionId,
  workspaceId,
}: {
  rerank?: boolean;
  sessionId?: string;
  /** 주면 그 팀에 공유된 세션만 근거로 답한다. 열린 탭 이동은 범위와 무관하게 내 브라우저에서 한다. */
  workspaceId?: string;
} = {}) {
  const scopeId = workspaceId ?? null;
  const previousScopeId = useRef(scopeId);
  // 범위 prop이 바뀐 첫 렌더에서도 이전 범위의 답변을 내보내지 않는다.
  const turns = useAskConversationStore((state) => state.workspaceId === scopeId ? state.turns : EMPTY_TURNS);
  const isStreaming = useAskConversationStore((state) => state.workspaceId === scopeId && state.isStreaming);

  useEffect(() => {
    // 재마운트 직후에는 팀 설정을 읽기 전이라 임시로 개인 범위일 수 있다.
    if (previousScopeId.current !== scopeId && useAskConversationStore.getState().workspaceId !== scopeId) {
      resetConversation(scopeId);
    }
    previousScopeId.current = scopeId;
  }, [scopeId]);

  const cancel = useCallback(() => {
    cancelActiveTurn();
  }, []);

  const startNewConversation = useCallback(() => {
    resetConversation(scopeId);
  }, [scopeId]);

  const ask = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    if (useAskConversationStore.getState().workspaceId !== scopeId) resetConversation(scopeId);
    if (activeController) cancelActiveTurn();
    const history = buildAskHistory(useAskConversationStore.getState().turns);
    const id = nextTurnId();
    const controller = new AbortController();
    activeController = controller;
    activeTurnId = id;
    useAskConversationStore.setState((state) => ({
      turns: [
        ...state.turns,
        {
          id,
          query,
          answer: '',
          sources: [],
          status: 'streaming',
          model: null,
          error: null,
          verificationIssues: [],
          tabCandidates: [],
          tabCandidateError: null,
        },
      ],
      isStreaming: true,
    }));

    let terminalEvent = false;
    try {
      const routed = await routeAskRequest(query, sessionId, controller.signal);
      if (controller.signal.aborted) return;
      const command = routed.command;
      if (command !== null) {
        terminalEvent = true;
        updateTurn(id, (turn) => ({
          ...turn,
          answer: command.answer,
          status: 'done',
          model: command.model,
          tabCandidates: command.tabCandidates ?? [],
          tabCandidateError: null,
        }));
        return;
      }

      // 최근 대화를 함께 보내 "그중", "그럼 9070은?" 같은 후속 질문을 해석하게 한다.
      for await (const event of streamAsk({
        query,
        rerank,
        sessionId,
        intent: routed.intent,
        workspaceId,
        history,
      }, controller.signal)) {
        if (controller.signal.aborted) return;
        if (event.type === 'sources') {
          updateTurn(id, (turn) => ({ ...turn, sources: event.sessions }));
        } else if (event.type === 'delta' && event.text) {
          updateTurn(id, (turn) => ({ ...turn, answer: turn.answer + event.text }));
        } else if (event.type === 'replace' && event.text) {
          updateTurn(id, (turn) => ({ ...turn, answer: event.text }));
        } else if (event.type === 'verification') {
          updateTurn(id, (turn) => ({ ...turn, verificationIssues: event.issues }));
        } else if (event.type === 'done') {
          terminalEvent = true;
          updateTurn(id, (turn) => ({ ...turn, status: 'done', model: event.model }));
          // 서버는 done 뒤에 검증 경고(verification)를 보낼 수 있다. 스트림은 계속 읽되 다음 질문은 받는다.
          if (activeTurnId === id) useAskConversationStore.setState({ isStreaming: false });
        } else if (event.type === 'error') {
          terminalEvent = true;
          updateTurn(id, (turn) => ({
            ...turn,
            status: 'error',
            error: errorMessage(event.code, event.partial),
          }));
        }
      }
      if (!terminalEvent && !controller.signal.aborted) {
        updateTurn(id, (turn) => ({
          ...turn,
          status: 'error',
          error: '답변 스트림이 예기치 않게 종료됐어요.',
        }));
      }
    } catch (error) {
      // done 뒤(검증 경고 대기 중)에 연결이 끊기면 경고만 잃는다. 끝난 답변을 오류로 바꾸지 않는다.
      if (!controller.signal.aborted && !terminalEvent) {
        updateTurn(id, (turn) => ({
          ...turn,
          status: 'error',
          error: parseOpenTabNavigationIntent(query)
            ? '탭으로 이동하지 못했어요. 탭이 닫혔는지 확인하고 다시 시도해 주세요.'
            : error instanceof SyntaxError
              ? '서버 답변 형식을 읽지 못했어요.'
              : '백엔드에 연결하지 못했어요.',
        }));
      }
    } finally {
      if (activeTurnId === id) {
        activeTurnId = null;
        activeController = null;
        useAskConversationStore.setState({ isStreaming: false });
      }
    }
  }, [rerank, sessionId, workspaceId, scopeId]);

  const selectTabCandidate = useCallback(async (turnId: string, tabId: string) => {
    updateTurn(turnId, (turn) => ({ ...turn, tabCandidateError: null }));
    try {
      const tabs = await getAllOpenTabs();
      const selected = tabs.find((tab) => tab.id === tabId);
      if (!selected) {
        updateTurn(turnId, (turn) => ({
          ...turn,
          tabCandidates: turn.tabCandidates.filter((tab) => tab.id !== tabId),
          tabCandidateError: '선택한 탭이 방금 닫혔어요. 다른 후보를 선택해 주세요.',
        }));
        return;
      }
      await activateOpenTab(selected);
      updateTurn(turnId, (turn) => ({
        ...turn,
        answer: `“${selected.title}” 탭으로 이동했어요.`,
        tabCandidates: [],
        tabCandidateError: null,
      }));
    } catch {
      updateTurn(turnId, (turn) => ({
        ...turn,
        tabCandidateError: '탭으로 이동하지 못했어요. 다시 선택해 주세요.',
      }));
    }
  }, []);

  return {
    turns,
    ask,
    cancel,
    startNewConversation,
    isStreaming,
    selectTabCandidate,
  };
}
