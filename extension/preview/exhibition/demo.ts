/**
 * 현수막 시연 데이터 — 가상의 사이트와 세션. 실존 서비스·회사·제품 이름, 로고, 사진을 쓰지 않는다(대표 2026-10-20).
 *
 * 세션 이야기(제주 여행, React 상태, 그래픽카드 …)는 미리보기 합성 데이터(preview/fixtures.ts)와 같고,
 * 페이지는 모두 지어낸 사이트다. 도메인은 예시 전용 최상위 도메인 .example 이라 가상임이 드러난다.
 * 페이지 화면은 pages.tsx 가 이 데이터로 직접 그린다(캡처하지 않는다).
 */

export type Art = 'plane' | 'car' | 'hotel' | 'island' | 'cup' | 'food' | 'shoe' | 'gpu' | 'buds' | 'city' | 'slide' | 'house' | 'mic' | 'wave';

export type Kind = 'search' | 'blog' | 'docs' | 'qa' | 'map' | 'weather' | 'shop' | 'list' | 'guide' | 'issue';

export interface Site {
  name: string;
  domain: string;
  /** 사이트 대표색 */
  color: string;
  /** 옅은 바탕색 */
  tint: string;
  /** 머리 모양 — 파비콘과 사이트 머리에 같이 쓴다 */
  mark: 'circle' | 'square' | 'drop' | 'pill';
}

export interface Item {
  title: string;
  meta?: string;
  price?: string;
  art?: Art;
  badge?: string;
}

export interface DemoPage {
  id: string;
  site: keyof typeof SITES;
  /** 탭 제목 */
  title: string;
  path: string;
  minutes: number;
  kind: Kind;
  /** 페이지 안의 큰 제목 */
  heading: string;
  /** 검색칸·필터 */
  query?: string[];
  items?: Item[];
  art?: Art;
  lines?: string[];
  code?: string[];
}

export interface DemoSession {
  id: string;
  title: string;
  folder: string | null;
  day: string;
  /** 마지막 방문 시각(HH:MM). 앞 페이지 시각은 체류 시간으로 거꾸로 센다. */
  end: string;
  overview: string;
  highlights: string[];
  next: string[];
  pages: DemoPage[];
}

export const SITES = {
  haneul: { name: '하늘길 항공권', domain: 'haneulgil.example', color: '#2f62d6', tint: '#eaf0fd', mark: 'circle' },
  bakwi: { name: '섬바퀴 렌터카', domain: 'seombakwi.example', color: '#13958a', tint: '#e3f5f2', mark: 'square' },
  pado: { name: '파도소리 스테이', domain: 'padosori.example', color: '#5b55c9', tint: '#ecebfa', mark: 'drop' },
  tripnote: { name: '여행노트', domain: 'tripnote.example', color: '#d9772f', tint: '#fbefe5', mark: 'pill' },
  oneul: { name: '오늘하늘 날씨', domain: 'oneulhaneul.example', color: '#2f8fd0', tint: '#e6f2fb', mark: 'circle' },
  cafejido: { name: '카페지도', domain: 'cafejido.example', color: '#8a5a3c', tint: '#f4ece6', mark: 'drop' },
  hanip: { name: '한입지도', domain: 'hanipjido.example', color: '#d2503f', tint: '#fbe9e6', mark: 'circle' },
  fenote: { name: '프론트엔드 노트', domain: 'fe-notes.example', color: '#4b47c9', tint: '#ecebfa', mark: 'square' },
  devqna: { name: '개발 묻고답하기', domain: 'devqna.example', color: '#d98a12', tint: '#fcf1de', mark: 'pill' },
  codeddeul: { name: '코드뜰', domain: 'codeddeul.example', color: '#2c6a4c', tint: '#e5f1ea', mark: 'square' },
  servernote: { name: '서버 노트', domain: 'server-notes.example', color: '#0f7a5c', tint: '#e2f3ec', mark: 'circle' },
  bupum: { name: '부품마켓', domain: 'bupummarket.example', color: '#c8344f', tint: '#fae6ea', mark: 'square' },
  hwlounge: { name: '하드웨어 라운지', domain: 'hwlounge.example', color: '#3b6f8f', tint: '#e5eff5', mark: 'pill' },
  dalligi: { name: '달리기상점', domain: 'dalligi.example', color: '#e0632a', tint: '#fcebe2', mark: 'drop' },
  runlog: { name: '러닝일지', domain: 'runlog.example', color: '#6c8a2f', tint: '#eef3e3', mark: 'circle' },
  slidegallery: { name: '슬라이드 갤러리', domain: 'slide-gallery.example', color: '#b8417a', tint: '#f8e7ef', mark: 'pill' },
  devlog: { name: '개발 기록장', domain: 'devlog.example', color: '#5a6473', tint: '#eceef1', mark: 'square' },
  jugeo: { name: '주거안심 가이드', domain: 'jugeo-guide.example', color: '#1d78b5', tint: '#e4f0f8', mark: 'drop' },
  malhagi: { name: '말하기 연습실', domain: 'malhagi.example', color: '#7a4fc4', tint: '#efe9f9', mark: 'circle' },
  soribigyo: { name: '소리비교', domain: 'soribigyo.example', color: '#2b7d8f', tint: '#e3f1f4', mark: 'pill' },
} satisfies Record<string, Site>;

export const DEMO_SESSIONS: DemoSession[] = [
  {
    id: 's-jeju',
    title: '제주 3박 4일 여행 준비',
    folder: '여행',
    day: '어제',
    end: '15:20',
    overview: '11월 제주 여행의 항공권·렌터카·숙소를 비교하고 동선을 정리했다.',
    highlights: ['김포→제주 오전 편이 왕복 9만 원대로 가장 저렴', '렌터카는 완전자차 포함 3일 14만 원', '서귀포 숙소 2곳 후보'],
    next: ['애월 카페 동선 확인', '우도 배편 시간표 보기'],
    pages: [
      {
        id: 'jeju-flight', site: 'haneul', title: '김포 → 제주 항공권 비교 · 하늘길', path: '/flights/gmp-cju', minutes: 6, kind: 'search',
        heading: '김포 → 제주', art: 'plane',
        query: ['출발 김포', '도착 제주', '11.14(금) – 11.17(월)', '성인 1명'],
        items: [
          { title: '07:10 → 08:20', meta: '구름항공 · 직항 1시간 10분', price: '92,400원', badge: '최저가' },
          { title: '08:05 → 09:15', meta: '바람에어 · 직항 1시간 10분', price: '98,900원' },
          { title: '09:40 → 10:50', meta: '온새항공 · 직항 1시간 10분', price: '104,200원' },
          { title: '12:30 → 13:40', meta: '구름항공 · 직항 1시간 10분', price: '111,800원' },
          { title: '15:55 → 17:05', meta: '바람에어 · 직항 1시간 10분', price: '118,000원' },
        ],
      },
      {
        id: 'jeju-car', site: 'bakwi', title: '제주 렌터카 3일 가격 비교 · 섬바퀴', path: '/jeju/compare', minutes: 4, kind: 'search',
        heading: '제주공항에서 바로 타기', art: 'car',
        query: ['제주공항 인수', '11.14 10:00', '11.17 18:00', '완전자차'],
        items: [
          { title: '소형 전기차', meta: '완전자차 포함 · 5인승', price: '141,000원', art: 'car', badge: '추천' },
          { title: '준중형 세단', meta: '완전자차 포함 · 5인승', price: '156,000원', art: 'car' },
          { title: '소형 SUV', meta: '완전자차 포함 · 5인승', price: '172,000원', art: 'car' },
          { title: '경차', meta: '일반자차 · 4인승', price: '118,000원', art: 'car' },
        ],
      },
      {
        id: 'jeju-stay', site: 'pado', title: '서귀포 오션뷰 숙소 · 파도소리 스테이', path: '/search/seogwipo', minutes: 7, kind: 'search',
        heading: '서귀포 · 오션뷰', art: 'hotel',
        query: ['서귀포', '11.14 – 11.17 · 3박', '성인 2명'],
        items: [
          { title: '바다정원 호텔', meta: '★ 4.7 · 오션뷰 · 무료 취소', price: '1박 129,000원', art: 'hotel', badge: '인기' },
          { title: '돌담 스테이', meta: '★ 4.8 · 독채 · 조식', price: '1박 179,000원', art: 'house' },
          { title: '푸른섬 리조트', meta: '★ 4.4 · 수영장', price: '1박 85,000원', art: 'hotel' },
          { title: '쇠소깍 게스트하우스', meta: '★ 4.6 · 도보 8분', price: '1박 64,000원', art: 'house' },
        ],
      },
      {
        id: 'jeju-blog', site: 'tripnote', title: '제주 3박 4일 동선 총정리 (렌터카 기준) · 여행노트', path: '/jeju-3n4d', minutes: 9, kind: 'blog',
        heading: '제주 3박 4일 동선 총정리', art: 'island',
        lines: [
          '렌터카를 공항에서 받아 서쪽부터 한 바퀴 도는 동선입니다.',
          '1일차 · 공항 → 애월 해안도로 → 협재',
          '2일차 · 오설록 → 중문 → 서귀포',
          '3일차 · 쇠소깍 → 성산 → 우도',
          '4일차 · 함덕 → 공항',
        ],
      },
      {
        id: 'jeju-weather', site: 'oneul', title: '제주 11월 날씨 · 오늘하늘', path: '/jeju/month/11', minutes: 2, kind: 'weather',
        heading: '제주시 · 11월', art: 'wave',
        items: [
          { title: '금', meta: '맑음', price: '19°' },
          { title: '토', meta: '구름', price: '17°' },
          { title: '일', meta: '비', price: '15°' },
          { title: '월', meta: '맑음', price: '18°' },
        ],
      },
      {
        id: 'jeju-cafe', site: 'cafejido', title: '애월 바다 카페 10곳 · 카페지도', path: '/aewol', minutes: 5, kind: 'list',
        heading: '애월 바다 카페 10곳',
        items: [
          { title: '노을 앞 카페', meta: '★ 4.6 · 바다 전망', art: 'cup' },
          { title: '돌창고 커피', meta: '★ 4.5 · 주차', art: 'cup' },
          { title: '해안길 베이커리', meta: '★ 4.4 · 빵', art: 'food' },
          { title: '파도 소리 다방', meta: '★ 4.3 · 조용함', art: 'cup' },
        ],
      },
    ],
  },
  {
    id: 's-osaka',
    title: '오사카 맛집 리스트',
    folder: '여행',
    day: '4일 전',
    end: '21:40',
    overview: '도톤보리·우메다 근처 맛집을 예약 가능 여부와 함께 정리했다.',
    highlights: ['평점 4.5 이상만 추림', '야키니쿠 한 곳은 온라인 예약 필수'],
    next: ['둘째 날 저녁 예약'],
    pages: [
      {
        id: 'osaka-rank', site: 'hanip', title: '오사카 맛집 순위 · 한입지도', path: '/osaka/rank', minutes: 9, kind: 'list',
        heading: '오사카 맛집 순위',
        items: [
          { title: '골목 우동집', meta: '★ 4.7 · 줄 서는 곳', art: 'food' },
          { title: '숯불 야키니쿠', meta: '★ 4.6 · 예약 필수', art: 'food' },
          { title: '강가 오코노미야키', meta: '★ 4.5 · 늦게까지', art: 'food' },
          { title: '시장 초밥', meta: '★ 4.5 · 아침', art: 'food' },
        ],
      },
      {
        id: 'osaka-blog', site: 'tripnote', title: '오사카 현지인 맛집 12곳 · 여행노트', path: '/osaka-12', minutes: 7, kind: 'blog',
        heading: '현지인이 가는 오사카 맛집', art: 'city',
        lines: ['관광지 골목 한 블록 뒤가 진짜입니다.', '점심은 우동, 저녁은 야키니쿠로 나눴어요.', '예약은 이틀 전까지 해 두세요.'],
      },
      {
        id: 'osaka-map', site: 'hanip', title: '도톤보리 주변 지도 · 한입지도', path: '/osaka/map', minutes: 3, kind: 'map',
        heading: '도톤보리',
        items: [{ title: '골목 우동집' }, { title: '숯불 야키니쿠' }, { title: '강가 오코노미야키' }],
      },
    ],
  },
  {
    id: 's-fastapi',
    title: '비동기 DB 세션 정리',
    folder: '졸업 프로젝트',
    day: '어제',
    end: '12:05',
    overview: '요청마다 DB 세션을 열고 닫는 방법과 백그라운드 작업의 세션 분리를 정리했다.',
    highlights: ['요청 스코프 세션은 yield 로 닫기', '백그라운드 작업은 새 세션 팩토리 사용', '커밋 뒤 만료를 끄면 지연 로딩 오류가 사라짐'],
    next: ['배치 파이프라인에 세션 분리 적용'],
    pages: [
      {
        id: 'db-docs', site: 'servernote', title: '요청마다 DB 세션 열고 닫기 · 서버 노트', path: '/guide/db-session', minutes: 8, kind: 'docs',
        heading: '요청마다 DB 세션 열고 닫기',
        lines: ['의존성 함수에서 세션을 만들고 yield 한 뒤 닫는다.', '응답이 끝나면 세션도 함께 정리된다.'],
        code: ['async def get_db():', '    async with session_factory() as db:', '        yield db', '', '@app.get("/items")', 'async def items(db = Depends(get_db)):', '    return await db.scalars(query)'],
      },
      {
        id: 'db-async', site: 'servernote', title: '비동기 세션과 지연 로딩 · 서버 노트', path: '/guide/async-orm', minutes: 12, kind: 'docs',
        heading: '비동기 세션과 지연 로딩',
        lines: ['비동기 세션에서는 커밋 뒤 속성 접근이 오류를 낸다.', '만료를 끄거나 필요한 관계를 미리 불러온다.'],
        code: ['session_factory = async_sessionmaker(', '    engine, expire_on_commit=False', ')'],
      },
      {
        id: 'db-qa', site: 'devqna', title: '백그라운드 작업에서 세션이 닫혀요 · 개발 묻고답하기', path: '/q/72921', minutes: 6, kind: 'qa',
        heading: '백그라운드 작업에서 DB 세션이 이미 닫혔다고 나와요',
        lines: ['응답을 보낸 뒤 실행되는 작업이 요청 세션을 그대로 씁니다.', '작업 안에서 새 세션을 만들어야 합니다.'],
        code: ['async with session_factory() as db:', '    await run_job(db)'],
      },
      {
        id: 'db-issue', site: 'codeddeul', title: '커밋 뒤 만료 옵션 논의 · 코드뜰', path: '/orbit-lab/async-db/issues/31', minutes: 4, kind: 'issue',
        heading: '커밋 뒤 객체가 만료되어 다시 읽힘',
        lines: ['커밋할 때마다 객체가 만료되어 응답 직전에 다시 조회됩니다.', '기본값을 바꾸면 해결되지만 오래된 값을 볼 수 있습니다.'],
      },
    ],
  },
  {
    id: 's-react',
    title: 'React 상태 업데이트 정리',
    folder: '졸업 프로젝트',
    day: '5일 전',
    end: '22:10',
    overview: '공유 토글을 화면에 먼저 반영하고 실패하면 되돌리는 방법을 확인했다.',
    highlights: ['서버 응답 전에 화면을 먼저 바꾸고 실패하면 원상복구', '쿼리 캐시 갱신과 역할이 겹침'],
    next: ['공유 시트에 적용'],
    pages: [
      {
        id: 'react-docs', site: 'fenote', title: '낙관적 업데이트 · 프론트엔드 노트', path: '/hooks/optimistic', minutes: 8, kind: 'docs',
        heading: '낙관적 업데이트',
        lines: ['서버가 답하기 전에 바뀔 값을 먼저 보여 준다.', '실패하면 이전 상태로 돌아간다.'],
        code: ['const [shared, setShared] = useOptimistic(initial)', 'async function toggle() {', '  setShared(!shared)', '  await saveShare(!shared)', '}'],
      },
      {
        id: 'react-cache', site: 'fenote', title: '쿼리 캐시를 바로 고치기 · 프론트엔드 노트', path: '/data/cache-update', minutes: 6, kind: 'docs',
        heading: '쿼리 캐시를 바로 고치기',
        lines: ['요청을 보내기 전에 캐시를 고치고, 실패하면 저장해 둔 값으로 되돌린다.'],
        code: ['onMutate: async (next) => {', '  const before = cache.get(key)', '  cache.set(key, next)', '  return { before }', '}'],
      },
      {
        id: 'react-blog', site: 'devlog', title: '상태 업데이트 실전 정리 · 개발 기록장', path: '/state-updates', minutes: 7, kind: 'blog',
        heading: '상태 업데이트, 언제 먼저 보여 줄까', art: 'slide',
        lines: ['토글처럼 실패가 드문 동작은 먼저 바꿔도 된다.', '결제처럼 되돌리기 어려운 동작은 기다린다.'],
      },
    ],
  },
  {
    id: 's-gpu',
    title: '그래픽카드 비교',
    folder: '쇼핑',
    day: '2일 전',
    end: '23:30',
    overview: '같은 칩을 쓴 그래픽카드의 제조사별 가격과 소음·발열 후기를 모았다.',
    highlights: ['가장 싼 모델은 소음 지적이 많음', '3년 무상 보증 모델이 2만 원 비쌈', '주말에 가격이 3~4만 원 내려감'],
    next: ['가격 알림 설정'],
    pages: [
      {
        id: 'gpu-compare', site: 'bupum', title: '그래픽카드 가격 비교 · 부품마켓', path: '/gpu/compare', minutes: 8, kind: 'shop',
        heading: '그래픽카드 · 같은 칩 모델',
        items: [
          { title: 'A사 듀얼 팬', meta: '소음 보통', price: '789,000원', art: 'gpu' },
          { title: 'B사 트리플 팬', meta: '3년 보증', price: '812,000원', art: 'gpu' },
          { title: 'C사 미니', meta: '짧은 길이', price: '774,000원', art: 'gpu' },
          { title: 'D사 화이트', meta: '조용함', price: '835,000원', art: 'gpu' },
        ],
      },
      {
        id: 'gpu-review', site: 'hwlounge', title: '그래픽카드 소음·발열 후기 모음 · 하드웨어 라운지', path: '/review/gpu', minutes: 11, kind: 'qa',
        heading: '같은 칩, 다른 소음 — 사용 후기 모음',
        lines: ['부하가 걸리면 듀얼 팬 모델이 확실히 시끄럽습니다.', '트리플 팬은 온도가 5도 정도 낮았어요.'],
      },
      {
        id: 'gpu-deal', site: 'bupum', title: '주말 특가 · 부품마켓', path: '/deals/weekend', minutes: 3, kind: 'search',
        heading: '주말 특가', art: 'gpu',
        query: ['그래픽카드', '가격 낮은 순'],
        items: [
          { title: 'B사 트리플 팬', meta: '토·일 한정', price: '779,000원', art: 'gpu', badge: '특가' },
          { title: 'C사 미니', meta: '오늘만', price: '751,000원', art: 'gpu' },
        ],
      },
    ],
  },
  {
    id: 's-slides',
    title: '졸업 발표 자료 레퍼런스',
    folder: '졸업 프로젝트',
    day: '3일 전',
    end: '17:45',
    overview: '발표 슬라이드에 쓸 정보 구조와 그림 레퍼런스를 모았다.',
    highlights: ['문제 → 시연 → 구조 → 지표 순서가 가장 흔함', '구조 그림은 상자 7개 이하'],
    next: ['3분 시연 흐름 정하기'],
    pages: [
      {
        id: 'slides-gallery', site: 'slidegallery', title: '제품 발표 슬라이드 모음 · 슬라이드 갤러리', path: '/collections/product-demo', minutes: 7, kind: 'shop',
        heading: '제품 발표 슬라이드',
        items: [
          { title: '문제 정의', art: 'slide' },
          { title: '시연 흐름', art: 'slide' },
          { title: '시스템 구조', art: 'slide' },
          { title: '지표 한 장', art: 'slide' },
        ],
      },
      {
        id: 'slides-talk', site: 'devlog', title: '좋은 기술 발표의 구조 · 개발 기록장', path: '/good-tech-talks', minutes: 8, kind: 'blog',
        heading: '좋은 기술 발표의 구조', art: 'mic',
        lines: ['처음 30초에 문제를 보여 준다.', '구조 그림은 한 장에 상자 일곱 개를 넘기지 않는다.', '숫자는 잰 것만 말한다.'],
      },
    ],
  },
  {
    id: 's-shoes',
    title: '러닝화 추천',
    folder: '쇼핑',
    day: '6일 전',
    end: '20:15',
    overview: '입문용 러닝화의 쿠션과 무게를 비교했다.',
    highlights: ['입문은 쿠션이 두꺼운 모델', '발볼이 넓으면 반 치수 크게'],
    next: ['매장에서 신어 보기'],
    pages: [
      {
        id: 'shoes-shop', site: 'dalligi', title: '러닝화 순위 · 달리기상점', path: '/running/rank', minutes: 6, kind: 'shop',
        heading: '러닝화 이번 주 순위',
        items: [
          { title: '구름 쿠션 3', meta: '입문 · 쿠션', price: '129,000원', art: 'shoe' },
          { title: '바람 레이서', meta: '가벼움', price: '159,000원', art: 'shoe' },
          { title: '데일리 런', meta: '넓은 발볼', price: '99,000원', art: 'shoe' },
          { title: '트레일 원', meta: '흙길', price: '149,000원', art: 'shoe' },
        ],
      },
      {
        id: 'shoes-blog', site: 'runlog', title: '입문 러닝화 고르는 법 · 러닝일지', path: '/first-shoes', minutes: 7, kind: 'blog',
        heading: '입문 러닝화, 이것만 보세요', art: 'shoe',
        lines: ['처음에는 가벼움보다 쿠션입니다.', '오후에 신어 보고 고르세요.'],
      },
    ],
  },
  {
    id: 's-lease',
    title: '전세 계약 체크리스트',
    folder: null,
    day: '9일 전',
    end: '10:30',
    overview: '전세 계약 전에 확인할 등기·보증보험·선순위 채권을 정리했다.',
    highlights: ['보증보험 가입 가능 여부부터 확인', '등기부에서 근저당 금액 확인'],
    next: ['계약 전날 등기부 다시 떼기'],
    pages: [
      {
        id: 'lease-guide', site: 'jugeo', title: '전세 계약 전 체크리스트 · 주거안심 가이드', path: '/checklist', minutes: 6, kind: 'guide',
        heading: '계약 전에 꼭 확인할 다섯 가지',
        items: [{ title: '등기부 확인' }, { title: '보증보험 가능 여부' }, { title: '선순위 채권' }, { title: '전입신고 날짜' }, { title: '특약 문구' }],
      },
      {
        id: 'lease-insure', site: 'jugeo', title: '보증보험 알아보기 · 주거안심 가이드', path: '/insurance', minutes: 5, kind: 'guide',
        heading: '보증금을 지키는 보험',
        items: [{ title: '가입 조건' }, { title: '보증료 계산' }, { title: '신청 순서' }],
      },
    ],
  },
  {
    id: 's-toeic',
    title: '영어 말하기 시험 준비',
    folder: null,
    day: '8일 전',
    end: '19:50',
    overview: '말하기 시험의 유형별 답변 틀과 시험 일정을 찾아봤다.',
    highlights: ['의견 말하기 유형의 비중이 큼', '시험은 매주 주말'],
    next: ['유형 5 답변 틀 외우기'],
    pages: [
      {
        id: 'speak-guide', site: 'malhagi', title: '유형별 답변 틀 · 말하기 연습실', path: '/templates', minutes: 12, kind: 'guide',
        heading: '유형별 답변 틀',
        items: [{ title: '사진 묘사' }, { title: '짧은 대답' }, { title: '정보 찾기' }, { title: '의견 말하기' }],
      },
      {
        id: 'speak-blog', site: 'devlog', title: '한 달 만에 말하기 시험 준비 · 개발 기록장', path: '/speaking-30days', minutes: 9, kind: 'blog',
        heading: '한 달 만에 말하기 시험 준비하기', art: 'mic',
        lines: ['매일 두 유형씩 녹음하고 다시 들었습니다.', '시간을 재며 말하는 연습이 제일 도움이 됐어요.'],
      },
    ],
  },
  {
    id: 's-airpods',
    title: '무선 이어폰 고르기',
    folder: '쇼핑',
    day: '7일 전',
    end: '13:25',
    overview: '무선 이어폰의 소음 차단 후기와 가격을 비교했다.',
    highlights: ['착용감 평이 가장 갈림', '할인 시즌에 4만 원 차이'],
    next: ['할인 알림 받기'],
    pages: [
      {
        id: 'buds-review', site: 'soribigyo', title: '무선 이어폰 소음 차단 비교 · 소리비교', path: '/anc-compare', minutes: 8, kind: 'blog',
        heading: '소음 차단, 직접 비교했습니다', art: 'buds',
        lines: ['지하철에서 들어 보면 차이가 확실합니다.', '오래 끼면 귀가 아픈 모델도 있어요.'],
      },
      {
        id: 'buds-shop', site: 'bupum', title: '무선 이어폰 가격 비교 · 부품마켓', path: '/audio/earbuds', minutes: 4, kind: 'shop',
        heading: '무선 이어폰',
        items: [
          { title: '조용한 이어폰', meta: '소음 차단', price: '219,000원', art: 'buds' },
          { title: '데일리 이어폰', meta: '가벼움', price: '89,000원', art: 'buds' },
        ],
      },
    ],
  },
];

/** 팀 화면 시연 — 사람 이름 대신 Orbit 말장난 별칭을 쓴다(실존 인물로 읽히지 않게). */
export const DEMO_TEAM = {
  me: '오르빗',
  members: ['오르빗', '위성', '궤도'],
  teams: [
    { name: '졸업 프로젝트 팀', role: '소유자', size: 3, hue: '#727bcb' },
    { name: '여행 동아리', role: '팀원', size: 2, hue: '#3aa09a' },
  ],
  invite: 'ORBT-7K2Q',
};
