import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '../../../lib/api';
import { useUIStore } from '../store/ui';
import { useSettingsStore } from '../store/settings';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm">{label}</span>
      <span className="text-xs text-orbit-muted">{value}</span>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        'relative h-5 w-9 shrink-0 rounded-full transition ' +
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
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-orbit-muted">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function SettingsView() {
  const showToast = useUIStore((s) => s.showToast);
  const { rerankEnabled, excludeSensitive, setRerankEnabled, setExcludeSensitive } =
    useSettingsStore();

  const { data: isConnected, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: checkHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  const connectionLabel = isLoading ? '확인 중…' : isConnected ? '연결됨' : '미연결';

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-orbit-muted">설정</p>

      <div className="divide-y divide-orbit-border rounded-xl border border-orbit-border bg-orbit-surface">
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

        <SettingRow
          label="민감 도메인 제외"
          description="은행·로그인 등 민감 페이지는 수집에서 제외"
          checked={excludeSensitive}
          onChange={(v) => {
            setExcludeSensitive(v);
            showToast(v ? '민감 도메인 제외 켜짐' : '민감 도메인 제외 꺼짐');
          }}
        />

        <InfoRow label="단축키" value="Alt+Shift+O" />
        <InfoRow label="버전" value="0.0.1" />
      </div>

      <p className="text-[11px] leading-relaxed text-orbit-muted">
        Orbit은 사용자의 브라우저 데이터를 다룹니다. 개인정보·민감정보 수집을 최소화하도록
        설계되었습니다.
      </p>
    </div>
  );
}
