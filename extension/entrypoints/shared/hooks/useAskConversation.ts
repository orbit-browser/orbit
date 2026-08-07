import { useCallback } from 'react';
import { create } from 'zustand';
import { resolveAssistantRoute, resolveOpenTabAction, streamAsk } from '../../../lib/api';
import { activateOpenTab, getAllOpenTabs } from '../../../lib/chrome-bridge';
import { isSensitiveUrl } from '../../../lib/sensitive-domains';
import { getSettings } from '../../../lib/settings';
import {
  findBestOpenTab,
  parseOpenTabNavigationIntent,
} from '../../../lib/tab-actions';
import type { AssistantRetrievalIntent, OpenTabItem, Session } from '../../../lib/types';

export type AskTurnStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface AskTurn {
  id: string;
  query: string;
  answer: string;
  sources: Session[];
  status: AskTurnStatus;
  model: string | null;
  error: string | null;
  tabCandidates: OpenTabItem[];
  tabCandidateError: string | null;
}

interface AskConversationState {
  turns: AskTurn[];
  isStreaming: boolean;
}

let turnSequence = 0;
let activeController: AbortController | null = null;
let activeTurnId: string | null = null;

const nextTurnId = () => `ask-${Date.now()}-${turnSequence++}`;

const useAskConversationStore = create<AskConversationState>(() => ({
  turns: [],
  isStreaming: false,
}));

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
    updateTurn(turnId, (turn) => ({
      ...turn,
      status: 'cancelled',
      error: '답변 생성을 중단했어요.',
    }));
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
  const semanticCandidates = excludeSensitive
    ? tabs.filter((tab) => !isSensitiveUrl(tab.url))
    : tabs;
  if (semanticCandidates.length === 0) {
    return {
      model: 'semantic-tab-action',
      answer: '민감 페이지 제외 설정 때문에 의미 검색에 사용할 수 있는 탭이 없어요. 탭 이름을 정확히 말하면 로컬에서 이동할 수 있어요.',
    };
  }

  let resolved;
  try {
    resolved = await resolveOpenTabAction(query, semanticCandidates, signal);
  } catch {
    return null;
  }
  if (resolved.reason === 'non_navigation') return null;
  if (resolved.action !== 'navigate_tab' || !resolved.tabId) {
    const candidateTabs = resolved.candidates
      .map((candidate) => semanticCandidates.find((tab) => tab.id === candidate.tabId))
      .filter((tab): tab is OpenTabItem => tab !== undefined);
    return {
      model: 'semantic-tab-action',
      answer: candidateTabs.length >= 2
        ? '비슷한 열린 탭이 여러 개 있어요. 이동할 탭을 선택해 주세요.'
        : '열린 탭에서 확실하게 일치하는 페이지를 찾지 못했어요. 탭 이름이나 사이트를 조금 더 구체적으로 말해 주세요.',
      tabCandidates: candidateTabs.length >= 2 ? candidateTabs : undefined,
    };
  }

  const matchedTab = semanticCandidates.find((tab) => tab.id === resolved.tabId);
  if (!matchedTab) {
    return {
      model: 'semantic-tab-action',
      answer: '찾은 탭이 방금 닫혔어요. 다시 시도해 주세요.',
    };
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
    if (tabs.length === 0) {
      return {
        intent: 'search_memory',
        command: { model: 'local-tab-action', answer: '현재 찾을 수 있는 열린 탭이 없어요.' },
      };
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
    return { command: null, intent: sessionId ? 'search_session' : 'search_memory' };
  }
  if (route.intent !== 'navigate_tab') {
    return { command: null, intent: route.intent };
  }

  tabs = await getAllOpenTabs();
  if (tabs.length === 0) {
    return {
      intent: 'search_memory',
      command: { model: 'local-tab-action', answer: '현재 찾을 수 있는 열린 탭이 없어요.' },
    };
  }
  return {
    intent: 'search_memory',
    command: await runSemanticOpenTabCommand(query, tabs, signal),
  };
}

export function useAskConversation({
  rerank = true,
  sessionId,
}: { rerank?: boolean; sessionId?: string } = {}) {
  const turns = useAskConversationStore((state) => state.turns);
  const isStreaming = useAskConversationStore((state) => state.isStreaming);

  const cancel = useCallback(() => {
    cancelActiveTurn();
  }, []);

  const startNewConversation = useCallback(() => {
    activeController?.abort();
    activeController = null;
    activeTurnId = null;
    useAskConversationStore.setState({ turns: [], isStreaming: false });
  }, []);

  const ask = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    if (activeController) cancelActiveTurn();
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
          tabCandidates: [],
          tabCandidateError: null,
        },
      ],
      isStreaming: true,
    }));

    let terminalEvent = false;
    try {
      const routed = await routeAskRequest(query, sessionId, controller.signal);
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

      // 이전 질문·답변을 보내지 않는다. 화면의 누적 목록은 표시용일 뿐 각 요청은 독립 단일턴이다.
      for await (const event of streamAsk({
        query,
        rerank,
        sessionId,
        intent: routed.intent,
      }, controller.signal)) {
        if (event.type === 'sources') {
          updateTurn(id, (turn) => ({ ...turn, sources: event.sessions }));
        } else if (event.type === 'delta' && event.text) {
          updateTurn(id, (turn) => ({ ...turn, answer: turn.answer + event.text }));
        } else if (event.type === 'done') {
          terminalEvent = true;
          updateTurn(id, (turn) => ({ ...turn, status: 'done', model: event.model }));
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
      if (!controller.signal.aborted) {
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
  }, [rerank, sessionId]);

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
