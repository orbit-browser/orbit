import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  getAskConversationSnapshot,
  useAskConversation,
} from '../../entrypoints/shared/hooks/useAskConversation';
import { streamAsk } from '../../lib/api';
import { parseSseBuffer, readSseStream } from '../../lib/sse';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ask AI request', () => {
  it('현재 질문만 전송하고 이전 질문·답변 필드를 만들지 않는다', async () => {
    let requestBody = '';
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }), { status: 200 });
    }));

    for await (const _event of streamAsk({ query: '현재 질문', rerank: false })) {
      // 빈 스트림이라 이벤트는 없다.
    }

    expect(JSON.parse(requestBody)).toEqual({
      query: '현재 질문',
      session_id: null,
      rerank: false,
    });
  });

  it('컴포넌트가 다시 마운트돼도 누적 답변을 유지하고 새 대화에서만 비운다', async () => {
    const body = new TextEncoder().encode([
      'event: sources\ndata: {"sessions":[]}\n\n',
      'event: delta\ndata: {"text":"독립 답변"}\n\n',
      'event: done\ndata: {"model":"test-model"}\n\n',
    ].join(''));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
      { status: 200 },
    )));

    let conversation: ReturnType<typeof useAskConversation> | undefined;
    function Probe() {
      conversation = useAskConversation();
      return null;
    }

    renderToString(createElement(Probe));
    conversation!.startNewConversation();
    await conversation!.ask('첫 질문');

    expect(getAskConversationSnapshot().turns).toHaveLength(1);
    expect(getAskConversationSnapshot().turns[0]).toMatchObject({
      query: '첫 질문',
      answer: '독립 답변',
      status: 'done',
    });

    conversation!.startNewConversation();
    expect(getAskConversationSnapshot().turns).toEqual([]);
  });
});

describe('Ask AI SSE parser', () => {
  it('완료된 프레임과 다음 청크의 나머지를 분리한다', () => {
    const parsed = parseSseBuffer(
      'event: sources\r\ndata: {"sessions":[]}\r\n\r\nevent: delta\ndata: {"text":"안',
    );

    expect(parsed.frames).toEqual([
      { event: 'sources', data: '{"sessions":[]}' },
    ]);
    expect(parsed.remainder).toBe('event: delta\ndata: {"text":"안');
  });

  it('UTF-8 문자가 청크 사이에서 나뉘어도 이벤트를 복원한다', async () => {
    const encoded = new TextEncoder().encode(
      'event: delta\ndata: {"text":"안녕하세요"}\n\nevent: done\ndata: {"model":"ax"}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 31));
        controller.enqueue(encoded.slice(31, 37));
        controller.enqueue(encoded.slice(37));
        controller.close();
      },
    });

    const frames = [];
    for await (const frame of readSseStream(stream)) frames.push(frame);

    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"안녕하세요"}' },
      { event: 'done', data: '{"model":"ax"}' },
    ]);
  });
});
