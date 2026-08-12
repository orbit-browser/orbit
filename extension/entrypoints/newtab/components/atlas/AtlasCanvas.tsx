import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { OrbitScene, OrbitTrack } from './data';
import {
  alignOffset,
  formatMinutes,
  normalizeRotation,
  ORBIT_EDGE_HINTS,
  ORBIT_RING_HINTS,
  ORBIT_RING_REACH,
  ORBIT_RING_SIDE,
  orbitPlacement,
  ringPlacement,
} from './data';

const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

const HINT_STORAGE_KEY = 'orbit.atlas.hint-dismissed';
/** 궤도 타원의 세로/가로 비 — 위에서 비스듬히 내려다본 느낌 */
const RATIO = 0.8;
const PLANET_Y_MIN = 118;
const PLANET_R = 19;
/** 레이블 칩이 차지하는 세로 여백 */
const LABEL_GUTTER = 34;
const CHIP_H = 30;
const INSET_MAX = 250;
const R_ABS_MAX = 460;

/** 가장 안쪽 궤도의 최소 반경 — 중심 노드와 그 아래 제목을 피한다. */
const R_INNER_MIN = 132;

/** 이웃 칩까지 나란히 보여 줄 최소 세로 간격. 이보다 좁으면 초점 칩만 남긴다. */
const CHIP_ROOM = CHIP_H + 16;

/**
 * 칩을 자기 궤도 아래로 내리는 거리.
 *
 * 초점 궤도는 최하단이 선택된 페이지(위성) 자리라 그만큼 비워야 하는데, 그 값을
 * 초점에만 주면 **초점 바로 아래 칩과의 간격만 그만큼 좁아진다**. 모든 칩에 같은 값을
 * 줘서 간격을 고르게 유지한다.
 */
const CHIP_DROP = 22;

/**
 * 회전 보간의 시간 상수(ms). 지수 감쇠라 이 값의 3배쯤에서 사실상 도착한다.
 * 프레임 간격으로 감쇠를 계산하므로 60fps 가 아니어도 같은 시간에 멈춘다.
 */
const SPIN_TAU = 105;

/** 이보다 가까우면 목표에 붙여 놓고 루프를 멈춘다. */
const SPIN_EPSILON = 0.002;

/** 씬이 통째로 바뀔 때 옅어졌다 짙어지는 한쪽 구간의 길이(ms). CSS 전이와 맞춘다. */
const SCENE_FADE_MS = 180;

/** 프레임 단위로 목표를 향해 미끄러지는 값. */
interface Motion {
  value: number;
  target: number;
}

/** 한 프레임만큼 나아간다. 아직 움직이는 중이면 true. */
function advance(motion: Motion, dt: number): boolean {
  const diff = motion.target - motion.value;
  if (Math.abs(diff) < SPIN_EPSILON) {
    motion.value = motion.target;
    return false;
  }
  motion.value += diff * (1 - Math.exp(-dt / SPIN_TAU));
  return true;
}

const readHintDismissed = () => {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const pointOnArc = (rx: number, ry: number, angleDeg: number) => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: -rx * Math.cos(radians), y: ry * Math.sin(radians) };
};

/**
 * 궤도선 농도 — 초점이 가장 진하고, 초점에서 멀어질수록 옅어진다.
 *
 * 온전한 구간 밖(흐린 궤도)은 "여기 밖에 더 있다"는 신호라 거의 사라질 때까지 떨어진다.
 * beyond 가 연속값이라 초점이 미끄러지는 동안 농도도 끊김 없이 따라간다.
 */
const arcOpacity = (offset: number, beyond: number) => {
  // 초점에 얼마나 가까운지(1칸 안쪽에서만 오른다)
  const near = Math.max(0, 1 - Math.abs(offset));
  // 흐린 구간의 잔광 — 그리기를 멈추는 지점에서 정확히 0 이 된다
  const tail = Math.max(0, 1 - beyond / ORBIT_RING_HINTS);
  return (0.42 + 0.5 * near) * tail;
};

interface AtlasCanvasProps {
  scene: OrbitScene | null;
  /** 폴더 씬에서 지금 펼쳐 놓은 세션. 이 궤도의 페이지만 위성으로 그린다. */
  activeTrackId: string | null;
  selectedPointId: string | null;
  onSelectPoint: (pointId: string, sessionId: string | null) => void;
  /** 폴더 씬에서 궤도(=세션)를 펼칠 때. 세션 씬에서는 호출되지 않는다. */
  onSelectTrack: (sessionId: string) => void;
  onClearSelection: () => void;
  bottomInset: number;
  emptyMessage?: string;
}

export function AtlasCanvas({
  scene: nextScene,
  activeTrackId,
  selectedPointId,
  onSelectPoint,
  onSelectTrack,
  onClearSelection,
  bottomInset,
  emptyMessage,
}: AtlasCanvasProps) {
  /*
   * 씬이 통째로 바뀔 때(폴더 → 세션)는 그리는 씬을 한 박자 늦춘다.
   *
   * 중심 노드·궤도·칩·위성이 전부 다른 것으로 갈리는 전환이라 같은 프레임에 갈아 끼우면
   * 계단처럼 튄다. 먼저 옅어지게 두고(`leaving`), 보이지 않는 사이에 바꾼 뒤 다시 짙어진다.
   * 같은 씬의 데이터 갱신(제목 변경·재조회)은 지연 없이 그대로 반영한다.
   */
  const [scene, setScene] = useState(nextScene);
  const [leaving, setLeaving] = useState(false);
  const latestSceneRef = useRef(nextScene);
  latestSceneRef.current = nextScene;
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (nextScene?.id === scene?.id) {
      setScene(nextScene);
      return;
    }
    setLeaving(true);
    /*
     * 전환 중에 또 바뀌어도 타이머를 다시 걸지 않는다 — 다시 걸면 화살표를 누르고 있는
     * 동안 교체가 계속 미뤄져 화면이 흐린 채로 남는다. 예약된 교체가 그때의 마지막 씬을
     * 집어 간다.
     */
    if (fadeTimerRef.current) return;
    fadeTimerRef.current = setTimeout(() => {
      fadeTimerRef.current = null;
      setScene(latestSceneRef.current);
      setLeaving(false);
    }, SCENE_FADE_MS);
  }, [nextScene, scene?.id]);

  useEffect(
    () => () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    },
    [],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 620 });
  const [hintClosed, setHintClosed] = useState(false);
  const [hintMuted, setHintMuted] = useState(readHintDismissed);
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);

  /**
   * 궤도별 회전량. value 는 지금 그려야 할 값, target 은 도착점이다.
   *
   * 점을 left/top 전이로 옮기면 두 점을 잇는 **현**을 따라가 궤도를 벗어난다.
   * 회전량만 보간하고 좌표는 매 프레임 다시 계산해 실제로 호를 따라 돌게 한다.
   * 상태가 아니라 ref 에 두는 이유는 프레임마다 갱신되는 값이라서다 —
   * 상태 갱신 함수 안에서 애니메이션을 이어갈지 판단하면 StrictMode 이중 호출에
   * 걸린다.
   */
  const spinRef = useRef(new Map<string, Motion>());
  /**
   * 지금 초점에 놓인 궤도의 연속 위치. 정수 자리의 궤도가 고정 반경에 온다.
   *
   * 세션을 옮기면 이 값이 미끄러지고, 궤도와 칩이 그 차이만큼 안팎으로 흘러간다 —
   * 탭이 넘어가는 느낌이 여기서 나온다.
   */
  const focusRef = useRef<Motion>({ value: 0, target: 0 });
  /**
   * 아래 트레이가 차지하는 높이. 계 전체의 세로 위치가 여기서 나온다.
   *
   * 세션을 펼치면 트레이가 뜨면서 이 값이 40 → 250 으로 한 번에 뛴다. 그대로 쓰면 행성과
   * 궤도가 같은 프레임에 위로 순간이동한다 — 값을 미끄러뜨려 계가 함께 올라가게 한다.
   */
  const insetRef = useRef<Motion>({ value: bottomInset, target: bottomInset });
  const frameRef = useRef<number | null>(null);
  const [, drawFrame] = useReducer((tick: number) => tick + 1, 0);

  const runSpin = useCallback(() => {
    if (frameRef.current !== null) return;
    let previous = performance.now();

    const step = (now: number) => {
      // 탭이 잠들었다 깨면 dt 가 커진다 — 한 프레임에 건너뛰지 않도록 자른다.
      const dt = Math.min(64, Math.max(1, now - previous));
      previous = now;

      let moving = advance(focusRef.current, dt);
      if (advance(insetRef.current, dt)) moving = true;
      spinRef.current.forEach((spin) => {
        if (advance(spin, dt)) moving = true;
      });

      drawFrame();
      frameRef.current = moving ? requestAnimationFrame(step) : null;
    };

    frameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const spinValue = (trackId: string) => spinRef.current.get(trackId)?.value ?? 0;

  /** 목표 회전량을 옮긴다. 처음 보는 궤도는 애니메이션 없이 그 자리에 놓는다. */
  const spinTo = useCallback(
    (trackId: string, target: number) => {
      const spin = spinRef.current.get(trackId);
      if (!spin) {
        spinRef.current.set(trackId, { value: target, target });
        return;
      }
      if (spin.target === target) return;
      spin.target = target;
      runSpin();
    },
    [runSpin],
  );

  /*
   * 안내 알약은 평소 가운데 정렬(translateX(-50%))이라 폭이 늘면 X 가 옆으로 밀린다.
   * X 를 겨눈 커서 아래로 "다시 보지 않기" 가 들어와 클릭이 그쪽으로 먹는다.
   * 그래서 커서를 올린 **그 순간의 실제 위치를 재서 고정**하고, 문구는 오른쪽으로만 펼친다.
   * CSS 만으로 폭을 보정하려면 문구 길이를 상수로 박아야 해서 글자가 바뀌면 어긋난다.
   */
  const hintRef = useRef<HTMLDivElement>(null);
  const [hintFrozenLeft, setHintFrozenLeft] = useState<number | null>(null);
  /** 등장 애니메이션은 처음 한 번만 — 이후 클래스가 바뀌어도 다시 올라오지 않는다. */
  const [hintEntered, setHintEntered] = useState(false);

  const unfreezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const freezeHint = () => {
    if (unfreezeTimer.current) {
      clearTimeout(unfreezeTimer.current);
      unfreezeTimer.current = null;
    }
    const stage = stageRef.current;
    const hint = hintRef.current;
    if (!stage || !hint || hintFrozenLeft !== null) return;
    // 스테이지 기준 좌표로 바꿔 둬야 창 크기가 바뀌어도 어긋나지 않는다.
    setHintFrozenLeft(hint.getBoundingClientRect().left - stage.getBoundingClientRect().left);
  };

  /**
   * 문구가 다 접힌 뒤에 고정을 푼다.
   * 즉시 풀면 알약이 먼저 가운데로 돌아간 뒤 폭이 줄어들어, 왼쪽에서 미끄러져 오는 것처럼 보인다.
   */
  const releaseHint = () => {
    if (unfreezeTimer.current) clearTimeout(unfreezeTimer.current);
    unfreezeTimer.current = setTimeout(() => {
      setHintFrozenLeft(null);
      unfreezeTimer.current = null;
    }, 300); // 문구 접힘 전환(0.26s)보다 살짝 길게
  };

  useEffect(() => () => {
    if (unfreezeTimer.current) clearTimeout(unfreezeTimer.current);
  }, []);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(320, width), h: Math.max(320, height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sceneId = scene?.id ?? null;
  useEffect(() => {
    spinRef.current.clear();
    focusRef.current = { value: 0, target: 0 };
  }, [sceneId]);

  const tracks = scene?.tracks ?? [];
  const isFolder = scene?.kind === 'folder';

  /** 초점에 두어야 할 궤도 — 폴더 씬에서 펼친 세션. 없으면 첫 궤도다. */
  const focusIndex = Math.max(
    0,
    tracks.findIndex((track) => track.id === activeTrackId),
  );

  /** 초점을 새 궤도로 미끄러뜨린다. 처음 그릴 때는 애니메이션 없이 제자리에서 시작한다. */
  useEffect(() => {
    if (focusRef.current.target === focusIndex) return;
    focusRef.current.target = focusIndex;
    runSpin();
  }, [focusIndex, runSpin]);

  const focusValue = focusRef.current.value;

  useEffect(() => {
    if (insetRef.current.target === bottomInset) return;
    insetRef.current.target = bottomInset;
    runSpin();
  }, [bottomInset, runSpin]);

  const inset = insetRef.current.value;

  /**
   * 방금 닫힌 궤도. 초점이 미끄러지는 동안만 붙잡아 둔다.
   *
   * 이걸 두지 않으면 세션을 옮길 때 이전 페이지들이 그 자리에서 사라지고 새 페이지가
   * 제자리에 나타난다 — "짠" 하고 바뀌는 게 그거다. 나가는 궤도는 초점에서 멀어지며
   * 옅어지고, 들어오는 궤도는 다가오며 짙어져 서로 교차한다.
   */
  const [leavingTrackId, setLeavingTrackId] = useState<string | null>(null);
  const openedTrackRef = useRef<string | null>(activeTrackId);
  useEffect(() => {
    const previous = openedTrackRef.current;
    openedTrackRef.current = activeTrackId;
    if (!previous || previous === activeTrackId) return;
    setLeavingTrackId(previous);
    const timer = setTimeout(() => setLeavingTrackId(null), SPIN_TAU * 4);
    return () => clearTimeout(timer);
  }, [activeTrackId]);


  /**
   * 폴더 씬에서 점을 그리는 궤도는 펼쳐 놓은 세션 하나뿐이다.
   * 궤도마다 점을 다 뿌리면 세션 5개 x 페이지 30개에서 150개가 겹쳐 누를 수 없다.
   */
  const isOpenTrack = (track: OrbitTrack) => !isFolder || track.id === activeTrackId;

  /** 지금 최하단에 놓인 점의 인덱스. 아직 아무것도 고르지 않았을 때의 기준점이다. */
  const bottomIndex = (track: OrbitTrack) =>
    normalizeRotation(Math.round(spinRef.current.get(track.id)?.target ?? 0), track.points.length);

  /**
   * 선택된 페이지는 언제나 궤도 최하단에 온다 — 선택이 곧 회전이다.
   *
   * 선택이 없는 궤도는 첫 페이지를 최하단에 두고 가만히 둔다.
   */
  useEffect(() => {
    tracks.forEach((track) => {
      const total = track.points.length;
      if (total === 0) return;

      const index = track.points.findIndex((point) => point.id === selectedPointId);
      if (index < 0) {
        if (!spinRef.current.has(track.id)) spinRef.current.set(track.id, { value: 0, target: 0 });
        return;
      }

      const spin = spinRef.current.get(track.id);
      spinTo(track.id, spin ? alignOffset(spin.target, index, total) : index);
    });
  }, [tracks, selectedPointId, spinTo]);

  /**
   * 좌우 이동 = 이웃 페이지 선택. 회전은 선택을 따라오므로 여기서 건드리지 않는다.
   * 아직 고른 페이지가 없으면 최하단에 있던 페이지부터 시작한다.
   */
  const stepPage = (track: OrbitTrack, direction: 1 | -1) => {
    const total = track.points.length;
    if (total === 0) return;
    const current = track.points.findIndex((point) => point.id === selectedPointId);
    const next = current < 0 ? bottomIndex(track) : (current + direction + total) % total;
    onSelectPoint(track.points[next].id, track.sessionId);
  };

  /**
   * ←→ 는 펼친 궤도의 페이지를 옮긴다.
   *
   * ↑↓ 는 여기서 다루지 않는다 — 폴더·세션 사이 이동이라 네비게이터의 세로 순서를
   * 아는 쪽(VariantAtlasReplica)이 맡는다. 궤도 축 이동은 휠과 "바깥 궤도" 버튼에 남았다.
   *
   * 의존성을 비워 두면 닫힌 선택·창 인덱스를 붙잡는다. 리스너 하나라 매 렌더
   * 재등록이 더 안전하고 싸다.
   */
  useEffect(() => {
    if (!scene) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // 세션 씬은 궤도가 여럿일 수 있다 — 고른 페이지가 있는 궤도를 먼저 잡는다.
        const track =
          tracks.find(
            (candidate) =>
              isOpenTrack(candidate) &&
              candidate.points.some((point) => point.id === selectedPointId),
          ) ?? tracks.find(isOpenTrack);
        if (!track || track.points.length === 0) return;
        event.preventDefault();
        stepPage(track, event.key === 'ArrowRight' ? 1 : -1);
        return;
      }

    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /** 초점을 이웃 궤도(=이웃 세션)로 옮긴다. 목록 밖으로는 나가지 않는다. */
  const stepFocus = (direction: 1 | -1) => {
    const next = focusIndex + direction;
    if (next < 0 || next >= tracks.length) return;
    const target = tracks[next];
    if (target.sessionId) onSelectTrack(target.sessionId);
  };

  /**
   * 캔버스 위 휠은 초점 이동 — 궤도를 한 칸씩 넘긴다.
   *
   * React 의 onWheel 은 passive 로 등록돼 preventDefault 가 먹지 않는다 —
   * 페이지가 같이 스크롤되지 않도록 여기서 직접 non-passive 로 건다.
   * 한 번의 스와이프가 여러 칸을 넘기지 않도록 관성 구간을 잠근다.
   */
  const wheelLockRef = useRef(0);
  useEffect(() => {
    const element = stageRef.current;
    if (!element || !isFolder || tracks.length <= 1) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 4) return;
      event.preventDefault();
      const now = performance.now();
      if (now < wheelLockRef.current) return;
      wheelLockRef.current = now + 260;
      stepFocus(event.deltaY > 0 ? 1 : -1);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  // 반경은 트레이가 열린 최악의 높이 기준으로 잡아 어떤 상태에서도 넘치지 않게 한다.
  const rxCap = Math.max(150, size.w / 2 - 28);
  const availableHeight = Math.max(240, size.h - INSET_MAX);
  const ryCap = Math.max(96, availableHeight - PLANET_Y_MIN - LABEL_GUTTER - 32);
  const rMax = Math.min(rxCap, ryCap / RATIO, R_ABS_MAX);
  const rInner = Math.min(R_INNER_MIN, rMax);

  /*
   * 초점 궤도는 언제나 같은 반경에 온다 — 세션을 넘겨도 "지금 보는 궤도"가 제자리에
   * 있어야 눈이 따라가지 않는다. 궤도가 하나뿐이면 초점 자리를 그대로 쓴다.
   */
  const ringSpacing = (rMax - rInner) / (2 * ORBIT_RING_REACH);
  const rFocus = (rInner + rMax) / 2;

  /*
   * 온전한 구간에 다 들어가는 작은 폴더는 초점을 고정하지 않고 가운데로 모은다 —
   * 어차피 넘길 것이 없는데 한쪽에만 궤도가 몰리면 비어 보인다.
   */
  const layoutFocus =
    tracks.length <= ORBIT_RING_SIDE * 2 + 1 ? (tracks.length - 1) / 2 : focusValue;

  const orbitLayouts = tracks.flatMap((track, index) => {
    const placement = ringPlacement(index, layoutFocus, tracks.length);
    if (!placement) return [];
    const rx = rFocus + placement.offset * ringSpacing;
    return [{ track, rx, ry: rx * RATIO, index, placement }];
  });

  const systemHeight = rMax * RATIO + LABEL_GUTTER;
  const planetY = Math.max(
    PLANET_Y_MIN,
    (Math.max(240, size.h - inset) - systemHeight) / 2,
  );
  const centerX = size.w / 2;
  const hue = scene?.hue ?? '#ef6f47';
  // 이웃 칩을 나란히 놓을 자리가 있는지 — 좁으면 초점 칩만 남긴다.
  const chipRoom = ringSpacing * RATIO >= CHIP_ROOM;

  const selectedLocation = orbitLayouts
    .map((layout) => ({
      layout,
      pointIndex: layout.track.points.findIndex((point) => point.id === selectedPointId),
    }))
    .find(({ pointIndex }) => pointIndex >= 0);

  const totalPoints = tracks.reduce((sum, track) => sum + track.points.length, 0);

  return (
    <div className="atlas-stage" ref={stageRef}>
      {scene && (
        <div className={cx('atlas-stage__scaler', leaving && 'atlas-stage__scaler--leaving')}>
          <svg className="atlas-stage__svg" width={size.w} height={size.h} aria-hidden>
            <g
              transform={`translate(${centerX}, ${planetY})`}
              style={{ '--arc-hue': hue } as React.CSSProperties}
            >
              <defs>
                {/* 궤도선이 노드 높이(y=0)에서 서서히 나타나도록 위쪽을 페이드아웃 */}
                <linearGradient id="atlas-arc-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="104">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
                  <stop offset="0.5" stopColor="#fff" stopOpacity="0.72" />
                  <stop offset="1" stopColor="#fff" stopOpacity="1" />
                </linearGradient>
                <mask
                  id="atlas-arc-mask"
                  maskUnits="userSpaceOnUse"
                  x={-centerX}
                  y={-40}
                  width={centerX * 2}
                  height={size.h}
                >
                  <rect x={-centerX} y={-40} width={centerX * 2} height={size.h} fill="url(#atlas-arc-fade)" />
                </mask>
                <radialGradient id="atlas-node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={hue} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={hue} stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* 클릭 히트 영역 (마스크 밖에 둬서 페이드와 무관하게 잡히도록) */}
              {isFolder &&
                orbitLayouts.map(({ track, rx, ry, placement }) =>
                  placement.beyond > 0 || !track.sessionId ? null : (
                    <path
                      key={`hit-${track.id}`}
                      d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                      className="atlas-arc__hit"
                      onClick={() => onSelectTrack(track.sessionId as string)}
                      onMouseEnter={() => setHoveredTrackId(track.id)}
                      onMouseLeave={() => setHoveredTrackId(null)}
                    />
                  ),
                )}

              <g mask="url(#atlas-arc-mask)">
                {orbitLayouts.map(({ track, rx, ry, placement }) => {
                  const isOpen = isFolder && track.id === activeTrackId;
                  const isHovered = hoveredTrackId === track.id;
                  return (
                    <path
                      key={track.id}
                      d={`M ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0`}
                      vectorEffect="non-scaling-stroke"
                      className={cx(
                        'atlas-arc',
                        isOpen && 'atlas-arc--active',
                        isHovered && !isOpen && 'atlas-arc--hover',
                      )}
                      style={{
                        opacity: isHovered
                          ? 0.9
                          : arcOpacity(placement.offset, placement.beyond),
                        stroke: isFolder ? track.hue : undefined,
                      }}
                    />
                  );
                })}
              </g>

              {/* 선택된 페이지로 향하는 연결선 — 회전이 끝나면 수직으로 선다. */}
              {selectedLocation && selectedLocation.layout.placement.beyond === 0 && (() => {
                const { layout, pointIndex } = selectedLocation;
                if (!isOpenTrack(layout.track)) return null;
                const placement = orbitPlacement(
                  pointIndex,
                  spinValue(layout.track.id),
                  layout.track.points.length,
                );
                if (!placement) return null;
                const point = pointOnArc(layout.rx, layout.ry, placement.angle);
                return <line className="atlas-arc__link" x1={0} y1={0} x2={point.x} y2={point.y} />;
              })()}

              <g className="atlas-node" onClick={onClearSelection}>
                <title>{scene.title} — 전체 보기</title>
                <circle r={PLANET_R * 3.6} fill="url(#atlas-node-glow)" pointerEvents="none" />
                <circle className="atlas-node__halo" r={PLANET_R * 1.85} />
                <circle className="atlas-node__core" r={PLANET_R} />
                <circle className="atlas-node__rim" r={PLANET_R} vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          </svg>

          <div className="atlas-planet-label" style={{ left: centerX, top: planetY + PLANET_R + 20 }}>
            <div className="atlas-planet-label__title">{scene.title}</div>
            <div className="atlas-planet-label__meta">{scene.meta}</div>
          </div>

          {/* 세션 레이블 칩 — 각 호의 최하단 바로 아래 */}
          {orbitLayouts.map(({ track, ry, placement }) => {
            if (!track.chip) return null;
            /*
             * 이름표가 쌓이면 그게 곧 혼잡이라 온전한 구간 밖에서는 지운다. 다만
             * 켜고 끄기로 다루면 초점을 옮길 때 칩이 불쑥 나타난다 — 초점에서 멀어진
             * 만큼 서서히 지운다. beyond 가 연속값이라 미끄러지는 내내 이어진다.
             */
            const fade = 1 - Math.min(1, placement.beyond);
            const near = Math.max(0, 1 - Math.abs(placement.offset));
            /*
             * 초점 칩은 또렷하고 이웃은 한 걸음 물러난다. 자리가 좁으면 이웃을 지운다.
             * 두 경우 모두 near 로 이어 계산한다 — 구간을 나눠 다른 값을 주면 궤도가
             * 그 경계를 넘는 순간 크기와 농도가 계단처럼 뛴다.
             */
            const opacity = fade * (chipRoom ? 0.6 + 0.4 * near : near);
            if (opacity <= 0.02) return null;
            const isOpen = track.id === activeTrackId;
            const isHovered = hoveredTrackId === track.id;
            return (
              <button
                key={`chip-${track.id}`}
                type="button"
                className={cx(
                  'atlas-chip',
                  isOpen && 'atlas-chip--active',
                  isHovered && 'atlas-chip--hover',
                )}
                style={{
                  left: centerX,
                  top: planetY + ry + CHIP_DROP,
                  opacity,
                  '--chip-focus': near,
                  '--chip-hue': track.hue,
                } as React.CSSProperties}
                onClick={() => onSelectTrack(track.sessionId as string)}
                onMouseEnter={() => setHoveredTrackId(track.id)}
                onMouseLeave={() => setHoveredTrackId(null)}
                title={`${track.label} — ${track.chip.date}`}
              >
                {track.chip.status === 'live' && <span className="atlas-chip__live" />}
                <span className="atlas-chip__title">{track.label}</span>
                <span className="atlas-chip__meta">
                  {track.points.length}p · {formatMinutes(track.chip.minutes)}
                </span>
                <span className="atlas-chip__date">{track.chip.date}</span>
              </button>
            );
          })}

          {/* 페이지 위성 — 폴더 씬에서는 펼친 세션 하나만 */}
          {orbitLayouts.flatMap((layout) => {
            if (layout.placement.beyond > 0) return [];
            const isOpen = isOpenTrack(layout.track);
            if (!isOpen && layout.track.id !== leavingTrackId) return [];

            /*
             * 초점에 가까울수록 짙다. 들어오는 궤도는 0 에서 시작해 다가오며 나타나고,
             * 나가는 궤도는 멀어지며 사라진다.
             */
            const near = isFolder ? Math.max(0, 1 - Math.abs(layout.placement.offset)) : 1;
            if (near <= 0.01) return [];

            const total = layout.track.points.length;
            const offset = spinValue(layout.track.id);

            return layout.track.points.map((point, index) => {
              const placement = orbitPlacement(index, offset, total);
              if (!placement) return null;
              const at = pointOnArc(layout.rx, layout.ry, placement.angle);
              const isActive = selectedPointId === point.id;

              /*
               * 궤도 양 끝으로 밀려난 점은 "밖에 더 있다"는 표시일 뿐이다.
               * 크기와 농도를 남은 거리에 비례시켜 0 으로 수렴시킨다 — 회전이
               * 연속값이라 온전한 점에서 여기까지 끊김 없이 이어진다.
               */
              const isEdge = placement.beyond > 0;
              const fade = isEdge ? 1 - placement.beyond / ORBIT_EDGE_HINTS : 1;

              return (
                <button
                  key={`${layout.track.id}-${point.id}`}
                  type="button"
                  className={cx(
                    'atlas-sat',
                    isActive && 'atlas-sat--active',
                    isEdge && 'atlas-sat--edge',
                  )}
                  style={{
                    left: centerX + at.x,
                    top: planetY + at.y,
                    background: layout.track.hue,
                    '--sat-near': near,
                    // 아직 미끄러지는 중인 궤도는 눌러도 엉뚱한 세션이 잡힌다.
                    pointerEvents: isOpen && near > 0.9 ? undefined : 'none',
                    ...(isEdge ? { '--sat-fade': fade } : null),
                  } as React.CSSProperties}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectPoint(point.id, layout.track.sessionId);
                  }}
                  {...(isEdge
                    ? { 'aria-hidden': true, tabIndex: -1 }
                    : { 'aria-label': `${index + 1}. ${point.title}` })}
                >
                  <span className="atlas-sat__hit" />
                  {!isEdge && (
                    <span
                      className={cx(
                        'atlas-sat__tip',
                        at.x > 0 ? 'atlas-sat__tip--left' : 'atlas-sat__tip--right',
                      )}
                    >
                      <span className="atlas-sat__tip-title">{index + 1}. {point.title}</span>
                      <span className="atlas-sat__tip-meta">
                        <span className="atlas-sat__tip-domain">{point.domain}</span>
                        {point.minutes > 0 && <span>· {point.minutes}분</span>}
                        {point.visits > 1 && <span>· 총 {point.visits}회 방문</span>}
                      </span>
                    </span>
                  )}
                </button>
              );
            });
          })}

          {/* 펼친 궤도의 좌우 이동 — 지금 최하단에 있는 페이지가 몇 번째인지 함께 알린다 */}
          {orbitLayouts.map((layout) => {
            const { track } = layout;
            if (layout.placement.beyond > 0 || !isOpenTrack(track)) return null;
            if (track.points.length <= 1) return null;
            const near = isFolder ? Math.max(0, 1 - Math.abs(layout.placement.offset)) : 1;

            return (
              <div
                key={`rotate-${track.id}`}
                className="atlas-rotate"
                style={{
                  left: centerX,
                  top: planetY + layout.ry + (track.chip ? CHIP_DROP + CHIP_H + 10 : 30),
                  opacity: near,
                  pointerEvents: near > 0.9 ? undefined : 'none',
                }}
              >
                <button type="button" aria-label="이전 페이지" onClick={() => stepPage(track, -1)}>
                  <i className="ph ph-caret-left" />
                </button>
                {/* 궤도 밖에 몇 개가 더 있는지 알려주지 않으면 끝까지 돌려봐야만 안다. */}
                <span className="atlas-rotate__count">
                  {bottomIndex(track) + 1} / {track.points.length}
                </span>
                <button type="button" aria-label="다음 페이지" onClick={() => stepPage(track, 1)}>
                  <i className="ph ph-caret-right" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!scene && (
        <div className="atlas-stage__empty">
          <i className="ph ph-planet" />
          <p>{emptyMessage ?? '왼쪽 네비게이터에서 세션을 선택하세요'}</p>
        </div>
      )}

      {scene && tracks.length === 0 && (
        <div className="atlas-stage__empty">
          <i className="ph ph-file-dashed" />
          <p>
            {isFolder
              ? '이 폴더에는 아직 세션이 없습니다'
              : '이 세션에는 표시할 페이지 기록이 없습니다'}
          </p>
        </div>
      )}

      {scene && totalPoints > 0 && !selectedPointId && !hintClosed && !hintMuted && (
        <div
          ref={hintRef}
          className={`atlas-stage__hint${hintEntered ? '' : ' atlas-stage__hint--enter'}`}
          onAnimationEnd={() => setHintEntered(true)}
          style={
            {
              // 트레이(열린 세션 카드) 위로 띄운다 — 아래에 고정하면 카드를 가린다.
              '--hint-bottom': `${inset + 12}px`,
              ...(hintFrozenLeft !== null
                ? { left: `${hintFrozenLeft}px`, transform: 'none' }
                : null),
            } as React.CSSProperties
          }
        >
          <span>
            {isFolder
              ? '궤도나 레이블을 클릭하면 세션이 펼쳐집니다 · ↑↓ 폴더·세션 이동, ←→ 페이지 이동'
              : '페이지는 방문 순서대로 배치됩니다 · ←→ 페이지 이동, ↑↓ 폴더·세션 이동'}
          </span>
          <span
            className="atlas-stage__hint-actions"
            onMouseEnter={freezeHint}
            onMouseLeave={releaseHint}
          >
            <button
              type="button"
              className="atlas-stage__hint-close"
              onClick={() => setHintClosed(true)}
              aria-label="안내 닫기"
            >
              <i className="ph ph-x" />
            </button>
            {/* X 뒤에 둬서 오른쪽으로 펼쳐진다. 위치가 고정돼 있어 X 는 움직이지 않는다. */}
            <button
              type="button"
              className="atlas-stage__hint-never"
              onClick={() => {
                try {
                  localStorage.setItem(HINT_STORAGE_KEY, '1');
                } catch {
                  // 저장 불가 환경에서는 이번 탭에서만 감춘다.
                }
                setHintMuted(true);
              }}
            >
              다시 보지 않기
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
