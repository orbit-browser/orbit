import type { ComponentType } from 'react';
import type { WidgetId } from '../../../../lib/widget-layout';
import type { WidgetSize } from './WidgetFrame';
import { CollectionWidget, WorkspaceWidget } from './ControlWidgets';
import { RecommendWidget, TodayActivityWidget, TopDomainsWidget } from './InsightWidgets';
import {
  DashboardWidget,
  MergeWidget,
  OpenTabsWidget,
  RefreshWidget,
  SessionsWidget,
  SettingsWidget,
  TimelineWidget,
} from './NavigationWidgets';

export interface WidgetDefinition {
  size: WidgetSize;
  /** 편집 화면과 접근성 레이블에 쓰는 이름. */
  label: string;
  /** 편집 화면에서 이 위젯이 무엇인지 한 줄로 알려준다. */
  hint: string;
  Component: ComponentType;
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDefinition> = {
  collection: {
    size: 'wide',
    label: '탐색 기록 수집',
    hint: '수집 켜고 끄기',
    Component: CollectionWidget,
  },
  workspace: {
    size: 'wide',
    label: '현재 작업 공간',
    hint: '열린 탭을 세션으로 저장',
    Component: WorkspaceWidget,
  },
  openTabs: {
    size: 'wide',
    label: '열린 탭 찾기',
    hint: '열린 탭 검색과 이동',
    Component: OpenTabsWidget,
  },
  sessions: {
    size: 'wide',
    label: '저장된 세션',
    hint: '저장한 세션 목록',
    Component: SessionsWidget,
  },
  timeline: {
    size: 'wide',
    label: '탐색 타임라인',
    hint: '오늘의 방문 기록',
    Component: TimelineWidget,
  },
  recommend: {
    size: 'wide',
    label: '추천 세션',
    hint: '지금 이어가면 좋을 세션',
    Component: RecommendWidget,
  },
  topDomains: {
    size: 'wide',
    label: '최다 도메인',
    hint: '이번 주 많이 본 사이트',
    Component: TopDomainsWidget,
  },
  todayActivity: {
    size: 'full',
    label: '오늘의 탐색',
    hint: '시간대별 방문 막대',
    Component: TodayActivityWidget,
  },
  dashboard: {
    size: 'small',
    label: '대시보드',
    hint: '새 탭 아틀라스 열기',
    Component: DashboardWidget,
  },
  refresh: { size: 'small', label: '새로고침', hint: '모든 데이터 다시 불러오기', Component: RefreshWidget },
  settings: { size: 'small', label: '설정', hint: '수집·동기화·계정', Component: SettingsWidget },
  merge: {
    size: 'small',
    label: '병합 제안',
    hint: '같은 주제 세션 합치기',
    Component: MergeWidget,
  },
};
