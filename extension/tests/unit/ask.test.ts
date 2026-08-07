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
      intent: 'search_memory',
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

  it('열린 탭 이동 명령은 백엔드 대신 Chrome 로컬 API로 실행한다', async () => {
    const fetch = vi.fn();
    const focusWindow = vi.fn(async () => undefined);
    const activateTab = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})) } },
      windows: { update: focusWindow },
      tabs: {
        query: vi.fn(async () => [
          {
            id: 42,
            windowId: 7,
            index: 0,
            active: false,
            title: 'YouTube',
            url: 'https://www.youtube.com/',
          },
        ]),
        update: activateTab,
      },
    });

    let conversation: ReturnType<typeof useAskConversation> | undefined;
    function Probe() {
      conversation = useAskConversation();
      return null;
    }

    renderToString(createElement(Probe));
    conversation!.startNewConversation();
    await conversation!.ask('지금 열려있는 유튜브 탭으로 이동해줘');

    expect(fetch).not.toHaveBeenCalled();
    expect(focusWindow).toHaveBeenCalledWith(7, { focused: true });
    expect(activateTab).toHaveBeenCalledWith(42, { active: true });
    expect(getAskConversationSnapshot().turns[0]).toMatchObject({
      answer: '“YouTube” 탭으로 이동했어요.',
      status: 'done',
      model: 'local-tab-action',
    });

    conversation!.startNewConversation();
  });

  it('로컬에서 같은 사이트 탭이 여러 개면 후보를 표시하고 선택한 탭으로 이동한다', async () => {
    const focusWindow = vi.fn(async () => undefined);
    const activateTab = vi.fn(async () => undefined);
    const openTabs = [
      {
        id: 42,
        windowId: 7,
        index: 0,
        active: false,
        title: 'YouTube - React 강의',
        url: 'https://www.youtube.com/watch?v=react',
      },
      {
        id: 43,
        windowId: 7,
        index: 1,
        active: false,
        title: 'YouTube - 음악',
        url: 'https://www.youtube.com/watch?v=music',
      },
    ];
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      windows: { update: focusWindow },
      tabs: {
        query: vi.fn(async () => openTabs),
        update: activateTab,
      },
    });

    let conversation: ReturnType<typeof useAskConversation> | undefined;
    function Probe() {
      conversation = useAskConversation();
      return null;
    }

    renderToString(createElement(Probe));
    conversation!.startNewConversation();
    await conversation!.ask('유튜브 탭으로 이동해줘');

    const turn = getAskConversationSnapshot().turns[0];
    expect(turn.answer).toContain('탭이 여러 개');
    expect(turn.tabCandidates.map((tab) => tab.id)).toEqual(['42', '43']);
    expect(activateTab).not.toHaveBeenCalled();

    await conversation!.selectTabCandidate(turn.id, '43');

    expect(focusWindow).toHaveBeenCalledWith(7, { focused: true });
    expect(activateTab).toHaveBeenCalledWith(43, { active: true });
    expect(getAskConversationSnapshot().turns[0]).toMatchObject({
      answer: '“YouTube - 음악” 탭으로 이동했어요.',
      tabCandidates: [],
      tabCandidateError: null,
    });
    conversation!.startNewConversation();
  });

  it('간접 이동 표현은 의미 resolver 결과의 현재 탭 ID를 검증해 실행한다', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/assistant/route')) {
        return new Response(JSON.stringify({
          intent: 'navigate_tab',
          confidence: 0.4,
          margin: 0.1,
          reason: 'semantic',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(String(input)).toContain('/tab-actions/resolve');
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe('아까 보던 영상으로 돌아가자');
      expect(body.candidates.map((tab: { id: string }) => tab.id)).toEqual(['42', '43']);
      return new Response(JSON.stringify({
        action: 'navigate_tab',
        reason: 'matched',
        tab_id: '42',
        score: 0.31,
        margin: 0.1,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const focusWindow = vi.fn(async () => undefined);
    const activateTab = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})) } },
      windows: { update: focusWindow },
      tabs: {
        query: vi.fn(async () => [
          {
            id: 42,
            windowId: 7,
            index: 0,
            active: false,
            title: 'YouTube',
            url: 'https://www.youtube.com/',
          },
          {
            id: 43,
            windowId: 7,
            index: 1,
            active: false,
            title: '오늘의 뉴스',
            url: 'https://news.naver.com/',
          },
          {
            id: 44,
            windowId: 7,
            index: 2,
            active: false,
            title: 'PayPal 로그인',
            url: 'https://www.paypal.com/login',
          },
        ]),
        update: activateTab,
      },
    });

    let conversation: ReturnType<typeof useAskConversation> | undefined;
    function Probe() {
      conversation = useAskConversation();
      return null;
    }

    renderToString(createElement(Probe));
    conversation!.startNewConversation();
    await conversation!.ask('아까 보던 영상으로 돌아가자');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(focusWindow).toHaveBeenCalledWith(7, { focused: true });
    expect(activateTab).toHaveBeenCalledWith(42, { active: true });
    expect(getAskConversationSnapshot().turns[0]).toMatchObject({
      answer: '“YouTube” 탭으로 이동했어요.',
      status: 'done',
      model: 'semantic-tab-action',
    });
    conversation!.startNewConversation();
  });

  it('세션 찾기 의도는 Ask stream에 분리된 intent로 전달한다', async () => {
    let askBody: Record<string, unknown> | null = null;
    const streamBody = new TextEncoder().encode([
      'event: sources\ndata: {"sessions":[]}\n\n',
      'event: delta\ndata: {"text":"관련 세션을 찾았어요."}\n\n',
      'event: done\ndata: {"model":null}\n\n',
    ].join(''));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/assistant/route')) {
        return new Response(JSON.stringify({
          intent: 'find_sessions',
          confidence: 0.5,
          margin: 0.2,
          reason: 'semantic',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(String(input)).toContain('/ask/stream');
      askBody = JSON.parse(String(init?.body));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(streamBody);
          controller.close();
        },
      }), { status: 200 });
    }));

    let conversation: ReturnType<typeof useAskConversation> | undefined;
    function Probe() {
      conversation = useAskConversation();
      return null;
    }

    renderToString(createElement(Probe));
    conversation!.startNewConversation();
    await conversation!.ask('리액트 공부했던 세션 찾아줘');

    expect(askBody).toMatchObject({
      query: '리액트 공부했던 세션 찾아줘',
      intent: 'find_sessions',
    });
    expect(getAskConversationSnapshot().turns[0]).toMatchObject({
      answer: '관련 세션을 찾았어요.',
      status: 'done',
    });
    conversation!.startNewConversation();
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
