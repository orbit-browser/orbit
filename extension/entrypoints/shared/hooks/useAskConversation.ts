import { useCallback } from 'react';
import { create } from 'zustand';
import { streamAsk } from '../../../lib/api';
import type { Session } from '../../../lib/types';

export type AskTurnStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface AskTurn {
  id: string;
  query: string;
  answer: string;
  sources: Session[];
  status: AskTurnStatus;
  model: string | null;
  error: string | null;
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

export function useAskConversation({ rerank = true }: { rerank?: boolean } = {}) {
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
        },
      ],
      isStreaming: true,
    }));

    let terminalEvent = false;
    try {
      // 이전 질문·답변을 보내지 않는다. 화면의 누적 목록은 표시용일 뿐 각 요청은 독립 단일턴이다.
      for await (const event of streamAsk({ query, rerank }, controller.signal)) {
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
          error: error instanceof SyntaxError
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
  }, [rerank]);

  return {
    turns,
    ask,
    cancel,
    startNewConversation,
    isStreaming,
  };
}
