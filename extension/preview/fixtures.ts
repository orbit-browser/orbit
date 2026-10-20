/**
 * 미리보기용 합성 데이터. 실제 사용자의 방문 기록은 쓰지 않는다.
 *
 * 시각은 시드하는 순간을 기준으로 거꾸로 잡아, 언제 열어도 "오늘·어제·이번 주"가 채워진다.
 * 모양은 백엔드 응답(snake_case)과 같다 — lib/api.ts 의 매핑을 그대로 거친다.
 */

export interface PreviewUser {
  user_id: string;
  name: string;
  email: string;
  picture: string | null;
}

export interface PreviewEvent {
  event_id: string;
  url: string;
  title: string;
  domain: string;
  visited_at: string;
  active_duration_ms: number;
}

export interface PreviewSession {
  session_id: string;
  owner: string;
  title: string;
  alias: string | null;
  summary: { overview: string; purpose: string; highlights: string[]; todos: string[]; next_actions: string[] };
  summary_status: 'pending' | 'done' | 'failed';
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  folder_id: string | null;
  events: PreviewEvent[];
}

export interface PreviewFolder {
  folder_id: string;
  name: string;
  hue: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PreviewWorkspace {
  workspace_id: string;
  name: string;
  hue: string;
  created_at: string;
  members: { user_id: string; role: 'owner' | 'member'; joined_at: string }[];
  shares: { session_id: string; shared_by: string; shared_at: string }[];
  invite: { code: string; expires_at: string } | null;
}

export interface PreviewDb {
  me: string;
  users: PreviewUser[];
  sessions: PreviewSession[];
  folders: PreviewFolder[];
  workspaces: PreviewWorkspace[];
}

const HUES = ['#ef6f47', '#e09528', '#7fa452', '#3aa09a', '#727bcb', '#c06aa2'];

type PageSeed = [title: string, url: string, minutes: number];

interface SessionSeed {
  id: string;
  owner: string;
  title: string;
  folder: string | null;
  /** 마지막 활동이 지금으로부터 몇 시간 전인가. */
  hoursAgo: number;
  overview: string;
  purpose: string;
  highlights: string[];
  todos?: string[];
  next?: string[];
  pages: PageSeed[];
  status?: 'pending' | 'done' | 'failed';
}

const ME = 'u-me';
const JIEUN = 'u-jieun';
const DOHYUN = 'u-dohyun';

const SESSIONS: SessionSeed[] = [
  {
    id: 's-jeju', owner: ME, title: '제주 3박 4일 여행 준비', folder: 'f-travel', hoursAgo: 2,
    overview: '11월 제주 여행의 항공권·렌터카·숙소를 비교하고 동선을 정리했다.',
    purpose: '예산 60만 원 안에서 3박 4일 일정을 확정하기',
    highlights: ['김포→제주 오전 편이 왕복 9만 원대로 가장 저렴', '렌터카는 완전자차 포함 3일 14만 원', '서귀포 숙소 2곳 후보'],
    todos: ['숙소 1곳 확정', '렌터카 예약'],
    next: ['애월 카페 동선 확인', '우도 배편 시간표 보기'],
    pages: [
      ['제주 항공권 최저가 - 네이버 항공권', 'https://flight.naver.com/flights/domestic/GMP-CJU', 6],
      ['제주 렌터카 가격비교 | 카모아', 'https://carmore.kr/home/', 4],
      ['서귀포 오션뷰 숙소 - 야놀자', 'https://www.yanolja.com/search/서귀포', 7],
      ['제주 3박 4일 동선 총정리 (feat. 렌터카)', 'https://blog.naver.com/jejutrip/223101', 9],
      ['제주 날씨 11월 평균 기온', 'https://www.weather.go.kr/w/index.do', 2],
      ['애월 카페 베스트 10 - 다이닝코드', 'https://www.diningcode.com/list.dc?query=애월카페', 5],
    ],
  },
  {
    id: 's-fastapi', owner: ME, title: 'FastAPI 비동기 DB 세션 정리', folder: 'f-capstone', hoursAgo: 5,
    overview: 'FastAPI 의존성 주입으로 요청마다 AsyncSession을 열고 닫는 방법과 백그라운드 작업의 세션 분리를 정리했다.',
    purpose: '배치 파이프라인에서 세션이 꼬이는 문제 해결',
    highlights: ['요청 스코프 세션은 Depends + yield 로 닫기', '백그라운드 작업은 새 세션 팩토리 사용', 'expire_on_commit=False 로 지연 로딩 오류 방지'],
    todos: ['sync_pipeline 세션 분리 적용'],
    next: ['SQLAlchemy 2.0 async 문서의 run_sync 절 읽기'],
    pages: [
      ['Dependencies with yield - FastAPI', 'https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/', 8],
      ['Asynchronous I/O (asyncio) — SQLAlchemy 2.0', 'https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html', 12],
      ['python - FastAPI background task db session closed - Stack Overflow', 'https://stackoverflow.com/questions/72921178', 6],
      ['AsyncSession expire_on_commit 이슈 · sqlalchemy/sqlalchemy', 'https://github.com/sqlalchemy/sqlalchemy/discussions/9312', 4],
      ['Background Tasks - FastAPI', 'https://fastapi.tiangolo.com/tutorial/background-tasks/', 3],
    ],
  },
  {
    id: 's-mv3', owner: ME, title: 'Chrome MV3 서비스 워커 수명', folder: 'f-capstone', hoursAgo: 26,
    overview: 'MV3 서비스 워커가 30초 유휴 뒤 종료되는 조건과 이벤트 유실을 막는 방법을 찾아봤다.',
    purpose: '수집 이벤트가 워커 종료로 사라지지 않게 하기',
    highlights: ['chrome.alarms 는 최소 30초 주기', 'IndexedDB 큐에 먼저 쓰고 동기화 뒤 정리', '오프스크린 문서는 이 용도에 부적합'],
    pages: [
      ['The extension service worker lifecycle | Chrome for Developers', 'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle', 10],
      ['chrome.alarms | API | Chrome for Developers', 'https://developer.chrome.com/docs/extensions/reference/api/alarms', 4],
      ['MV3 service worker terminated while fetch in progress - Stack Overflow', 'https://stackoverflow.com/questions/66618136', 7],
      ['GoogleChrome/chrome-extensions-samples', 'https://github.com/GoogleChrome/chrome-extensions-samples', 3],
    ],
  },
  {
    id: 's-qdrant', owner: ME, title: 'Qdrant 필터 검색 성능', folder: 'f-capstone', hoursAgo: 30,
    overview: '페이로드 인덱스와 HasId 조건이 검색 속도와 정확도에 주는 영향을 비교했다.',
    purpose: '사용자별 필터를 걸어도 검색 품질 유지하기',
    highlights: ['keyword 인덱스가 없으면 필터 검색이 전체 스캔', 'HasIdCondition 은 수천 개까지는 무난', 'top-k 를 먼저 뽑고 거르면 남의 결과가 자리를 채움'],
    pages: [
      ['Filtering - Qdrant', 'https://qdrant.tech/documentation/concepts/filtering/', 9],
      ['Indexing - Qdrant', 'https://qdrant.tech/documentation/concepts/indexing/', 6],
      ['Payload index performance · qdrant/qdrant · Discussion', 'https://github.com/qdrant/qdrant/discussions/2416', 5],
      ['벡터 DB 필터링 성능 비교 실험기', 'https://velog.io/@vector/qdrant-filter', 8],
    ],
  },
  {
    id: 's-gpu', owner: ME, title: 'RTX 5070 그래픽카드 비교', folder: 'f-shopping', hoursAgo: 50,
    overview: 'RTX 5070 제조사별 가격과 소음·발열 리뷰를 모았다.',
    purpose: '80만 원 이하에서 조용한 모델 고르기',
    highlights: ['MSI 벤투스는 가장 저렴하지만 소음 지적', '이엠텍 미라클은 3년 무상 AS', '최저가는 주말에 3~4만 원 내려감'],
    todos: ['가격 알림 설정'],
    pages: [
      ['RTX 5070 : 다나와 가격비교', 'https://prod.danawa.com/list/?cate=112753', 8],
      ['RTX 5070 리뷰 모음 - 퀘이사존', 'https://quasarzone.com/bbs/qc_qsz', 11],
      ['RTX 5070 소음 테스트 (YouTube)', 'https://www.youtube.com/watch?v=5070noise', 6],
      ['컴퓨존 RTX 5070 특가', 'https://www.compuzone.co.kr/search/search.htm?SearchProductKey=5070', 3],
    ],
  },
  {
    id: 's-slides', owner: ME, title: '졸업 발표 자료 디자인 레퍼런스', folder: 'f-capstone', hoursAgo: 75,
    overview: '발표 슬라이드에 쓸 정보 구조와 다이어그램 레퍼런스를 모았다.',
    purpose: '3분 시연 발표의 흐름과 그림 정하기',
    highlights: ['문제→시연→구조→지표 순서가 가장 흔함', '아키텍처 그림은 한 장에 상자 7개 이하', '어두운 배경 슬라이드는 프로젝터에서 대비 손실'],
    pages: [
      ['Pitch deck - Dribbble', 'https://dribbble.com/search/pitch-deck', 7],
      ['Product demo slides - Behance', 'https://www.behance.net/search/projects/product%20demo', 6],
      ['Presentation templates – Figma Community', 'https://www.figma.com/community/presentation-templates', 5],
      ['좋은 기술 발표의 구조', 'https://brunch.co.kr/@techtalk/42', 8],
    ],
  },
  {
    id: 's-osaka', owner: ME, title: '오사카 맛집 리스트', folder: 'f-travel', hoursAgo: 100,
    overview: '도톤보리·우메다 근처 맛집을 예약 가능 여부와 함께 정리했다.',
    purpose: '오사카 2박 일정의 저녁 식당 정하기',
    highlights: ['타베로그 3.5 이상만 추림', '야키니쿠 한 곳은 온라인 예약 필수'],
    pages: [
      ['大阪 ランキング - 食べログ', 'https://tabelog.com/osaka/rstLst/', 9],
      ['오사카 현지인 맛집 12곳', 'https://blog.naver.com/osaka_eat/2231', 7],
      ['Google 지도 - 도톤보리', 'https://www.google.com/maps/place/Dotonbori', 3],
    ],
  },
  {
    id: 's-react', owner: ME, title: 'React 19 useOptimistic 사용법', folder: null, hoursAgo: 120,
    overview: 'useOptimistic 으로 공유 토글을 즉시 반영하고 실패 시 되돌리는 패턴을 확인했다.',
    purpose: '팀 공유 시트의 즉시 반영 구현',
    highlights: ['서버 응답 전 화면을 먼저 바꾸고 실패하면 원상복구', 'react-query 의 onMutate 와 역할이 겹침'],
    pages: [
      ['useOptimistic – React', 'https://react.dev/reference/react/useOptimistic', 8],
      ['Optimistic Updates | TanStack Query', 'https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates', 6],
      ['React 19 실전 정리', 'https://velog.io/@react/react19', 7],
    ],
  },
  {
    id: 's-airpods', owner: ME, title: '에어팟 프로 3 구매 고민', folder: 'f-shopping', hoursAgo: 150,
    overview: '에어팟 프로 3의 노이즈 캔슬링 리뷰와 최저가를 비교했다.',
    purpose: '지금 살지 할인 시즌을 기다릴지 정하기',
    highlights: ['쿠팡 와우 할인가가 공식가보다 4만 원 저렴', '착용감 개선 평이 많음'],
    pages: [
      ['AirPods Pro 3 - Apple (KR)', 'https://www.apple.com/kr/airpods-pro/', 5],
      ['에어팟 프로 3 : 다나와', 'https://search.danawa.com/dsearch.php?query=에어팟프로3', 4],
      ['에어팟 프로 3 한 달 사용기', 'https://blog.naver.com/gadget/2231', 8],
    ],
  },
  {
    id: 's-toeic', owner: ME, title: '토익 스피킹 준비', folder: null, hoursAgo: 190,
    overview: '토익 스피킹 IM3 목표로 유형별 답변 템플릿과 시험 일정을 찾아봤다.',
    purpose: '한 달 안에 IM3 받기',
    highlights: ['파트 5 의견 제시가 배점 비중 큼', '시험은 매주 토·일'],
    pages: [
      ['TOEIC Speaking 시험 일정 - YBM', 'https://exam.toeic.co.kr/receipt/examSchList.php', 3],
      ['토스 IM3 한 달 공부법', 'https://blog.naver.com/toss_im3/2231', 9],
      ['토익스피킹 파트별 템플릿 (YouTube)', 'https://www.youtube.com/watch?v=toss-template', 12],
    ],
  },
  {
    id: 's-lease', owner: ME, title: '자취방 전세 사기 예방', folder: null, hoursAgo: 230,
    overview: '전세 계약 전에 확인할 등기부·보증보험·선순위 채권을 정리했다.',
    purpose: '이사 전 체크리스트 만들기',
    highlights: ['HUG 전세보증보험 가입 가능 여부 먼저 확인', '등기부 을구의 근저당 금액 확인'],
    pages: [
      ['전세사기 예방 가이드 - 국토교통부', 'https://www.molit.go.kr/jeonse', 6],
      ['HUG 전세보증금반환보증', 'https://www.khug.or.kr/hug/web/ig/dr/igdr000001.jsp', 5],
      ['전세 계약 체크리스트 12가지', 'https://www.hankyung.com/article/2026091512', 4],
    ],
  },
  {
    id: 's-shoes', owner: ME, title: '러닝화 추천', folder: 'f-shopping', hoursAgo: 280, status: 'pending',
    overview: '', purpose: '', highlights: [],
    pages: [
      ['러닝화 랭킹 - 무신사', 'https://www.musinsa.com/category/103004', 6],
      ['Nike Pegasus 42', 'https://www.nike.com/kr/t/pegasus-42', 4],
      ['입문 러닝화 고르는 법', 'https://blog.naver.com/runner/2231', 7],
    ],
  },
  // 팀원 세션 — 팀에 공유될 때만 보인다.
  {
    id: 's-prompt', owner: JIEUN, title: 'LLM 세션 요약 프롬프트 실험', folder: null, hoursAgo: 8,
    overview: '요약 프롬프트에 목적·할 일 칸을 따로 두었을 때 누락이 줄어드는지 비교했다.',
    purpose: '세션 요약 품질 올리기',
    highlights: ['JSON 스키마를 먼저 보여 주면 형식 오류가 거의 없음', '할 일 칸은 빈 배열을 허용해야 지어내지 않음'],
    pages: [
      ['Prompt engineering guide', 'https://www.promptingguide.ai/techniques', 10],
      ['Structured outputs - OpenAI API', 'https://platform.openai.com/docs/guides/structured-outputs', 7],
      ['요약 품질 평가 지표 정리', 'https://velog.io/@nlp/summary-metrics', 9],
    ],
  },
  {
    id: 's-icons', owner: JIEUN, title: '아이콘 시스템 정리', folder: null, hoursAgo: 52,
    overview: '확장과 새 탭에서 쓰는 아이콘을 Phosphor 하나로 통일하는 안을 조사했다.',
    purpose: '아이콘 굵기·크기 기준 정하기',
    highlights: ['16·20·24 세 크기만 사용', '선 굵기는 regular 로 통일'],
    pages: [
      ['Phosphor Icons', 'https://phosphoricons.com/', 8],
      ['Icon sizing guidelines - Material Design', 'https://m3.material.io/styles/icons/designing-icons', 5],
    ],
  },
  {
    id: 's-sse', owner: DOHYUN, title: 'SSE 스트리밍 오류 처리', folder: null, hoursAgo: 20,
    overview: 'SSE 스트림이 중간에 끊겼을 때 부분 답을 보존하고 다시 시도하는 방법을 찾았다.',
    purpose: 'Ask 답변이 중간에 끊겨도 사용자에게 알리기',
    highlights: ['첫 토큰 이후 실패는 폴백하지 말고 부분 답 표시', 'AbortController 로 범위 전환 시 스트림 정리'],
    pages: [
      ['Using server-sent events - MDN', 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events', 9],
      ['StreamingResponse - FastAPI', 'https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse', 5],
      ['fetch 스트림 중단 처리 패턴', 'https://velog.io/@web/fetch-stream-abort', 6],
    ],
  },
  {
    id: 's-pgvector', owner: DOHYUN, title: 'pgvector vs Qdrant 비교', folder: null, hoursAgo: 70,
    overview: '운영 단순성과 필터 검색 성능을 기준으로 pgvector 와 Qdrant 를 비교했다.',
    purpose: '벡터 저장소 유지 여부 결정 근거 만들기',
    highlights: ['pgvector 는 HNSW 필터 검색에서 재현율 저하', 'Qdrant 는 별도 운영 부담'],
    pages: [
      ['pgvector/pgvector - GitHub', 'https://github.com/pgvector/pgvector', 7],
      ['Qdrant vs pgvector benchmark', 'https://qdrant.tech/benchmarks/', 8],
    ],
  },
  {
    id: 's-fukuoka', owner: JIEUN, title: '후쿠오카 1박 2일 루트', folder: null, hoursAgo: 40,
    overview: '후쿠오카 공항에서 텐진·하카타를 도는 1박 2일 루트를 짰다.',
    purpose: '동아리 MT 일정 초안',
    highlights: ['공항선 지하철로 텐진까지 11분', '야타이는 저녁 6시 이후'],
    pages: [
      ['후쿠오카 1박 2일 코스', 'https://blog.naver.com/fukuoka/2231', 9],
      ['福岡市地下鉄 路線図', 'https://subway.city.fukuoka.lg.jp/route/', 3],
    ],
  },
];

function iso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

function buildSession(seed: SessionSeed): PreviewSession {
  // 마지막 방문이 hoursAgo 에 오도록 페이지마다 머문 시간만큼 앞으로 거슬러 간다.
  let cursor = Date.now() - seed.hoursAgo * 3_600_000;
  const events: PreviewEvent[] = [];
  for (let index = seed.pages.length - 1; index >= 0; index -= 1) {
    const [title, url, minutes] = seed.pages[index];
    events.unshift({
      event_id: `${seed.id}-e${index + 1}`,
      url,
      title,
      domain: new URL(url).hostname.replace(/^www\./, ''),
      visited_at: new Date(cursor - minutes * 60_000).toISOString(),
      active_duration_ms: minutes * 60_000,
    });
    cursor -= (minutes + 1) * 60_000;
  }
  const first = events[0]?.visited_at ?? iso(seed.hoursAgo);
  const status = seed.status ?? 'done';
  return {
    session_id: seed.id,
    owner: seed.owner,
    title: seed.title,
    alias: null,
    summary: {
      overview: seed.overview,
      purpose: seed.purpose,
      highlights: seed.highlights,
      todos: seed.todos ?? [],
      next_actions: seed.next ?? [],
    },
    summary_status: status,
    created_at: first,
    updated_at: iso(seed.hoursAgo),
    last_activity_at: iso(seed.hoursAgo),
    folder_id: seed.folder,
    events,
  };
}

export function createPreviewDb(): PreviewDb {
  const folders: PreviewFolder[] = [
    ['f-capstone', '졸업 프로젝트'],
    ['f-travel', '여행'],
    ['f-shopping', '쇼핑'],
  ].map(([folder_id, name], position) => ({
    folder_id, name, hue: HUES[position % HUES.length], position, created_at: iso(400), updated_at: iso(400),
  }));

  const share = (session_id: string, shared_by: string, hoursAgo: number) => ({ session_id, shared_by, shared_at: iso(hoursAgo) });
  const workspaces: PreviewWorkspace[] = [
    {
      workspace_id: 'w-capstone', name: '졸업 프로젝트 팀', hue: HUES[4], created_at: iso(300), invite: null,
      members: [
        { user_id: ME, role: 'owner', joined_at: iso(300) },
        { user_id: JIEUN, role: 'member', joined_at: iso(290) },
        { user_id: DOHYUN, role: 'member', joined_at: iso(280) },
      ],
      shares: [
        share('s-fastapi', ME, 4), share('s-mv3', ME, 25), share('s-qdrant', ME, 29), share('s-slides', ME, 70),
        share('s-prompt', JIEUN, 7), share('s-icons', JIEUN, 50), share('s-sse', DOHYUN, 19), share('s-pgvector', DOHYUN, 69),
      ],
    },
    {
      workspace_id: 'w-travel', name: '여행 동아리', hue: HUES[3], created_at: iso(250), invite: null,
      members: [
        { user_id: JIEUN, role: 'owner', joined_at: iso(250) },
        { user_id: ME, role: 'member', joined_at: iso(240) },
      ],
      shares: [share('s-jeju', ME, 1), share('s-osaka', ME, 99), share('s-fukuoka', JIEUN, 39)],
    },
  ];

  return {
    me: ME,
    users: [
      { user_id: ME, name: '김오르빗', email: 'me@orbit.test', picture: null },
      { user_id: JIEUN, name: '박지은', email: 'jieun@orbit.test', picture: null },
      { user_id: DOHYUN, name: '이도현', email: 'dohyun@orbit.test', picture: null },
    ],
    sessions: SESSIONS.map(buildSession),
    folders,
    workspaces,
  };
}

/** 확장의 바로가기(topSites) 대역. */
export const TOP_SITES = [
  { title: 'NAVER', url: 'https://www.naver.com/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: '다나와', url: 'https://www.danawa.com/' },
  { title: 'Notion', url: 'https://www.notion.so/' },
];

/** 사이드패널 "열린 탭" 대역. */
export const OPEN_TABS = [
  { title: '제주 렌터카 가격비교 | 카모아', url: 'https://carmore.kr/home/' },
  { title: 'Filtering - Qdrant', url: 'https://qdrant.tech/documentation/concepts/filtering/' },
  { title: 'useOptimistic – React', url: 'https://react.dev/reference/react/useOptimistic' },
  { title: 'RTX 5070 : 다나와 가격비교', url: 'https://prod.danawa.com/list/?cate=112753' },
];
