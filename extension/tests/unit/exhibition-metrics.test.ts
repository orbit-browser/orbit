import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildMatrix, displayMeasure, METRICS, parseCsv } from '../../preview/exhibition/metrics';
import { TechBanner } from '../../preview/exhibition/panel-tech';
import { calculateRefusalHighlight, REFUSAL_HIGHLIGHT } from '../../preview/exhibition/trial-highlights';

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

  it('실측 결과는 골든·holdout과 오류를 분리하고 서버 시간을 E2E로 표시하지 않는다', () => {
    const latency = METRICS.metrics.find((metric) => metric.code === 'B')!;
    expect(latency.title).toBe('Backend Search Latency');
    expect(latency.note).toContain('HTTP·인증·UI 제외');
    const quality = METRICS.metrics.find((metric) => metric.code === 'C')!;
    expect(quality.values.map((value) => [value.label, value.value])).toEqual([
      ['골든 Top-1', 100],
      ['holdout 끔 Top-1', 66.7],
      ['holdout 켬 Top-1', 40],
    ]);
    expect(quality.note).toContain('429 오류 22회');
    expect(quality.values.every((value) => displayMeasure(value).measured)).toBe(true);
    expect(METRICS.scaling.map((point) => point.sessions)).toEqual([100, 1000, 5000, 10000]);
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
    // Orbit도 실제 수집 UI 시험을 완료했다. 후보 표시와 복원 오류를 함께 남긴다.
    const kinds = (name: string) => matrix.capabilities.map((capability) => matrix.cell(name, capability).kind);
    expect(rows.filter((row) => row.product === 'Orbit').map((row) => row.value)).toEqual([
      '후보 3/6', '2/2', '일부·혼입', '4/9',
    ]);
    expect(kinds('Orbit')).not.toContain('pending');
    const trial = parseCsv(readFileSync(new URL('../../preview/exhibition/orbit_trial.csv', import.meta.url), 'utf8'));
    expect(trial).toHaveLength(8);
    expect(trial.slice(0, 6).filter((row) => row.found === '1')).toHaveLength(3);
    expect(trial.slice(6).filter((row) => row.found === '1')).toHaveLength(2);
    const report = readFileSync(new URL('../../preview/exhibition/orbit-ui-trial.md', import.meta.url), 'utf8');
    expect(report).toContain('답변/근거 모순');
    expect(report).toContain('| 전체 | **4/9** | **5**');
    expect(report).toContain('제주항공 403');
    for (const name of ['Perplexity Comet', 'Google Chrome']) expect(kinds(name)).not.toContain('pending');
  });
});

describe('전면 비교 강조 — 같은 부정 질문과 로그인 조건', () => {
  const orbit = readFileSync(new URL('../../preview/exhibition/orbit_trial.csv', import.meta.url), 'utf8');
  const competitors = readFileSync(new URL('../../preview/exhibition/competitor_trials.csv', import.meta.url), 'utf8');

  it('원본의 고정 두 문항으로 비율과 퍼센트포인트 차이를 계산한다', () => {
    expect(REFUSAL_HIGHLIGHT).toEqual({
      orbit: { correct: 2, total: 2, percent: 100 },
      comet: { correct: 1, total: 2, percent: 50 },
      differencePoints: 50,
    });
    // 로그아웃·Chrome의 동일 문항 판정은 이 비교에 들어가지 않는다.
    const changed = competitors
      .replace('logged_out_search,negative_garden,Q,partial', 'logged_out_search,negative_garden,Q,wrong')
      .replaceAll('correct_trivial', 'wrong');
    expect(calculateRefusalHighlight(orbit, changed)).toEqual(REFUSAL_HIGHLIGHT);
  });

  it('한쪽 문항 누락·중복 또는 미판정 결과로 비율을 만들지 않는다', () => {
    const missing = competitors.split('\n').filter((row) => !row.includes('logged_in_mixed,negative_piano,')).join('\n');
    expect(() => calculateRefusalHighlight(orbit, missing)).toThrow('Expected one measured refusal result');
    const duplicate = orbit.split('\n').find((row) => row.startsWith('negative_garden,'))!;
    expect(() => calculateRefusalHighlight(`${orbit}\n${duplicate}`, competitors)).toThrow('Expected one measured refusal result');
    const pending = competitors.replace('logged_in_mixed,negative_piano,Q,wrong', 'logged_in_mixed,negative_piano,Q,pending');
    expect(() => calculateRefusalHighlight(orbit, pending)).toThrow('unmeasured result');
  });

  it('배너는 분수 없이 비율을 표시하고 시험 범위와 실행 차이를 함께 남긴다', () => {
    const html = renderToStaticMarkup(createElement(TechBanner));
    const text = html.replace(/<[^>]*>/g, '');
    expect(text).toContain('기록 없음 판별');
    expect(text).toContain('100%');
    expect(text).toContain('Comet50%');
    expect(text).toContain('+50%p');
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text).toContain('기록이 없는 두 질문');
    expect(text).toContain('전체 검색 정확도를 뜻하지 않습니다');
    expect(text).toContain('실행 방식·수집 콘텐츠 차이');
    expect(text).toContain('제주항공 403');
    expect(text).not.toContain('골든 Top-1');
    expect(text).toContain('HTTP·인증·UI 제외');
  });
});
