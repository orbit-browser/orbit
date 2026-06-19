import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { SessionSummary } from '../../../lib/types';

function buildSummaryText(summary: SessionSummary): string {
  const lines = [summary.overview, ''];
  if (summary.purpose) lines.push(`탐색 목적: ${summary.purpose}`, '');
  lines.push('핵심 정보:');
  summary.highlights.forEach((h) => lines.push(`- ${h}`));
  if (summary.todos?.length) {
    lines.push('', '미완료 작업:');
    summary.todos.forEach((t) => lines.push(`- ${t}`));
  }
  if (summary.nextActions?.length) {
    lines.push('', '다음 행동:');
    summary.nextActions.forEach((a) => lines.push(`- ${a}`));
  }
  return lines.join('\n');
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-orbit-muted">{title}</p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-orbit-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryPanel({ summary }: { summary: SessionSummary }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildSummaryText(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없을 수 있음 — 조용히 무시
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-orbit-border bg-orbit-surface p-4">
      <p className="text-sm leading-relaxed">{summary.overview}</p>

      {summary.purpose && (
        <p className="text-xs text-orbit-muted">탐색 목적 · {summary.purpose}</p>
      )}

      <Section title="핵심 정보" items={summary.highlights} />
      {summary.todos?.length ? <Section title="미완료 작업" items={summary.todos} /> : null}
      {summary.nextActions?.length ? (
        <Section title="다음 행동" items={summary.nextActions} />
      ) : null}

      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 rounded-lg border border-orbit-border px-3 py-1.5 text-xs font-medium text-orbit-text transition hover:bg-orbit-bg"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? '복사됨' : '요약 복사하기'}
      </button>
    </div>
  );
}
