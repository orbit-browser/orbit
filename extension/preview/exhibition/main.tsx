/**
 * 결선 부스 현수막 7장 미리보기 — 부스 배치대로 이어 보기, 가운데 벽, 한 장씩 확대, 간격, 안전 여백, 인쇄용 정적 모드.
 *
 * 현수막은 실제 크기의 mm 를 px 로 그린다(950 또는 455 × 2380). 화면에서는 transform 으로 줄이고,
 * 인쇄(?print=1)에서는 1px 을 1mm 로 키워 장마다 실제 크기 한 쪽으로 낸다. 보기 옵션은 주소에 남는다.
 */
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { BOOTH, PANELS, WALLS, type PanelDef } from './booth';
import { GALLERY_SESSION_IDS } from './content';
import { EdgeBanner } from './panel-edge';
import { ChaosBanner } from './panel-chaos';
import { OrbitBanner } from './panel-orbit';
import { TeamBanner } from './panel-team';
import { TechBanner } from './panel-tech';
import { UseBanner } from './panel-use';
import '../../entrypoints/newtab/styles/phosphor.css';
import './exhibition.css';

type View = 'booth' | 'center' | `${number}`;
type Zoom = 'fit' | '0.25' | '0.5' | '1' | 'actual';

interface Options {
  view: View;
  zoom: Zoom;
  /** 같은 벽 안 현수막 사이(벽 기둥, mm) */
  gap: number;
  safe: boolean;
  motion: boolean;
  /** 인쇄용 정적 모드: 움직임·조작을 끄고 출력될 한 프레임만 */
  still: boolean;
  session: number;
  page: number;
}

const MM_PX = 96 / 25.4;
const VIEWS: [View, string][] = [['booth', '부스 7장'], ['center', '가운데 벽'], ...PANELS.map((_, index): [View, string] => [`${index + 1}`, `${index + 1}`])];
const ZOOMS: [Zoom, string][] = [['fit', '화면 맞춤'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['actual', '실제 크기']];
/** 부스 보기에서 벽 이름이 앉는 높이(mm) */
const WALL_LABEL = 90;

const params = new URLSearchParams(location.search);
const flag = (key: string, fallback: boolean) => (params.has(key) ? params.get(key) !== '0' : fallback);
const int = (key: string, fallback: number, max: number) => {
  const value = Number.parseInt(params.get(key) ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
};

const initial: Options = {
  view: (VIEWS.find(([value]) => value === params.get('view'))?.[0] ?? 'booth') as View,
  zoom: (ZOOMS.find(([value]) => value === params.get('zoom'))?.[0] ?? 'fit') as Zoom,
  gap: int('gap', BOOTH.post, 400),
  safe: flag('safe', false),
  motion: flag('motion', true),
  still: flag('still', false),
  session: int('session', 0, GALLERY_SESSION_IDS.length - 1),
  page: int('page', 2, 50),
};

function toQuery(options: Options): string {
  const query = new URLSearchParams();
  if (options.view !== 'booth') query.set('view', options.view);
  if (options.zoom !== 'fit') query.set('zoom', options.zoom);
  if (options.gap !== BOOTH.post) query.set('gap', String(options.gap));
  if (options.safe) query.set('safe', '1');
  if (!options.motion) query.set('motion', '0');
  if (options.still) query.set('still', '1');
  if (options.session !== 0) query.set('session', String(options.session));
  query.set('page', String(options.page));
  return query.toString();
}

/** 보기마다 나오는 장(부스 순서) */
function panelsFor(view: View): PanelDef[] {
  if (view === 'booth') return PANELS;
  if (view === 'center') return PANELS.filter((panel) => panel.wall === 'center');
  return [PANELS[Number(view) - 1]].filter(Boolean);
}

interface PanelProps {
  panel: PanelDef;
  options: Options;
  set: (patch: Partial<Options>) => void;
  interactive: boolean;
  /** 화면 축소 비율 — 갤러리가 끈 거리를 mm 로 바꾼다 */
  scaleRef: RefObject<number>;
}

function Panel({ panel, options, set, interactive, scaleRef }: PanelProps) {
  switch (panel.id) {
    case 'edge-left':
      return <EdgeBanner side="left" />;
    case 'use':
      return <UseBanner />;
    case 'chaos':
      return <ChaosBanner />;
    case 'orbit':
      return (
        <OrbitBanner
          sessionIndex={options.session}
          pageIndex={options.page}
          onSession={(session) => set({ session, page: 0 })}
          onPage={(page) => set({ page })}
          interactive={interactive}
          scaleRef={scaleRef}
        />
      );
    case 'tech':
      return <TechBanner />;
    case 'team':
      return <TeamBanner />;
    case 'edge-right':
      return <EdgeBanner side="right" />;
  }
}

const rowWidth = (panels: PanelDef[], gap: number) => panels.reduce((sum, panel) => sum + panel.width, 0) + Math.max(0, panels.length - 1) * gap;

function Viewer() {
  const [options, setOptions] = useState(initial);
  const set = (patch: Partial<Options>) => setOptions((current) => ({ ...current, ...patch }));
  const viewportRef = useRef<HTMLElement>(null);
  const [room, setRoom] = useState({ width: 1200, height: 800 });
  const scaleRef = useRef(1);

  useEffect(() => {
    history.replaceState(null, '', `?${toQuery(options)}`);
  }, [options]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setRoom({ width: viewport.clientWidth, height: viewport.clientHeight }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const panels = panelsFor(options.view);
  const booth = options.view === 'booth';
  const walls = WALLS.map((wall) => ({ ...wall, panels: PANELS.filter((panel) => panel.wall === wall.wall) }));
  const contentWidth = booth
    ? walls.reduce((sum, wall) => sum + rowWidth(wall.panels, options.gap), 0) + (walls.length - 1) * BOOTH.corner
    : rowWidth(panels, options.gap);
  const contentHeight = BOOTH.height + (booth ? WALL_LABEL : 0);
  const pad = 40;
  const scale =
    options.zoom === 'fit'
      ? Math.min((room.width - pad * 2) / contentWidth, (room.height - pad * 2) / contentHeight)
      : options.zoom === 'actual'
        ? MM_PX
        : Number(options.zoom);
  scaleRef.current = scale;

  const printPanels = panels.map((panel) => PANELS.indexOf(panel) + 1).join(',');
  const printHref = `?print=1&panel=${booth ? 'all' : printPanels}&session=${options.session}&page=${options.page}`;
  const interactive = !options.still;
  const render = (panel: PanelDef) => <Panel key={panel.id} panel={panel} options={options} set={set} interactive={interactive} scaleRef={scaleRef} />;

  return (
    <div className={`ex-app${options.safe ? ' ex-safe-on' : ''}${options.motion && !options.still ? ' ex-motion-on' : ''}${options.still ? ' ex-still' : ''}`}>
      <header className="ex-toolbar">
        <div className="ex-toolbar__title">
          <strong>Orbit 결선 부스 현수막</strong>
          <span>족자 7장 · 950 × 2,380mm 5장 + 455 × 2,380mm 2장</span>
        </div>
        <Segment label="보기" items={VIEWS} value={options.view} onChange={(view) => set({ view })} titles={['', '', ...PANELS.map((panel) => panel.label)]} />
        <Segment label="크기" items={ZOOMS} value={options.zoom} onChange={(zoom) => set({ zoom })} />
        <label className="ex-range">
          <span>기둥</span>
          <input type="range" min={0} max={200} step={10} value={options.gap} onChange={(event) => set({ gap: Number(event.target.value) })} />
          <output>{options.gap}mm</output>
        </label>
        <Toggle label="안전 여백" value={options.safe} onChange={(safe) => set({ safe })} />
        <Toggle label="애니메이션" value={options.motion} onChange={(motion) => set({ motion })} disabled={options.still} />
        <Toggle label="인쇄용 정적 모드" value={options.still} onChange={(still) => set({ still })} />
        <a className="ex-toolbar__print" href={printHref} target="_blank" rel="noreferrer">
          인쇄용 화면 열기
        </a>
      </header>
      <main className="ex-viewport" ref={viewportRef}>
        <div className="ex-canvas" style={{ width: contentWidth * scale + pad * 2, height: contentHeight * scale + pad * 2 }}>
          <div className="ex-board" style={{ transform: `scale(${scale})`, gap: booth ? BOOTH.corner : options.gap, left: pad, top: pad }}>
            {booth
              ? walls.map((wall) => (
                  <section key={wall.wall} className="ex-wall" aria-label={wall.label}>
                    <span className="ex-wall__label">
                      {wall.label} · {wall.panels.map((panel) => panel.width).join(' + ')}mm
                    </span>
                    <div className="ex-wall__row" style={{ gap: options.gap }}>
                      {wall.panels.map(render)}
                    </div>
                  </section>
                ))
              : panels.map(render)}
          </div>
        </div>
      </main>
    </div>
  );
}

function Segment<T extends string>({ label, items, value, onChange, titles }: { label: string; items: [T, string][]; value: T; onChange: (value: T) => void; titles?: string[] }) {
  return (
    <div className="ex-seg" role="group" aria-label={label}>
      <span>{label}</span>
      {items.map(([item, text], index) => (
        <button key={item} type="button" aria-pressed={item === value} title={titles?.[index] || undefined} onClick={() => onChange(item)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ex-toggle">
      <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** 인쇄·내보내기 — 현수막만, 한 장이 한 쪽(실제 크기). panel=all | 4 | 1,7. export.mjs 가 이 화면을 찍는다. */
function PrintSheet() {
  const panel = params.get('panel') ?? 'all';
  const picked = panel === 'all' ? PANELS : panel.split(',').map((value) => PANELS[Number(value) - 1]).filter(Boolean);
  const scaleRef = useRef(1);
  return (
    <div className="ex-print">
      {picked.map((def) => (
        <div className={`ex-print__page${def.width === 455 ? ' ex-print__page--narrow' : ''}`} key={def.id}>
          <Panel panel={def} options={initial} set={() => {}} interactive={false} scaleRef={scaleRef} />
        </div>
      ))}
    </div>
  );
}

/**
 * 현수막 글꼴(Google Fonts)을 직접 불러 본다 — 오프라인이면 시스템 글꼴로 바뀌어 글줄이 달라진다.
 * 글꼴은 쓰일 때만 받히므로(한글이 없는 장은 한글 글꼴을 안 받는다) 상태만 보지 않고 load 로 확인한다.
 */
async function fontsMissing(): Promise<string[]> {
  const probes: [string, string, string][] = [
    ['Inter', '640 40px Inter', 'Orbit'],
    ['Noto Sans KR', '700 40px "Noto Sans KR"', '기억'],
    ['JetBrains Mono', '500 40px "JetBrains Mono"', 'ORBIT'],
  ];
  const loaded = await Promise.all(probes.map(([, font, text]) => document.fonts.load(font, text).catch(() => [])));
  return probes.filter((_, index) => loaded[index].length === 0).map(([family]) => family);
}

/** 글꼴과 이미지가 다 들어온 뒤 표시 — 내보내기 스크립트와 검증이 이 표시를 기다린다. */
async function markReady() {
  const missing = await fontsMissing();
  await document.fonts.ready;
  if (missing.length > 0) {
    // 성공처럼 숨기지 않는다: 인쇄 화면 맨 위에도 찍혀 나오게 한다
    const warning = document.createElement('div');
    warning.className = 'ex-font-warning';
    warning.setAttribute('role', 'alert');
    warning.textContent = `글꼴을 불러오지 못했습니다(${missing.join(', ')}). 인터넷 연결을 확인하고 다시 여세요 — 이대로 인쇄하면 글줄이 달라집니다.`;
    document.body.prepend(warning);
    console.error(`Exhibition fonts missing: ${missing.join(', ')}`);
  }
  await Promise.all(
    [...document.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
    ),
  );
  document.documentElement.dataset.ready = '1';
}

createRoot(document.getElementById('root')!).render(<StrictMode>{params.get('print') === '1' ? <PrintSheet /> : <Viewer />}</StrictMode>);
requestAnimationFrame(() => setTimeout(markReady, 0));
