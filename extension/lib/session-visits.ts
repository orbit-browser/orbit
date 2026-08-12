import type { SessionTimelineEvent, TabItem } from './types';

export interface TabWithVisit {
  tab: TabItem;
  /** ISO 8601 — 이 페이지를 처음 본 시각. 이벤트가 없으면 null. */
  firstVisitAt: string | null;
  /** 방문 횟수. 이벤트가 없으면 0. */
  visits: number;
}

/**
 * 세션의 탭 목록에 방문 시각을 붙이고 시간순으로 세운다.
 *
 * 방문 이벤트를 그대로 나열하면 같은 페이지를 세 번 본 세션이 세 줄이 된다 — 목록이 길어지고
 * "무엇을 봤나"가 흐려진다. 그래서 페이지 단위(탭)를 유지한 채 **처음 본 시각**과 **방문 횟수**만
 * 얹는다. 흐름은 순서가, 반복은 횟수가 나른다.
 *
 * 정렬은 오름차순 — 세션 안에서는 "어떻게 시작해서 어디로 갔나"가 읽혀야 한다.
 * 이벤트가 없는 탭(옛 스냅샷 세션, 조회 실패)은 원래 순서를 지키며 뒤에 붙인다.
 */
export function attachVisits(
  tabs: TabItem[],
  events: SessionTimelineEvent[],
): TabWithVisit[] {
  const byUrl = new Map<string, { firstVisitAt: string; visits: number }>();
  for (const event of events) {
    const found = byUrl.get(event.url);
    if (!found) {
      byUrl.set(event.url, { firstVisitAt: event.visitedAt, visits: 1 });
      continue;
    }
    found.visits += 1;
    if (event.visitedAt < found.firstVisitAt) found.firstVisitAt = event.visitedAt;
  }

  const withVisit: TabWithVisit[] = tabs.map((tab) => {
    const found = byUrl.get(tab.url);
    return {
      tab,
      firstVisitAt: found?.firstVisitAt ?? null,
      visits: found?.visits ?? 0,
    };
  });

  const timed = withVisit
    .filter((item) => item.firstVisitAt !== null)
    .sort((a, b) => (a.firstVisitAt as string).localeCompare(b.firstVisitAt as string));
  const untimed = withVisit.filter((item) => item.firstVisitAt === null);

  return [...timed, ...untimed];
}
