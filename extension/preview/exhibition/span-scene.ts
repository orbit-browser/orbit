/**
 * 결선 현수막 ?variant=span 의 크롬 창 한 장 — 실제 새 탭(홈)과 사이드패널을 미리보기 대역으로 띄우고,
 * 사람이 하듯 눌러서 보여 줄 상태로 만든다. 저장소는 바꾸지 않는다(공유 창은 열기만 한다).
 *
 *   새 탭    네비게이터를 열고(폭을 사이드패널과 같게), 바로가기를 접고, AI에게 질문 모드로 QUERY 를 묻는다
 *   사이드패널  세션 탭에서 SESSION 을 펼친다. ?share=1 이면 "팀에 공유" 창까지 연다
 *
 * 끝나면 강조 표시가 붙을 요소의 자리(장면 px)를 부모에게 보낸다(SpanTargets). 실패하면 'error' 를 보낸다.
 */
import '../../entrypoints/newtab/styles/phosphor.css';

export interface SpanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SpanTargetName = 'nav' | 'search' | 'question' | 'answer' | 'source' | 'side' | 'row' | 'reopen' | 'share' | 'dialog';
export type SpanTargets = Partial<Record<SpanTargetName, SpanRect>>;

export type SpanMessage = { kind: 'orbit-span:ready'; targets: SpanTargets } | { kind: 'orbit-span:error'; message: string };

const QUERY = '제주 렌터카 비교하던 거';
const SESSION = '제주 3박 4일 여행 준비';

const params = new URLSearchParams(location.search);
const size = (key: string, fallback: number) => {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const WIDTH = size('w', 2948);
const HEIGHT = size('h', 1180);
const SIDE = size('side', 380);
const NAV = size('nav', 380);
const SHARE = params.get('share') === '1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, read: () => T | null | undefined | false, timeout = 20_000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (performance.now() - start > timeout) throw new Error(`Span scene timed out waiting for ${what}`);
    await sleep(60);
  }
}

const scene = document.getElementById('scene')!;
const newtab = document.getElementById('newtab') as HTMLIFrameElement;
const sidepanel = document.getElementById('sidepanel') as HTMLIFrameElement;
scene.style.width = `${WIDTH}px`;
scene.style.height = `${HEIGHT}px`;
(document.querySelector('.scene__side') as HTMLElement).style.width = `${SIDE}px`;

function load(frame: HTMLIFrameElement, src: string): Promise<Document> {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(frame.contentDocument!), { once: true });
    frame.src = src;
  });
}

const buttonByText = (doc: Document, text: string) =>
  [...doc.querySelectorAll('button')].find((button) => button.textContent?.trim() === text) ?? null;

/** React 가 듣는 입력 — 값 setter 를 거쳐야 onChange 가 불린다. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 네비게이터 오른쪽 끝을 끌어 폭을 맞춘다(사람이 끄는 것과 같은 포인터 이벤트). */
async function dragNavTo(doc: Document, width: number) {
  const view = doc.defaultView!;
  const drawer = await until('navigator', () => doc.querySelector<HTMLElement>('[aria-label="네비게이터"]'));
  const handle = await until('navigator resize handle', () => doc.querySelector<HTMLElement>('[aria-label="네비게이터 너비 조절"]'));
  const box = handle.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const pointer = (type: string, clientX: number) => new view.PointerEvent(type, { bubbles: true, clientX, clientY: y, pointerId: 1, isPrimary: true, button: 0 });
  handle.dispatchEvent(pointer('pointerdown', x));
  view.dispatchEvent(pointer('pointermove', x + (width - drawer.getBoundingClientRect().width)));
  view.dispatchEvent(pointer('pointerup', x));
  // 홈은 끈 폭을 다음 렌더에서야 반영한다(2026-10-23 미리보기에서 확인) — 닫았다 열어 반영시킨다
  doc.querySelector<HTMLButtonElement>('[aria-label="네비게이터 닫기"]')?.click();
  (await until('navigator toggle', () => doc.querySelector<HTMLButtonElement>('[aria-label="네비게이터 열기"]'))).click();
  await until('navigator width', () => {
    const reopened = doc.querySelector('[aria-label="네비게이터"]');
    return reopened && Math.abs(reopened.getBoundingClientRect().width - width) < 2;
  });
}

async function prepareNewTab(doc: Document) {
  const input = await until('search field', () => doc.querySelector<HTMLInputElement>('.search-field'));
  (await until('navigator toggle', () => doc.querySelector<HTMLButtonElement>('[aria-label="네비게이터 열기"]'))).click();
  await dragNavTo(doc, NAV);
  // 네비게이터에서 여행 폴더와 그 안의 SESSION 을 펼친다 — 줄의 펼치기 단추만 눌러 페이지는 옮기지 않는다
  const caret = (row: string) => until(row, () => doc.querySelector<HTMLButtonElement>(`${row} .atlas-row__caret`));
  (await caret('.atlas-row--folder[title^="여행 —"]')).click();
  (await caret(`.atlas-row--session[title^="${SESSION} —"]`)).click();
  // 바로가기 줄은 다른 회사 아이콘이라 접는다 — 제품의 접기 단추 그대로
  const shortcuts = await until('shortcuts toggle', () => doc.querySelector<HTMLButtonElement>('.shortcuts__toggle'));
  if (shortcuts.getAttribute('aria-expanded') === 'true') shortcuts.click();
  (await until('AI mode', () => buttonByText(doc, 'AI에게 질문'))).click();
  await sleep(200);
  type(input, QUERY);
  await sleep(100);
  input.form!.requestSubmit();
  await until('answer with sources', () => doc.querySelector('.ask-source') && !doc.querySelector('.ask-turn__cursor'));
}

async function prepareSidePanel(doc: Document) {
  (await until('sessions tab', () => buttonByText(doc, '세션'))).click();
  const row = await until('session row', () =>
    [...doc.querySelectorAll<HTMLElement>('button, [role="button"]')].find((element) => element.textContent?.includes(SESSION)),
  );
  row.click();
  await until('reopen buttons', () => buttonByText(doc, '새 창에서 열기'));
  if (SHARE) {
    buttonByText(doc, '팀에 공유')!.click();
    await until('share dialog', () => doc.querySelector('[role="dialog"][aria-label="팀에 공유"]'));
  }
}

/** 그림이 다 들어왔는지 — 파비콘이 늦게 오면 빈 칸으로 찍힌다. 못 받는 그림은 기다리지 않는다. */
async function imagesSettled(doc: Document) {
  await Promise.race([
    Promise.all(
      [...doc.images].map((image) =>
        image.complete ? null : new Promise((resolve) => ['load', 'error'].forEach((type) => image.addEventListener(type, resolve, { once: true }))),
      ),
    ),
    sleep(6000),
  ]);
}

/** 요소의 자리를 장면 좌표(px)로 — iframe 안이면 iframe 의 자리를 더한다. */
function rectOf(element: Element | null | undefined, frame?: HTMLIFrameElement): SpanRect | undefined {
  if (!element) return undefined;
  const base = scene.getBoundingClientRect();
  const offset = frame?.getBoundingClientRect() ?? base;
  const box = element.getBoundingClientRect();
  const dx = frame ? offset.left - base.left : -base.left;
  const dy = frame ? offset.top - base.top : -base.top;
  return { x: box.left + dx, y: box.top + dy, width: box.width, height: box.height };
}

function union(a?: SpanRect, b?: SpanRect): SpanRect | undefined {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function measure(tab: Document, side: Document): SpanTargets {
  const reopen = buttonByText(side, '새 창에서 열기');
  // 펼친 세션 한 줄 — 열기 단추에서 위로 올라가 세션 제목까지 품는 가장 가까운 상자
  let row: HTMLElement | null = reopen;
  while (row && !row.textContent?.includes(SESSION)) row = row.parentElement;
  return {
    nav: rectOf(tab.querySelector('[aria-label="네비게이터"]'), newtab),
    search: rectOf(tab.querySelector('.search-shell'), newtab),
    question: rectOf(tab.querySelector('.ask-turn__question'), newtab),
    answer: rectOf(tab.querySelector('.ask-turn__answer'), newtab),
    source: rectOf(tab.querySelector('.ask-source'), newtab),
    side: rectOf(document.querySelector('.scene__side')),
    row: rectOf(row, sidepanel),
    reopen: union(rectOf(reopen, sidepanel), rectOf(buttonByText(side, '현재 창에 열기'), sidepanel)),
    share: rectOf(buttonByText(side, '팀에 공유'), sidepanel),
    dialog: rectOf(side.querySelector('[role="dialog"][aria-label="팀에 공유"]'), sidepanel),
  };
}

function publish(message: SpanMessage) {
  // 도구(스크린샷·검사)가 장면만 열었을 때도 읽을 수 있게 남긴다
  (window as Window & { spanMessage?: SpanMessage }).spanMessage = message;
  document.documentElement.dataset.spanReady = message.kind === 'orbit-span:ready' ? '1' : 'error';
  if (parent !== window) parent.postMessage(message, location.origin);
}

try {
  const [tab, side] = await Promise.all([load(newtab, '../newtab.html?theme=light'), load(sidepanel, '../sidepanel.html?theme=light')]);
  await Promise.all([prepareNewTab(tab), prepareSidePanel(side)]);
  await Promise.all([imagesSettled(tab), imagesSettled(side), tab.fonts.ready, side.fonts.ready]);
  // 깜빡이는 입력 커서가 찍히지 않게 초점을 푼다
  for (const doc of [tab, side]) (doc.activeElement as HTMLElement | null)?.blur();
  // 답변 카드가 떠오르는 움직임(home-rise 0.45s)이 끝난 자리를 잰다
  await sleep(700);
  publish({ kind: 'orbit-span:ready', targets: measure(tab, side) });
} catch (error) {
  console.error(error);
  publish({ kind: 'orbit-span:error', message: error instanceof Error ? error.message : String(error) });
}
