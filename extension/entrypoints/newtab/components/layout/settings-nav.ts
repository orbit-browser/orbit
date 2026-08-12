export type SettingsPageId =
  | 'general'
  | 'collection'
  | 'session'
  | 'ai'
  | 'privacy'
  | 'data'
  | 'connection'
  | 'about';

export interface SettingsNavItem {
  id: SettingsPageId;
  label: string;
  /** lucide 아이콘 이름. 컴포넌트 매핑은 화면 쪽에서 한다. */
  icon: 'sliders' | 'download' | 'layers' | 'sparkles' | 'shield' | 'database' | 'plug' | 'info';
  /**
   * 검색어 매칭용 단어들. 라벨만으로는 "토글", "본문" 같은 실제 설정 이름으로 찾을 수 없다.
   */
  keywords: string[];
}

export interface SettingsNavGroup {
  title: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    title: '설정',
    items: [
      {
        id: 'general',
        label: '일반',
        icon: 'sliders',
        keywords: ['모양', '테마', '다크 모드', '라이트', '연결', '단축키', '버전', '앱 정보'],
      },
      {
        id: 'collection',
        label: '수집 및 동기화',
        icon: 'download',
        keywords: ['탐색 기록', '수집', '본문 저장', '민감 도메인', '자동 동기화', '유휴', '개수', '주기'],
      },
      {
        id: 'session',
        label: '세션 및 검색',
        icon: 'layers',
        keywords: ['자동 병합', '세션', '검색', '폴더'],
      },
      { id: 'ai', label: 'AI', icon: 'sparkles', keywords: ['재정렬', '요약', 'Ask', '정확한 결과'] },
      {
        id: 'privacy',
        label: '개인정보 보호',
        icon: 'shield',
        keywords: ['민감', '개인정보', '수집 범위'],
      },
    ],
  },
  {
    title: 'Orbit',
    items: [
      { id: 'data', label: '데이터 관리', icon: 'database', keywords: ['계정', '로그아웃', '삭제', '대기열'] },
      { id: 'connection', label: '연결', icon: 'plug', keywords: ['백엔드', '서버', '주소', '상태'] },
      { id: 'about', label: '정보', icon: 'info', keywords: ['버전', 'Orbit', '소개'] },
    ],
  },
];

/** 검색어와 맞는 항목만 남긴 그룹. 빈 그룹은 떨어져 나간다. */
export function filterSettingsNav(query: string): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SETTINGS_NAV;

  return SETTINGS_NAV.map((group) => ({
    title: group.title,
    items: group.items.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
    ),
  })).filter((group) => group.items.length > 0);
}
