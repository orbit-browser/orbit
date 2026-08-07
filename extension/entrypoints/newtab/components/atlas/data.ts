/**
 * Orbit Atlas — 목 데이터.
 *
 * 백엔드(`orbit/backend`)의 도메인을 그대로 따른다:
 *   Orbit(주제 묶음) → Session(30분 gap 으로 그룹된 탐색 세션) → Page(방문 이벤트)
 * 세션 요약(overview/highlights/nextActions)은 summarizer 가 채우는 필드와 동일한 모양이다.
 */

export interface PageNode {
  id: string;
  title: string;
  url: string;
  domain: string;
  /** 체류 시간 (분) */
  minutes: number;
  /** 재방문 횟수 */
  visits: number;
}

export interface SessionSummary {
  overview: string;
  highlights: string[];
  nextActions: string[];
}

export interface SessionNode {
  id: string;
  title: string;
  /** 상대 날짜 라벨 */
  date: string;
  /** 세션 총 활성 시간 (분) */
  minutes: number;
  status: 'live' | 'recent' | 'archived';
  summary: SessionSummary;
  pages: PageNode[];
}

export interface OrbitNode {
  id: string;
  title: string;
  category: string;
  icon: string;
  /** 네비게이터 점 · 캔버스 궤도 색 */
  hue: string;
  sessions: SessionNode[];
}

const HUE = {
  terracotta: '#ef6f47',
  amber: '#e09528',
  olive: '#7fa452',
  teal: '#3aa09a',
  indigo: '#727bcb',
  plum: '#c06aa2',
  clay: '#cf7d57',
  slate: '#7b909b',
} as const;

/** `[제목, 도메인, 분, 재방문]` 튜플로 페이지를 간결하게 선언한다. */
type PageSpec = [title: string, domain: string, minutes: number, visits?: number];

const pages = (sessionId: string, specs: PageSpec[]): PageNode[] =>
  specs.map(([title, domain, minutes, visits = 1], i) => ({
    id: `${sessionId}-p${i}`,
    title,
    domain,
    url: `https://${domain.toLowerCase()}/${sessionId}-${i}`,
    minutes,
    visits,
  }));

export const ATLAS_ORBITS: OrbitNode[] = [
  {
    id: 'first-car',
    title: '첫 차 구매 리서치',
    category: '개인 리서치 / 구매',
    icon: 'ph-car',
    hue: HUE.terracotta,
    sessions: [
      {
        id: 'car-compare',
        title: '아반떼 vs K3 비교',
        date: '오늘',
        minutes: 84,
        status: 'live',
        summary: {
          overview:
            '아반떼 하이브리드와 K3 가솔린을 트림·유지비 기준으로 비교했다. 실구매가는 두 차종이 250만원 차이지만, 5년 유지비를 넣으면 격차가 90만원까지 좁혀진다.',
          highlights: [
            '아반떼 HEV 인스퍼레이션 실구매가 2,980만원 (개소세 인하 반영)',
            'K3 시그니처는 2,730만원, 다만 연비 차이로 연 42만원 추가 부담',
            'NCAP 충돌 안전 등급은 두 차종 모두 5성',
          ],
          nextActions: ['딜러 3곳 견적 요청', '주말 시승 예약'],
        },
        pages: pages('car-compare', [
          ['아반떼 하이브리드 트림별 가격표', 'HYUNDAI.COM', 12, 4],
          ['K3 시승기 — 실연비와 승차감', 'MOTORGRAPH.COM', 9, 2],
          ['아반떼 vs K3 유지비 5년 시뮬레이션', 'CARISYOU.COM', 14, 3],
          ['NCAP 충돌 안전 평가 리포트', 'KNCAP.OR.KR', 6],
          ['지역 딜러 프로모션 모음', 'DANAWA.COM', 7, 2],
          ['실연비 커뮤니티 후기 스레드', 'BOBAEDREAM.CO.KR', 11, 2],
        ]),
      },
      {
        id: 'car-insurance',
        title: '자동차 보험 견적 비교',
        date: '어제',
        minutes: 38,
        status: 'recent',
        summary: {
          overview:
            '만 27세 · 가입경력 1년 기준으로 4개사 견적을 받았다. 자기부담금 20만원 조건에서 연 78~92만원 범위.',
          highlights: [
            '현대해상 78만원이 최저, 다만 긴급출동 항목이 빠져 있음',
            '자차 자기부담금 30만원으로 올리면 전 사에서 8~11% 절감',
          ],
          nextActions: ['다이렉트 3사 최종 견적 재조회'],
        },
        pages: pages('car-insurance', [
          ['자동차보험 보험료 계산기', 'HI.CO.KR', 8, 3],
          ['자기부담금별 보험료 차이 정리', 'INSCOMPARE.KR', 6],
          ['긴급출동 특약 실제 사용 후기', 'CLIEN.NET', 5, 2],
          ['다이렉트 4사 보장 범위 비교표', 'NAVER.COM', 9],
          ['사고 직접청구 절차 안내', 'KIDI.OR.KR', 4],
        ]),
      },
      {
        id: 'ev-subsidy',
        title: '전기차 보조금 조사',
        date: '3일 전',
        minutes: 42,
        status: 'archived',
        summary: {
          overview:
            '2024년 국고 보조금과 대전시 지방비를 합산하면 EV3 기준 약 1,100만원. 다만 상반기 물량이 6월에 소진될 가능성이 높다.',
          highlights: ['국고 580만원 + 대전시 520만원', '충전 인프라는 도보 8분 거리 급속 2기'],
          nextActions: ['지자체 공고일 확인'],
        },
        pages: pages('ev-subsidy', [
          ['2024 전기차 보조금 업무처리지침', 'EV.OR.KR', 13, 2],
          ['EV3 트림별 가격 및 출고 대기', 'KIA.COM', 8],
          ['우리 동네 충전소 지도', 'EVWHERE.CO.KR', 5],
          ['친환경차 취등록세 감면 한도', 'HOMETAX.GO.KR', 7],
          ['배터리 보증 조건 비교', 'BATTERYUNIV.COM', 9],
        ]),
      },
    ],
  },
  {
    id: 'kyoto-2024',
    title: '교토 여행 2024',
    category: '여행 계획',
    icon: 'ph-airplane-tilt',
    hue: HUE.amber,
    sessions: [
      {
        id: 'kyoto-ryokan',
        title: '아라시야마 료칸 조사',
        date: '2일 전',
        minutes: 56,
        status: 'recent',
        summary: {
          overview:
            '아라시야마 일대 료칸 5곳을 조식·가이세키 포함 조건으로 비교했다. 4월 첫째 주는 벚꽃 성수기라 2박 최소 요건이 붙는다.',
          highlights: [
            '호시노야 교토는 1박 12만엔대, 선착장 셔틀 포함',
            '벚꽃 피크는 4월 3~9일 예보',
          ],
          nextActions: ['2순위 료칸 취소 정책 확인', '항공권과 날짜 맞추기'],
        },
        pages: pages('kyoto-ryokan', [
          ['호시노야 교토 공식 예약 페이지', 'HOSHINOYA.COM', 11, 3],
          ['아라시야마 료칸 5곳 비교', 'BOOKING.COM', 9, 2],
          ['교토 4월 벚꽃 개화 예보', 'SAKURA.WEATHERMAP.JP', 6, 4],
          ['가이세키 포함 요금 실제 후기', 'TRIPADVISOR.COM', 8],
          ['아라시야마 새벽 산책 코스', 'JAPAN-GUIDE.COM', 7],
        ]),
      },
      {
        id: 'kansai-pass',
        title: '간사이 교통패스 계산',
        date: '2일 전',
        minutes: 24,
        status: 'archived',
        summary: {
          overview: '4일 일정 기준 JR 간사이 와이드 패스보다 이코카 충전이 3,200엔 저렴하다.',
          highlights: ['공항↔교토 하루카 왕복이 비용의 절반', '시내 이동은 버스 1일권이 유리'],
          nextActions: [],
        },
        pages: pages('kansai-pass', [
          ['간사이 와이드 패스 요금표', 'JRPASS.COM', 7],
          ['하루카 편도 요금 및 시간표', 'WESTJR.CO.JP', 5, 2],
          ['교토 시내버스 1일권 범위', 'CITY.KYOTO.LG.JP', 6],
          ['이코카 vs 패스 비용 계산기', 'KANSAI-TRIP.KR', 6],
        ]),
      },
    ],
  },
  {
    id: 'gaussian-splatting',
    title: '3DGS 논문 정리',
    category: '학습 / 연구',
    icon: 'ph-atom',
    hue: HUE.indigo,
    sessions: [
      {
        id: '3dgs-survey',
        title: 'Gaussian Splatting 서베이',
        date: '4일 전',
        minutes: 96,
        status: 'archived',
        summary: {
          overview:
            '3DGS 원논문과 후속 최적화 연구를 훑었다. 실시간 렌더링 성능의 핵심은 타일 기반 래스터라이저와 적응형 밀도 제어에 있다.',
          highlights: [
            '원논문 기준 1080p 130FPS, NeRF 대비 학습 시간 1/10',
            '후속 연구 대부분이 splat 개수 압축에 집중',
          ],
          nextActions: ['압축 계열 논문 3편 정독', '로컬에서 재현 실험'],
        },
        pages: pages('3dgs-survey', [
          ['3D Gaussian Splatting for Real-Time Rendering', 'ARXIV.ORG', 24, 5],
          ['공식 구현 저장소 README', 'GITHUB.COM', 12, 3],
          ['Compact 3DGS — splat 압축 기법', 'ARXIV.ORG', 16],
          ['SIGGRAPH 발표 영상 정리', 'YOUTUBE.COM', 14, 2],
          ['NeRF와의 정량 비교 벤치마크', 'PAPERSWITHCODE.COM', 9],
          ['CUDA 래스터라이저 구조 해설', 'MEDIUM.COM', 11],
        ]),
      },
      {
        id: '3dgs-slam',
        title: 'SLAM 연동 사례 조사',
        date: '5일 전',
        minutes: 34,
        status: 'archived',
        summary: {
          overview: '3DGS를 SLAM 백엔드와 결합한 최근 사례 4건을 정리했다.',
          highlights: ['SplaTAM 계열이 가장 재현 가능성이 높음'],
          nextActions: ['데이터셋 확보'],
        },
        pages: pages('3dgs-slam', [
          ['SplaTAM 논문', 'ARXIV.ORG', 15, 2],
          ['Gaussian-SLAM 구현 노트', 'GITHUB.COM', 8],
          ['Replica 데이터셋 다운로드', 'CS.UTEXAS.EDU', 4],
          ['실시간 트래킹 데모 비교', 'YOUTUBE.COM', 7],
        ]),
      },
    ],
  },
  {
    id: 'design-system',
    title: '디자인 시스템 구축',
    category: '업무 / UI 리서치',
    icon: 'ph-palette',
    hue: HUE.olive,
    sessions: [
      {
        id: 'design-tokens',
        title: '토큰 설계 레퍼런스',
        date: '오늘',
        minutes: 47,
        status: 'recent',
        summary: {
          overview:
            '3계층(원시 → 시맨틱 → 컴포넌트) 토큰 구조가 사실상 표준. 다크 모드는 시맨틱 레이어에서만 분기시키는 방식이 유지보수가 쉽다.',
          highlights: ['Radix 스케일은 12단계 고정으로 대비비 보장', 'Primer는 컴포넌트 토큰을 명시적으로 문서화'],
          nextActions: ['우리 팔레트를 12단계로 재배치'],
        },
        pages: pages('design-tokens', [
          ['Design Tokens W3C 포맷 명세', 'TR.DESIGNTOKENS.ORG', 10],
          ['Radix Colors 스케일 설계 원리', 'RADIX-UI.COM', 13, 3],
          ['Primer 토큰 구조 문서', 'PRIMER.STYLE', 8],
          ['다크 모드 대비비 케이스 스터디', 'STRIPE.COM', 9, 2],
          ['토큰 네이밍 컨벤션 비교', 'BACKLIGHT.DEV', 7],
        ]),
      },
      {
        id: 'motion-guide',
        title: '모션 가이드라인 정리',
        date: '3일 전',
        minutes: 29,
        status: 'archived',
        summary: {
          overview: '이징과 지속시간을 4개 프리셋으로 축약하는 방향으로 정리했다.',
          highlights: ['진입 200ms / 퇴장 150ms 비대칭이 자연스럽게 느껴짐'],
          nextActions: ['prefers-reduced-motion 대응 추가'],
        },
        pages: pages('motion-guide', [
          ['Material Motion 지속시간 가이드', 'M3.MATERIAL.IO', 8],
          ['이징 커브 시각 비교', 'EASINGS.NET', 5, 2],
          ['접근성: 모션 축소 대응', 'WEBKIT.ORG', 6],
          ['레이아웃 트랜지션 구현 패턴', 'MOTION.DEV', 10],
        ]),
      },
    ],
  },
  {
    id: 'jeonse-loan',
    title: '전세 대출 알아보기',
    category: '금융 / 주거',
    icon: 'ph-house-line',
    hue: HUE.clay,
    sessions: [
      {
        id: 'loan-compare',
        title: '보증기관별 조건 비교',
        date: '6일 전',
        minutes: 51,
        status: 'archived',
        summary: {
          overview:
            'HUG·HF·SGI 세 기관의 보증 한도와 요건을 비교했다. 소득 조건에서 HF가 가장 유리하지만 대상 주택 면적 제한이 걸린다.',
          highlights: ['HF 보증 한도 2억 2천, 소득 7천만원 이하', 'SGI는 한도가 크지만 보증료가 2배'],
          nextActions: ['등기부등본 확인', '은행 2곳 상담 예약'],
        },
        pages: pages('loan-compare', [
          ['HUG 전세보증 상품 안내', 'KHUG.OR.KR', 12, 2],
          ['주택금융공사 전세자금보증', 'HF.GO.KR', 11, 3],
          ['SGI서울보증 요건 정리', 'SGIC.CO.KR', 7],
          ['보증료 실비 계산 사례', 'BLOG.NAVER.COM', 9],
          ['전세사기 예방 체크리스트', 'MOLIT.GO.KR', 8, 2],
        ]),
      },
      {
        id: 'rate-sim',
        title: '금리 시뮬레이션',
        date: '6일 전',
        minutes: 22,
        status: 'archived',
        summary: {
          overview: '변동금리 기준 월 상환액을 시나리오별로 계산했다.',
          highlights: ['금리 1%p 상승 시 월 부담 18만원 증가'],
          nextActions: [],
        },
        pages: pages('rate-sim', [
          ['전세대출 이자 계산기', 'FINE.FSS.OR.KR', 6, 2],
          ['은행별 우대금리 조건', 'KBSTAR.COM', 7],
          ['COFIX 금리 추이', 'KFB.OR.KR', 5],
          ['중도상환수수료 비교', 'WOORIBANK.COM', 4],
        ]),
      },
    ],
  },
  {
    id: 'running',
    title: '러닝 훈련 계획',
    category: '건강 / 운동',
    icon: 'ph-heartbeat',
    hue: HUE.teal,
    sessions: [
      {
        id: 'half-plan',
        title: '하프마라톤 16주 플랜',
        date: '어제',
        minutes: 33,
        status: 'recent',
        summary: {
          overview: '주 4회 구성으로 16주 플랜을 확정했다. 3주 증량 후 1주 감량 사이클.',
          highlights: ['롱런은 격주로 2km씩 증가', '템포런은 5주차부터 투입'],
          nextActions: ['러닝화 교체 시점 확인'],
        },
        pages: pages('half-plan', [
          ['하프마라톤 16주 훈련표', 'RUNNERSWORLD.COM', 12, 3],
          ['템포런 페이스 계산기', 'VDOTO2.COM', 6, 2],
          ['부상 없이 주행거리 늘리는 법', 'YOUTUBE.COM', 9],
          ['러닝화 수명과 교체 신호', 'BRO0KS.CO.KR', 5],
        ]),
      },
    ],
  },
  {
    id: 'side-project',
    title: '사이드 프로젝트 아이디어',
    category: '창업 / 아이디어',
    icon: 'ph-lightbulb',
    hue: HUE.plum,
    sessions: [
      {
        id: 'monetization',
        title: '수익화 사례 조사',
        date: '1주 전',
        minutes: 44,
        status: 'archived',
        summary: {
          overview: '1인 개발 SaaS 12곳의 초기 수익화 방식을 정리했다. 대부분 무료 체험 없는 단일 가격제로 시작했다.',
          highlights: ['평균 첫 유료 고객까지 5주', '가격 인상이 이탈로 이어진 사례는 소수'],
          nextActions: ['가격 실험 설계'],
        },
        pages: pages('monetization', [
          ['인디 해커 수익 공개 사례집', 'INDIEHACKERS.COM', 14, 4],
          ['SaaS 가격 책정 프레임워크', 'STRIPE.COM', 9],
          ['무료 체험 vs 환불 정책 비교', 'BAREMETRICS.COM', 8],
          ['1인 개발 런칭 회고 모음', 'NEWS.YCOMBINATOR.COM', 7, 2],
          ['결제 연동 최소 구현', 'DOCS.TOSSPAYMENTS.COM', 6],
        ]),
      },
    ],
  },
  {
    id: 'coffee',
    title: '커피 추출 레시피',
    category: '취미 / 생활',
    icon: 'ph-coffee',
    hue: HUE.amber,
    sessions: [
      {
        id: 'espresso-param',
        title: '에스프레소 파라미터 정리',
        date: '1주 전',
        minutes: 26,
        status: 'archived',
        summary: {
          overview: '18g 도징 기준 추출비 1:2.2, 27초가 현재 원두에 가장 맞았다.',
          highlights: ['분쇄도 한 단계에 추출시간 4초 변동'],
          nextActions: [],
        },
        pages: pages('espresso-param', [
          ['추출비와 수율 관계 정리', 'BARISTAHUSTLE.COM', 9, 2],
          ['원두별 권장 추출 레시피', 'FRITZCOFFEE.COM', 5],
          ['그라인더 분쇄도 캘리브레이션', 'YOUTUBE.COM', 7],
          ['TDS 측정 실전 가이드', 'BLOG.NAVER.COM', 5],
        ]),
      },
    ],
  },
  {
    id: 'career',
    title: '이직 준비',
    category: '커리어',
    icon: 'ph-briefcase',
    hue: HUE.slate,
    sessions: [
      {
        id: 'portfolio-ref',
        title: '포트폴리오 레퍼런스 수집',
        date: '4일 전',
        minutes: 62,
        status: 'archived',
        summary: {
          overview:
            '프론트엔드 포트폴리오 14개를 훑고 공통 구조를 뽑았다. 프로젝트 3개 이내 + 문제/결정/결과 서술이 반복 패턴.',
          highlights: ['성과 수치를 앞단에 배치한 사례가 회신율이 높음', '기술 나열형은 대부분 도태'],
          nextActions: ['프로젝트 2개 재작성', '케이스 스터디 초안'],
        },
        pages: pages('portfolio-ref', [
          ['프론트엔드 포트폴리오 모음', 'READ.CV', 13, 3],
          ['케이스 스터디 작성 구조', 'UXFOLIO.COM', 8],
          ['채용 담당자가 보는 순서', 'BRUNCH.CO.KR', 6, 2],
          ['이력서 성과 서술 예시', 'LEVELS.FYI', 7],
          ['깃허브 프로필 정리 팁', 'GITHUB.COM', 5],
        ]),
      },
      {
        id: 'salary-data',
        title: '연봉 데이터 조사',
        date: '4일 전',
        minutes: 19,
        status: 'archived',
        summary: {
          overview: '3~5년차 프론트엔드 기준 중위값과 분포를 확인했다.',
          highlights: ['스타트업/대기업 격차가 초봉보다 3년차 이후에 벌어짐'],
          nextActions: [],
        },
        pages: pages('salary-data', [
          ['국내 개발자 연봉 통계', 'JOBPLANET.CO.KR', 8, 2],
          ['직군별 보상 데이터', 'LEVELS.FYI', 6],
          ['스톡옵션 세금 계산', 'HOMETAX.GO.KR', 5],
        ]),
      },
    ],
  },
  {
    id: 'home-office',
    title: '홈 오피스 셋업',
    category: '홈 / 리빙',
    icon: 'ph-monitor',
    hue: HUE.olive,
    sessions: [
      {
        id: 'monitor-arm',
        title: '모니터암 비교',
        date: '1주 전',
        minutes: 27,
        status: 'archived',
        summary: {
          overview: '32인치 무게 기준으로 가스 스프링 방식 3종을 비교했다.',
          highlights: ['클램프 두께가 책상 상판 30mm를 넘기면 장착 불가'],
          nextActions: ['책상 상판 두께 실측'],
        },
        pages: pages('monitor-arm', [
          ['모니터암 하중별 추천', 'QUASARZONE.COM', 8, 2],
          ['에르고트론 LX 실사용 후기', 'YOUTUBE.COM', 6],
          ['VESA 규격 호환표', 'ERGOTRON.COM', 4],
          ['책상 상판 두께별 장착 사례', 'CLIEN.NET', 5],
        ]),
      },
    ],
  },
];

/** 트리 스크롤/필터를 실감나게 보기 위한 보조 Orbit. 세션 1개씩만 가진다. */
const FILLER: [title: string, category: string, icon: string, hue: string][] = [
  ['사진 장비 리서치', '취미 / 생활', 'ph-camera', HUE.slate],
  ['식물 키우기 기록', '홈 / 리빙', 'ph-plant', HUE.olive],
  ['가계부 2024', '금융 / 주거', 'ph-currency-circle-dollar', HUE.amber],
  ['영화 왓치리스트', '취미 / 생활', 'ph-film-slate', HUE.plum],
  ['팟캐스트 노트', '학습 / 연구', 'ph-microphone-stage', HUE.indigo],
  ['보드게임 룰 정리', '취미 / 생활', 'ph-game-controller', HUE.clay],
  ['영어 회화 학습', '학습 / 연구', 'ph-book-open', HUE.teal],
  ['자전거 정비', '건강 / 운동', 'ph-bicycle', HUE.slate],
  ['선물 아이디어', '홈 / 리빙', 'ph-gift', HUE.plum],
  ['세금 서류 정리', '금융 / 주거', 'ph-receipt', HUE.clay],
  ['글쓰기 프로젝트', '창업 / 아이디어', 'ph-pen-nib', HUE.indigo],
  ['캠핑 장비 목록', '취미 / 생활', 'ph-tent', HUE.olive],
];

FILLER.forEach(([title, category, icon, hue], i) => {
  const id = `filler-${i}`;
  ATLAS_ORBITS.push({
    id,
    title,
    category,
    icon,
    hue,
    sessions: [
      {
        id: `${id}-s0`,
        title: `${title} 탐색`,
        date: `${2 + (i % 12)}주 전`,
        minutes: 12 + ((i * 7) % 40),
        status: 'archived',
        summary: {
          overview: `${title} 관련 페이지를 모아 둔 세션입니다.`,
          highlights: [],
          nextActions: [],
        },
        pages: pages(`${id}-s0`, [
          [`${title} 개요`, 'NAVER.COM', 4 + (i % 5)],
          [`${title} 비교 정리`, 'GOOGLE.COM', 3 + (i % 4)],
          [`${title} 커뮤니티 후기`, 'REDDIT.COM', 5 + (i % 3)],
          [`${title} 참고 자료`, 'NOTION.SO', 3 + (i % 6)],
        ]),
      },
    ],
  });
});

// ── 파생 헬퍼 ────────────────────────────────────────────────────────

export const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
};

export const sessionMinutes = (session: SessionNode) => session.minutes;

export const orbitMinutes = (orbit: OrbitNode) =>
  orbit.sessions.reduce((sum, s) => sum + s.minutes, 0);

export const orbitPageCount = (orbit: OrbitNode) =>
  orbit.sessions.reduce((sum, s) => sum + s.pages.length, 0);

/** 세션 안에서 가장 많이 재방문한 페이지 — 우측 패널 인사이트에 쓴다. */
export const mostRevisitedPage = (session: SessionNode) =>
  session.pages.reduce((top, p) => (p.visits > top.visits ? p : top), session.pages[0]);

/** 세션 페이지들의 도메인 분포 (상위 n개). */
export const topDomains = (session: SessionNode, limit = 3) => {
  const counts = new Map<string, number>();
  session.pages.forEach((p) => counts.set(p.domain, (counts.get(p.domain) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
};
