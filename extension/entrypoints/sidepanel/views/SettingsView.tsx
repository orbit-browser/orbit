import { useAuth } from '../../../lib/useAuth';
import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '../../../lib/api';
import { useUIStore } from '../store/ui';
import { useSettingsStore } from '../store/settings';
import type { OrbitSettings } from '../../../lib/settings';
import { useServerSettings, useUpdateServerSettings } from '../hooks/useServerSettings';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <span className="text-xs text-orbit-muted">{value}</span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={
        'relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-default disabled:opacity-50 ' +
        (checked ? 'bg-orbit-primary' : 'bg-orbit-border')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' +
          (checked ? 'left-[18px]' : 'left-0.5')
        }
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-orbit-muted">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} disabled={disabled} />
    </div>
  );
}

function IntervalRow({
  value,
  onChange,
}: {
  value: 15 | 30 | 60;
  onChange: (v: 15 | 30 | 60) => void;
}) {
  const options: (15 | 30 | 60)[] = [15, 30, 60];
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">동기화 주기</p>
        <p className="text-xs text-orbit-muted">자동 동기화가 실행되는 간격</p>
      </div>
      <div className="flex shrink-0 rounded-lg border border-orbit-border/50 bg-orbit-bg p-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={
              'cursor-pointer rounded-full px-2 py-1 text-[11px] font-bold transition ' +
              (value === opt
                ? 'bg-orbit-surface text-orbit-primary shadow-orbit-raised'
                : 'text-orbit-muted hover:text-orbit-text')
            }
          >
            {opt}분
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberRow({
  label,
  description,
  value,
  onChange,
  min = 1,
  max = 999,
  suffix,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-orbit-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          className="w-14 rounded-md border border-orbit-border px-2 py-1 text-right text-sm outline-none focus:border-orbit-primary"
        />
        {suffix && <span className="text-xs text-orbit-muted">{suffix}</span>}
      </div>
    </div>
  );
}

const THEMES: { id: OrbitSettings['theme']; label: string }[] = [
  { id: 'system', label: '시스템' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];

function ThemeRow({
  value,
  onChange,
}: {
  value: OrbitSettings['theme'];
  onChange: (v: OrbitSettings['theme']) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">모양</p>
        <p className="text-xs text-orbit-muted">시스템을 고르면 OS 설정을 따라갑니다</p>
      </div>
      <div className="flex shrink-0 rounded-lg border border-orbit-border/50 bg-orbit-bg p-0.5">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={
              'cursor-pointer rounded-full px-2 py-1 text-[11px] font-bold transition ' +
              (value === option.id
                ? 'bg-orbit-surface text-orbit-primary shadow-orbit-raised'
                : 'text-orbit-muted hover:text-orbit-text')
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsView() {
  const showToast = useUIStore((s) => s.showToast);
  const {
    data: serverSettings,
    isLoading: serverSettingsLoading,
    isError: serverSettingsError,
  } = useServerSettings();
  const updateServerSettings = useUpdateServerSettings();
  const {
    theme,
    setTheme,
    rerankEnabled,
    excludeSensitive,
    collectionEnabled,
    contentCapture,
    autoSyncEnabled,
    autoSyncIntervalMin,
    idleSyncMin,
    countThreshold,
    setRerankEnabled,
    setExcludeSensitive,
    setCollectionEnabled,
    setContentCapture,
    setAutoSyncEnabled,
    setAutoSyncIntervalMin,
    setIdleSyncMin,
    setCountThreshold,
  } = useSettingsStore();

  const { data: isConnected, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  const connectionLabel = isLoading ? '확인 중…' : isConnected ? '연결됨' : '미연결';
  const { session, signOut } = useAuth();

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      <p className="text-xs font-semibold text-orbit-muted">설정</p>

      <div className="divide-y divide-orbit-border rounded-orbit-card border border-orbit-border bg-orbit-surface">
        <ThemeRow value={theme} onChange={setTheme} />

        <InfoRow label="백엔드 연결" value={connectionLabel} />

        <SettingRow
          label="더 정확한 결과 보기"
          description="AI가 검색 결과를 재정렬해요 (응답 1–2초 추가)"
          checked={rerankEnabled}
          onChange={(v) => {
            setRerankEnabled(v);
            showToast(v ? '정확한 결과 보기 켜짐' : '정확한 결과 보기 꺼짐');
          }}
        />

        <InfoRow label="단축키" value="Alt+Shift+O" />
        <InfoRow label="버전" value="0.0.1" />
      </div>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">세션 관리</p>
        <div className="divide-y divide-orbit-border rounded-orbit-card border border-orbit-border bg-orbit-surface">
          <SettingRow
            label="자동 병합"
            description={
              serverSettingsError
                ? '서버 설정을 불러오지 못했어요'
                : '다음 동기화에서 제목까지 거의 같은 중복만 자동으로 합쳐요'
            }
            checked={serverSettings?.autoMergeEnabled ?? false}
            disabled={serverSettingsLoading || serverSettingsError || updateServerSettings.isPending}
            onChange={(autoMergeEnabled) => {
              updateServerSettings.mutate(
                { autoMergeEnabled },
                {
                  onSuccess: (settings) =>
                    showToast(
                      settings.autoMergeEnabled
                        ? '자동 병합을 켰어요'
                        : '자동 병합을 껐어요',
                    ),
                  onError: () => showToast('자동 병합 설정을 저장하지 못했어요'),
                },
              );
            }}
          />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">수집·동기화</p>
        <div className="divide-y divide-orbit-border rounded-orbit-card border border-orbit-border bg-orbit-surface">
          <SettingRow
            label="탐색 기록 수집"
            description={
              collectionEnabled
                ? '방문한 페이지를 시간순으로 기록해요'
                : '켜면 방문한 페이지를 자동으로 기록해요 (opt-in, 기본 꺼짐)'
            }
            checked={collectionEnabled}
            onChange={(v) => {
              setCollectionEnabled(v);
              showToast(v ? '탐색 기록 수집을 켰어요' : '탐색 기록 수집을 껐어요');
            }}
          />

          <SettingRow
            label="자동 동기화"
            description="설정한 주기마다 자동으로 서버와 동기화해요"
            checked={autoSyncEnabled}
            onChange={(v) => {
              setAutoSyncEnabled(v);
              showToast(v ? '자동 동기화 켜짐' : '자동 동기화 꺼짐');
            }}
          />

          {autoSyncEnabled && (
            <IntervalRow value={autoSyncIntervalMin} onChange={setAutoSyncIntervalMin} />
          )}

          <NumberRow
            label="유휴 감지 기준"
            description="이 시간만큼 유휴 상태가 지속되면 동기화해요"
            value={idleSyncMin}
            onChange={setIdleSyncMin}
            min={1}
            max={120}
            suffix="분"
          />

          <NumberRow
            label="개수 기준"
            description="미처리 이벤트가 이 개수 이상 쌓이면 동기화해요"
            value={countThreshold}
            onChange={setCountThreshold}
            min={1}
            max={200}
            suffix="개"
          />

          <SettingRow
            label="본문 저장"
            description="AI 요약 품질을 위해 페이지 본문 일부를 저장해요"
            checked={contentCapture}
            onChange={(v) => {
              setContentCapture(v);
              showToast(v ? '본문 저장 켜짐' : '본문 저장 꺼짐');
            }}
          />

          <SettingRow
            label="민감 도메인 제외"
            description="은행·로그인 등 민감 페이지는 수집에서 제외"
            checked={excludeSensitive}
            onChange={(v) => {
              setExcludeSensitive(v);
              showToast(v ? '민감 도메인 제외 켜짐' : '민감 도메인 제외 꺼짐');
            }}
          />
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold text-orbit-muted">계정</p>
        <div className="divide-y divide-orbit-border rounded-orbit-card border border-orbit-border bg-orbit-surface">
          <InfoRow label="로그인 계정" value={session?.user.email ?? '—'} />
          <div className="p-3">
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full rounded-full border border-orbit-border px-3 py-2 text-xs font-medium text-orbit-danger transition hover:bg-orbit-danger-soft cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-orbit-muted">
        Orbit은 사용자의 브라우저 데이터를 다룹니다. 개인정보·민감정보 수집을 최소화하도록
        설계되었습니다.
      </p>
    </div>
  );
}
