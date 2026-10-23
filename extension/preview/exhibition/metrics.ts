/**
 * 3번 현수막의 숫자와 비교표 — 데이터 파일 두 개에서만 온다. 결과가 오면 파일만 바꾼다.
 *   metrics.json           Orbit 자체 성능(A–D). benchmarks/exhibition-2026/benchmark_results.csv 를 옮겨 적는다.
 *   competitor_matrix.csv  기능 비교. 경쟁·벤치마크팀 benchmarks/exhibition-2026/competitor_matrix.csv 와 같은 형식.
 *
 * 실측으로 확인된 값(status 'measured' + 유한한 숫자)만 숫자로 그린다. 나머지는 'TBD'.
 * 비교표는 기능 비교(찾음·못 찾음·기능 없음)만 담는다 — 조건이 달라 제품 사이 속도는 비교하지 않는다.
 */
import raw from './metrics.json';

export interface Measure {
  label: string;
  value: number | null;
  unit: string;
  /** 'measured' 일 때만 숫자를 그린다 */
  status: string;
  digits?: number;
}

export interface Metric {
  code: string;
  title: string;
  ko: string;
  scope: string;
  values: Measure[];
  /** 측정 조건 한 줄(질문 수·반복 수·날짜). 값이 있을 때만 쓴다. */
  note: string | null;
}

/** 저장된 세션 수에 따른 검색 지연(D). 측정한 점만 그린다. */
export interface ScalePoint {
  sessions: number;
  p50: number | null;
  p95: number | null;
  status: string;
}

export interface MetricsData {
  status: string;
  updated: string | null;
  source: string;
  metrics: Metric[];
  scaling: ScalePoint[];
  method: { label: string; value: string | null }[];
}

export const METRICS = raw as MetricsData;

export const isMeasured = (status: string, value: number | null | undefined): value is number =>
  status === 'measured' && typeof value === 'number' && Number.isFinite(value);

/** 숫자 하나를 현수막에 쓸 글자로. 실측이 아니면 measured 가 false 이고 숫자를 내보내지 않는다. */
export function displayMeasure(measure: Measure): { text: string; unit: string; measured: boolean } {
  if (!isMeasured(measure.status, measure.value)) return { text: 'TBD', unit: '', measured: false };
  const digits = measure.digits ?? (measure.value < 10 ? 1 : 0);
  return {
    text: measure.value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    unit: measure.unit,
    measured: true,
  };
}

// ── 비교표 ───────────────────────────────────────────────────────────

/** 따옴표·쉼표·줄바꿈이 든 칸까지 읽는 CSV(RFC 4180). 첫 줄은 열 이름. 빈 줄은 건너뛴다. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRow();
    } else field += char;
  }
  if (field !== '' || row.length > 0) endRow();
  const [header = [], ...body] = rows;
  const keys = header.map((key) => key.replace(/^﻿/, '').trim());
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])));
}

export type CellKind = 'found' | 'missed' | 'none' | 'pending' | 'other';

export interface MatrixCell {
  kind: CellKind;
  text: string;
  /** 직접 시험하지 않고 공식 문서로 판정한 칸 */
  documentOnly: boolean;
}

export interface Matrix {
  products: { name: string; documentOnly: boolean }[];
  capabilities: string[];
  cell: (product: string, capability: string) => MatrixCell;
}

const KINDS: Record<string, CellKind> = { 찾음: 'found', '못 찾음': 'missed', '기능 없음': 'none' };
const isDocumentBasis = (basis: string) => /문서|doc/i.test(basis);

/**
 * CSV 행(product, capability, value, basis, …)을 표로 — 제품과 기능은 처음 나온 순서대로.
 * 칸이 없거나 값이 비었거나 TBD 면 'pending'. 모르는 값은 글자 그대로 보여 준다(새 값이 와도 깨지지 않게).
 */
export function buildMatrix(rows: Record<string, string>[]): Matrix {
  const products: string[] = [];
  const capabilities: string[] = [];
  const cells = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const product = row.product ?? '';
    const capability = row.capability ?? '';
    if (!product || !capability) continue;
    if (!products.includes(product)) products.push(product);
    if (!capabilities.includes(capability)) capabilities.push(capability);
    cells.set(`${product}\u0000${capability}`, row);
  }
  const cell = (product: string, capability: string): MatrixCell => {
    const row = cells.get(`${product}\u0000${capability}`);
    const value = row?.value ?? '';
    const documentOnly = isDocumentBasis(row?.basis ?? '');
    if (!value || /^tbd$/i.test(value)) return { kind: 'pending', text: 'TBD', documentOnly };
    return { kind: KINDS[value] ?? 'other', text: value, documentOnly };
  };
  return {
    products: products.map((name) => ({
      name,
      documentOnly: capabilities.every((capability) => isDocumentBasis(cells.get(`${name}\u0000${capability}`)?.basis ?? '')),
    })),
    capabilities,
    cell,
  };
}
