import { RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import type { AskTurn } from '../../../shared/hooks/useAskConversation';
import type { Session } from '../../../../lib/types';

interface AskConversationPanelProps {
  turns: AskTurn[];
  isStreaming: boolean;
  onCancel: () => void;
  onStartNewConversation: () => void;
  onRetry: (query: string) => void;
  onOpenSource: (session: Session) => void;
}

export function AskConversationPanel({
  turns,
  isStreaming,
  onCancel,
  onStartNewConversation,
  onRetry,
  onOpenSource,
}: AskConversationPanelProps) {
  return (
    <main className="ask-conversation" aria-live="polite">
      <div className="ask-conversation__toolbar">
        <span>질문과 답변은 누적 표시되지만, 각 질문은 독립적으로 처리돼요</span>
        <div>
          {isStreaming && (
            <button type="button" onClick={onCancel}>
              <Square size={11} fill="currentColor" /> 중단
            </button>
          )}
          <button type="button" onClick={onStartNewConversation}>
            <Trash2 size={12} /> 새 대화 시작하기
          </button>
        </div>
      </div>

      <div className="ask-conversation__turns">
        {turns.map((turn) => (
          <article key={turn.id} className="ask-turn">
            <p className="ask-turn__question">{turn.query}</p>
            <div className="ask-turn__answer">
              <div className="ask-turn__identity">
                <Sparkles size={14} /> Orbit AI
              </div>
              <p>
                {turn.answer}
                {turn.status === 'streaming' && <span className="ask-turn__cursor" />}
              </p>
              {turn.error && (
                <div className="ask-turn__error" role="alert">
                  <span>{turn.error}</span>
                  {turn.status !== 'streaming' && (
                    <button type="button" onClick={() => onRetry(turn.query)}>
                      <RotateCcw size={12} /> 다시 시도
                    </button>
                  )}
                </div>
              )}
            </div>

            {turn.sources.length > 0 && (
              <div className="ask-sources">
                <h3>관련 세션</h3>
                <div className="ask-sources__grid">
                  {turn.sources.map((session, index) => (
                    <button
                      key={session.id}
                      type="button"
                      className="ask-source"
                      onClick={() => onOpenSource(session)}
                    >
                      <span className="ask-source__number">{index + 1}</span>
                      <span className="ask-source__content">
                        <strong>{session.title}</strong>
                        <small>
                          {session.tabs.length}개 페이지 · {session.timeLabel}
                        </small>
                      </span>
                      <span className="ask-source__domains">
                        {session.tabs.slice(0, 3).map((tab) => tab.title).filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
