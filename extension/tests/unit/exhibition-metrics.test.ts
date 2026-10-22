import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildMatrix, displayMeasure, METRICS, parseCsv } from '../../preview/exhibition/metrics';
import { TechBanner } from '../../preview/exhibition/panel-tech';
import { calculateProven, PROVEN } from '../../preview/exhibition/trial-highlights';

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
    // 품질(골든·holdout)은 D로 두고 앞면에는 싣지 않는다 — 원본과 보고서에는 낮은 holdout 값까지 그대로 남는다.
    const quality = METRICS.metrics.find((metric) => metric.code === 'D')!;
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
      '3/6', '2/2', '찾은 작업만', '4/9 · 섞임 0',
    ]);
    expect(kinds('Orbit')).not.toContain('pending');
    const trial = parseCsv(readFileSync(new URL('../../preview/exhibition/orbit_trial.csv', import.meta.url), 'utf8'));
    expect(trial).toHaveLength(8);
    expect(trial.slice(0, 6).filter((row) => row.found === '1')).toHaveLength(3);
    expect(trial.slice(6).filter((row) => row.found === '1')).toHaveLength(2);
    const report = readFileSync(new URL('../../preview/exhibition/orbit-ui-trial.md', import.meta.url), 'utf8');
    // 검색 품질 2차 뒤 같은 조건 재시험(fix2): 복원 4/9, 함께 열린 다른 URL 0, 제주항공은 여전히 403.
    expect(report).toContain('| 복원된 목표 URL | 4/9 | 4/9 | **4/9**');
    expect(report).toContain('| 추가로 열린 다른 URL | 5 | 0 | **0**');
    expect(report).toContain('제주항공은 이번에도 403');
    for (const name of ['Perplexity Comet', 'Google Chrome']) expect(kinds(name)).not.toContain('pending');
  });
});

describe('검증된 숫자 — 100%·0건만 앞면에', () => {
  const orbit = readFileSync(new URL('../../preview/exhibition/orbit_trial.csv', import.meta.url), 'utf8');
  const competitors = readFileSync(new URL('../../preview/exhibition/competitor_trials.csv', import.meta.url), 'utf8');

  it('원본 CSV와 출처 값으로 계산한다', () => {
    expect(PROVEN).toEqual({
      refusal: { orbit: { hit: 2, total: 2, percent: 100 }, comet: { hit: 1, total: 2, percent: 50 } },
      restorePrecision: { orbit: { hit: 4, total: 4, percent: 100 }, comet: { hit: 3, total: 26, percent: 12 } },
      teamIsolation: { leaks: 0, paths: 12, responses: 18 },
    });
  });

  it('Orbit 거절이 하나라도 실패로 바뀌면 100%가 아니게 계산된다', () => {
    const failed = orbit.replace(/^negative_piano,([^,]*),1,/m, 'negative_piano,$1,0,');
    expect(failed).not.toEqual(orbit);
    expect(calculateProven(failed, competitors).refusal.orbit.percent).toBe(50);
  });

  it('질문 하나라도 빠지거나 겹치면 비율을 만들지 않는다', () => {
    const missing = competitors.split('\n').filter((row) => !row.includes('logged_in_mixed,negative_piano,')).join('\n');
    expect(() => calculateProven(orbit, missing)).toThrow('Expected one measured result');
    const duplicate = orbit.split('\n').find((row) => row.startsWith('negative_garden,'))!;
    expect(() => calculateProven(`${orbit}\n${duplicate}`, competitors)).toThrow('Expected one measured result');
  });

  it('앞면은 100%·0건만, 표본과 조건은 숫자 밑과 각주에 남긴다', () => {
    const html = renderToStaticMarkup(createElement(TechBanner));
    const text = html.replace(/<[^>]*>/g, '');
    expect(text).toContain('100%없는 기록은, 없다고 답합니다');
    expect(text).toContain('같은 조건 시험 2번 중 2번');
    expect(text).toContain('100%다시 열면, 그 작업의 페이지만');
    expect(text).toContain('Comet은 26개 중 3개(12%)');
    expect(text).toContain('0건공유하지 않은 팀 기록의 노출');
    expect(text).toContain('화면·API 12가지 경로, 응답 18개에서 0건');
    expect(text).toContain('목표 9개 중 4개');
    expect(text).not.toContain('Long-History Accuracy'); // 고친 뒤 골든 질문의 100%는 앞면에 싣지 않는다
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text).not.toContain('기록에서 찾아낸 비율'); // Orbit 이 100%가 아닌 지표는 앞면에 싣지 않는다
    expect(text).toContain('표본이 작아 전체 정확도를 뜻하지 않음');
    expect(text).not.toContain('골든 Top-1');
    expect(text).toContain('HTTP·인증·UI 제외');
  });
});
