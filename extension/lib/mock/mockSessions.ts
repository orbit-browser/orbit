import type { Session } from '../types';

// 디자인 목업의 화면 데이터를 그대로 옮긴 mock 입니다.
// 후속 단계에서 백엔드(/sessions, /search) 응답으로 교체됩니다.

export const mockSessions: Session[] = [
  {
    id: 'ai-agent-research',
    title: 'AI 에이전트 서비스 조사',
    createdAt: '2025-05-22T14:30:00+09:00',
    updatedAt: '2025-05-22T14:30:00+09:00',
    timeLabel: '방금',
    summaryStatus: 'done',
    tabs: [
      {
        id: 't1',
        title: 'ChatGPT – OpenAI',
        url: 'https://chat.openai.com',
        favIconUrl: 'https://chat.openai.com/favicon.ico',
      },
      {
        id: 't2',
        title: 'LangChain – Build context-aware agents',
        url: 'https://www.langchain.com',
        favIconUrl: 'https://www.langchain.com/favicon.ico',
      },
      {
        id: 't3',
        title: 'AutoGPT',
        url: 'https://github.com/Significant-Gravitas/AutoGPT',
        favIconUrl: 'https://github.com/favicon.ico',
      },
      {
        id: 't4',
        title: 'Pinecone – Vector Database',
        url: 'https://www.pinecone.io',
        favIconUrl: 'https://www.pinecone.io/favicon.ico',
      },
      {
        id: 't5',
        title: 'Notion – 프로젝트 기획',
        url: 'https://www.notion.so',
        favIconUrl: 'https://www.notion.so/favicon.ico',
      },
      {
        id: 't6',
        title: 'Claude – Anthropic',
        url: 'https://claude.ai',
        favIconUrl: 'https://claude.ai/favicon.ico',
      },
      {
        id: 't7',
        title: 'RAG 논문 정리 – arXiv',
        url: 'https://arxiv.org/abs/2005.11401',
        favIconUrl: 'https://arxiv.org/favicon.ico',
      },
      {
        id: 't8',
        title: 'Vector DB 비교 – 기술 블로그',
        url: 'https://example.com/vector-db-comparison',
      },
    ],
    summary: {
      overview: '이 세션은 AI 에이전트 서비스와 관련된 다양한 정보를 탐색한 기록입니다.',
      purpose: 'AI 에이전트 서비스 설계를 위한 사전 기술 조사',
      highlights: [
        'AI 에이전트의 개념과 동향 파악',
        'LangChain, AutoGPT 등 주요 오픈소스 조사',
        '벡터 DB(Pinecone) 및 RAG 관련 기술 확인',
        'Notion을 활용한 프롬프트 기획 내용 포함',
      ],
      todos: ['LangChain vs AutoGPT 기능 비교표 작성', 'RAG 파이프라인 설계 초안'],
      nextActions: ['Pinecone 무료 티어로 임베딩 검색 PoC 진행'],
    },
  },
  {
    id: 'travel-japan-tokyo',
    title: '여행 계획 – 일본 도쿄',
    createdAt: '2025-05-22T13:10:00+09:00',
    updatedAt: '2025-05-22T13:10:00+09:00',
    timeLabel: '1시간 전',
    summaryStatus: 'done',
    tabs: [
      { id: 'j1', title: '도쿄 항공권 비교 – 스카이스캐너', url: 'https://www.skyscanner.co.kr' },
      { id: 'j2', title: '신주쿠 호텔 추천', url: 'https://www.booking.com' },
      { id: 'j3', title: '도쿄 3박 4일 코스', url: 'https://example.com/tokyo-course' },
    ],
    summary: {
      overview: '일본 도쿄 3박 4일 여행을 위한 항공권·숙소·일정 자료입니다.',
      highlights: ['항공권 가격 비교', '신주쿠 인근 숙소 후보', '주요 관광 코스 정리'],
      todos: ['항공권 최종 예약', '숙소 1곳 확정'],
    },
  },
  {
    id: 'productivity-tools',
    title: '리서치 – 생산성 도구 비교',
    createdAt: '2025-05-21T10:00:00+09:00',
    updatedAt: '2025-05-21T10:00:00+09:00',
    timeLabel: '어제',
    summaryStatus: 'done',
    tabs: [
      { id: 'p1', title: 'Notion', url: 'https://www.notion.so' },
      { id: 'p2', title: 'Obsidian', url: 'https://obsidian.md' },
      { id: 'p3', title: 'Linear', url: 'https://linear.app' },
    ],
    summary: {
      overview: '팀 생산성 도구 도입을 위한 후보 비교 자료입니다.',
      highlights: ['문서 도구 비교(Notion/Obsidian)', '이슈 트래킹(Linear)'],
    },
  },
  {
    id: 'design-reference',
    title: '디자인 레퍼런스',
    createdAt: '2025-05-20T09:00:00+09:00',
    updatedAt: '2025-05-20T09:00:00+09:00',
    timeLabel: '2일 전',
    summaryStatus: 'done',
    tabs: [
      { id: 'd1', title: 'Dribbble', url: 'https://dribbble.com' },
      { id: 'd2', title: 'Mobbin', url: 'https://mobbin.com' },
    ],
    summary: {
      overview: '사이드패널 UI 디자인을 위한 레퍼런스 모음입니다.',
      highlights: ['카드형 레이아웃 사례', '오렌지 액센트 컬러 시스템'],
    },
  },
];
