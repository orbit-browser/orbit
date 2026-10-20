import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMatrix, displayMeasure, METRICS, parseCsv } from '../../preview/exhibition/metrics';

describe('전시 현수막 숫자 — 실측만 숫자로', () => {
  it('실측 표시가 없으면 숫자가 들어 있어도 TBD 로 둔다', () => {
    expect(displayMeasure({ label: 'p50', value: 3, unit: 'ms', status: 'pending' })).toEqual({ text: 'TBD', unit: '', measured: false });
    expect(displayMeasure({ label: 'p50', value: 3, unit: 'ms', status: '' })).toEqual({ text: 'TBD', unit: '', measured: false });
  });

  it('실측이어도 값이 없거나 숫자가 아니면 TBD', () => {
    expect(displayMeasure({ label: 'p95', value: null, unit: 'ms', status: 'measured' }).text).toBe('TBD');
    expect(displayMeasure({ label: 'p95', value: Number.NaN, unit: 'ms', status: 'measured' }).text).toBe('TBD');
  });

  it('실측 값은 단위와 함께, 정한 자릿수로', () => {
    expect(displayMeasure({ label: 'p95', value: 1234.4, unit: 'ms', status: 'measured' })).toEqual({ text: '1,234', unit: 'ms', measured: true });
    expect(displayMeasure({ label: 'MRR', value: 0.8, unit: '', status: 'measured', digits: 2 })).toEqual({ text: '0.80', unit: '', measured: true });
  });

  it('지금 데이터 파일에는 실측 값이 하나도 없다(결과가 오기 전)', () => {
    const shown = METRICS.metrics.flatMap((metric) => metric.values).filter((value) => displayMeasure(value).measured);
    expect(shown).toEqual([]);
    expect(METRICS.scaling).toEqual([]);
  });
});

describe('비교표 CSV', () => {
  it('따옴표 안의 쉼표·따옴표, CRLF, BOM, 빈 줄을 읽는다', () => {
    const rows = parseCsv('﻿product,capability,value\r\n"Dia, beta","찾음 ""부분""",TBD\r\n\r\nAside,복원,\n');
    expect(rows).toEqual([
      { product: 'Dia, beta', capability: '찾음 "부분"', value: 'TBD' },
      { product: 'Aside', capability: '복원', value: '' },
    ]);
  });

  it('제품·기능은 처음 나온 순서, 없는 칸과 TBD 는 시험 전, 모르는 값은 글자 그대로', () => {
    const matrix = buildMatrix([
      { product: 'Orbit', capability: '검색', value: '찾음', basis: '직접 시험' },
      { product: 'Comet', capability: '검색', value: '못 찾음', basis: '직접 시험' },
      { product: 'Comet', capability: '복원', value: 'TBD', basis: '직접 시험' },
      { product: 'Orbit', capability: '복원', value: '부분 지원', basis: '직접 시험' },
    ]);
    expect(matrix.products.map((product) => product.name)).toEqual(['Orbit', 'Comet']);
    expect(matrix.capabilities).toEqual(['검색', '복원']);
    expect(matrix.cell('Orbit', '검색')).toEqual({ kind: 'found', text: '찾음', documentOnly: false });
    expect(matrix.cell('Comet', '검색').kind).toBe('missed');
    expect(matrix.cell('Comet', '복원')).toEqual({ kind: 'pending', text: 'TBD', documentOnly: false });
    expect(matrix.cell('Orbit', '복원')).toEqual({ kind: 'other', text: '부분 지원', documentOnly: false });
    expect(matrix.cell('Nobody', '검색').kind).toBe('pending');
  });

  it('공식 문서로만 판정한 칸과 제품을 가른다', () => {
    const matrix = buildMatrix([
      { product: 'Dia', capability: '검색', value: '기능 없음', basis: '공식 문서' },
      { product: 'Dia', capability: '복원', value: 'TBD', basis: 'official docs' },
      { product: 'Edge', capability: '검색', value: '찾음', basis: '공식 문서' },
      { product: 'Edge', capability: '복원', value: '찾음', basis: '직접 시험' },
    ]);
    expect(matrix.cell('Dia', '검색')).toEqual({ kind: 'none', text: '기능 없음', documentOnly: true });
    expect(matrix.products).toEqual([
      { name: 'Dia', documentOnly: true },
      { name: 'Edge', documentOnly: false },
    ]);
  });

  it('함께 둔 비교표는 대표가 정한 범위다(직접 시험은 설치된 제품만, Aside는 문서 기준)', () => {
    const text = readFileSync(new URL('../../preview/exhibition/competitor_matrix.csv', import.meta.url), 'utf8');
    const rows = parseCsv(text);
    expect(Object.keys(rows[0])).toEqual(['product', 'capability', 'value', 'basis', 'source_ids', 'checked_on']);
    const matrix = buildMatrix(rows);
    expect(matrix.products).toEqual([
      { name: 'Orbit', documentOnly: false },
      { name: 'Perplexity Comet', documentOnly: false },
      { name: 'Google Chrome', documentOnly: false },
      { name: 'Aside', documentOnly: true },
      { name: 'Dia', documentOnly: true },
      { name: 'Microsoft Edge', documentOnly: true },
    ]);
    expect(matrix.capabilities).toHaveLength(4);
    // 경쟁 제품은 직접 시험을 마쳤고, Orbit 행은 같은 조건의 시험 결과가 올 때까지 비워 둔다.
    const kinds = (name: string) => matrix.capabilities.map((capability) => matrix.cell(name, capability).kind);
    expect(new Set(kinds('Orbit'))).toEqual(new Set(['pending']));
    for (const name of ['Perplexity Comet', 'Google Chrome']) expect(kinds(name)).not.toContain('pending');
  });
});
