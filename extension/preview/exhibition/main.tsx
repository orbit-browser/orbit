/**
 * 결선 전시 현수막 3장 미리보기 — 나란히 보기, 한 장씩 확대, 간격, 안전 여백, 인쇄용 정적 모드.
 *
 * 현수막은 실제 크기의 mm 를 px 로 그린다(950 × 2380). 화면에서는 transform 으로 줄이고,
 * 인쇄(?print=1)에서는 1px 을 1mm 로 키운다. 모든 보기 옵션은 주소에 남아 같은 화면을 다시 열 수 있다.
 */
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { GALLERY_SESSION_IDS, loadShots, setShotsVisible } from './content';
import { BANNER } from './frame';
import { ChaosBanner } from './panel-chaos';
import { OrbitBanner } from './panel-orbit';
import { TechBanner } from './panel-tech';
import '../../entrypoints/newtab/styles/phosphor.css';
import './exhibition.css';

type View = 'all' | '1' | '2' | '3';
type Zoom = 'fit' | '0.25' | '0.5' | '1' | 'actual';

interface Options {
  view: View;
  zoom: Zoom;
  /** 현수막 사이 간격(mm) — 부스 기둥 폭을 넣어 본다 */
  gap: number;
  safe: boolean;
  motion: boolean;
  /** 인쇄용 정적 모드: 움직임·조작을 끄고 출력될 한 프레임만 */
  still: boolean;
  shots: boolean;
  session: number;
  page: number;
}

const MM_PX = 96 / 25.4;
const VIEWS: [View, string][] = [['all', '세 장'], ['1', '1'], ['2', '2'], ['3', '3']];
const ZOOMS: [Zoom, string][] = [['fit', '화면 맞춤'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['actual', '실제 크기']];

const params = new URLSearchParams(location.search);
const flag = (key: string, fallback: boolean) => (params.has(key) ? params.get(key) !== '0' : fallback);
const int = (key: string, fallback: number, max: number) => {
  const value = Number.parseInt(params.get(key) ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
};

const initial: Options = {
  view: (VIEWS.find(([value]) => value === params.get('view'))?.[0] ?? 'all') as View,
  zoom: (ZOOMS.find(([value]) => value === params.get('zoom'))?.[0] ?? 'fit') as Zoom,
  gap: int('gap', 50, 400),
  safe: flag('safe', false),
  motion: flag('motion', true),
  still: flag('still', false),
  shots: flag('shots', true),
  session: int('session', 0, GALLERY_SESSION_IDS.length - 1),
  page: int('page', 2, 50),
};

function toQuery(options: Options): string {
  const query = new URLSearchParams();
  if (options.view !== 'all') query.set('view', options.view);
  if (options.zoom !== 'fit') query.set('zoom', options.zoom);
  if (options.gap !== 50) query.set('gap', String(options.gap));
  if (options.safe) query.set('safe', '1');
  if (!options.motion) query.set('motion', '0');
  if (options.still) query.set('still', '1');
  if (!options.shots) query.set('shots', '0');
  if (options.session !== 0) query.set('session', String(options.session));
  query.set('page', String(options.page));
  return query.toString();
}

interface BannersProps {
  options: Options;
  set: (patch: Partial<Options>) => void;
  panels: number[];
  interactive: boolean;
  /** 화면 축소 비율 — 갤러리가 끈 거리를 mm 로 바꾼다 */
  scaleRef: RefObject<number>;
}

function Banners({ options, set, panels, interactive, scaleRef }: BannersProps) {
  return panels.map((panel) =>
    panel === 1 ? (
      <ChaosBanner key={panel} />
    ) : panel === 2 ? (
      <OrbitBanner
        key={panel}
        sessionIndex={options.session}
        pageIndex={options.page}
        onSession={(session) => set({ session, page: 0 })}
        onPage={(page) => set({ page })}
        interactive={interactive}
        scaleRef={scaleRef}
      />
    ) : (
      <TechBanner key={panel} />
    ),
  );
}

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

  const panels = options.view === 'all' ? [1, 2, 3] : [Number(options.view)];
  const contentWidth = panels.length * BANNER.width + (panels.length - 1) * options.gap;
  const pad = 40;
  const scale =
    options.zoom === 'fit'
      ? Math.min((room.width - pad * 2) / contentWidth, (room.height - pad * 2) / BANNER.height)
      : options.zoom === 'actual'
        ? MM_PX
        : Number(options.zoom);
  scaleRef.current = scale;
  setShotsVisible(options.shots);

  const printHref = `?print=1&panel=${options.view === 'all' ? 'all' : options.view}&session=${options.session}&page=${options.page}${options.shots ? '' : '&shots=0'}`;

  return (
    <div className={`ex-app${options.safe ? ' ex-safe-on' : ''}${options.motion && !options.still ? ' ex-motion-on' : ''}${options.still ? ' ex-still' : ''}`}>
      <header className="ex-toolbar">
        <div className="ex-toolbar__title">
          <strong>Orbit 결선 전시 현수막</strong>
          <span>950 × 2,380mm · 3장 · 전체 {(3 * BANNER.width + 2 * options.gap).toLocaleString()} × 2,380mm</span>
        </div>
        <Segment label="보기" items={VIEWS} value={options.view} onChange={(view) => set({ view })} />
        <Segment label="크기" items={ZOOMS} value={options.zoom} onChange={(zoom) => set({ zoom })} />
        <label className="ex-range">
          <span>간격</span>
          <input type="range" min={0} max={300} step={10} value={options.gap} onChange={(event) => set({ gap: Number(event.target.value) })} />
          <output>{options.gap}mm</output>
        </label>
        <Toggle label="안전 여백" value={options.safe} onChange={(safe) => set({ safe })} />
        <Toggle label="애니메이션" value={options.motion} onChange={(motion) => set({ motion })} disabled={options.still} />
        <Toggle label="인쇄용 정적 모드" value={options.still} onChange={(still) => set({ still })} />
        <Toggle label="페이지 화면" value={options.shots} onChange={(shots) => set({ shots })} />
        <a className="ex-toolbar__print" href={printHref} target="_blank" rel="noreferrer">
          인쇄용 화면 열기
        </a>
      </header>
      <main className="ex-viewport" ref={viewportRef}>
        <div className="ex-canvas" style={{ width: contentWidth * scale + pad * 2, height: BANNER.height * scale + pad * 2 }}>
          <div className="ex-board" style={{ transform: `scale(${scale})`, gap: options.gap, left: pad, top: pad }}>
            <Banners options={options} set={set} panels={panels} interactive={!options.still} scaleRef={scaleRef} />
          </div>
        </div>
      </main>
    </div>
  );
}

function Segment<T extends string>({ label, items, value, onChange }: { label: string; items: [T, string][]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="ex-seg" role="group" aria-label={label}>
      <span>{label}</span>
      {items.map(([item, text]) => (
        <button key={item} type="button" aria-pressed={item === value} onClick={() => onChange(item)}>
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

/** 인쇄·내보내기 — 현수막만, 한 장이 한 쪽(950 × 2380mm). export.mjs 가 이 화면을 찍는다. */
function PrintSheet() {
  const panel = params.get('panel') ?? 'all';
  // panel=all | 2 | 1,3
  const panels = panel === 'all' ? [1, 2, 3] : panel.split(',').map(Number).filter((value) => value >= 1 && value <= 3);
  const scaleRef = useRef(1);
  setShotsVisible(flag('shots', true));
  return (
    <div className="ex-print">
      {panels.map((value) => (
        <div className="ex-print__page" key={value}>
          <Banners options={initial} set={() => {}} panels={[value]} interactive={false} scaleRef={scaleRef} />
        </div>
      ))}
    </div>
  );
}

/** 현수막 글꼴(Google Fonts)이 실제로 들어왔는지 — 오프라인이면 시스템 글꼴로 바뀌어 글줄이 달라진다. */
function fontsMissing(): string[] {
  const loaded = new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')));
  return ['Inter', 'Noto Sans KR', 'JetBrains Mono'].filter((family) => !loaded.has(family));
}

/** 글꼴과 이미지가 다 들어온 뒤 표시 — 내보내기 스크립트와 검증이 이 표시를 기다린다. */
async function markReady() {
  await document.fonts.ready;
  const missing = fontsMissing();
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

await loadShots();
createRoot(document.getElementById('root')!).render(<StrictMode>{params.get('print') === '1' ? <PrintSheet /> : <Viewer />}</StrictMode>);
requestAnimationFrame(() => setTimeout(markReady, 0));
