import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, X } from 'lucide-react';
import { fetchTeamCollectExcluded, setCollectAllowed, updateTeamCollectExcluded } from '../../../../lib/api';
import { TEAM_COLLECT_DEFAULT_EXCLUSIONS } from '../../../../lib/sensitive-domains';
import { normalizeExcludedDomain, setExcludedDomains } from '../../../../lib/team-collect';
import type { Workspace } from '../../../../lib/types';
import { useAuth } from '../../../../lib/useAuth';
import { WORKSPACES_QUERY_KEY } from '../../../../lib/useWorkspaces';
import { Row, Section, Switch } from '../layout/SettingsPages';

const EXCLUDED_QUERY_KEY = ['settings', 'team-collect-excluded'] as const;

/**
 * 팀 설정의 `팀 수집` 절(설계 §8.1-6). owner 의 허용 스위치, 잠긴 기본 제외, 내 제외 목록.
 * 제외 목록은 계정 단위(모든 팀에 적용)이고 서버가 인제스트에서 같은 목록으로 다시 판정한다.
 */
export function TeamCollectSettings({ team }: { team: Workspace }) {
  const { session } = useAuth();
  const client = useQueryClient();
  const owner = team.role === 'owner';
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const allow = useMutation({
    mutationFn: (value: boolean) => setCollectAllowed(team.id, value),
    onSuccess: () => client.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  });
  const excluded = useQuery({ queryKey: EXCLUDED_QUERY_KEY, queryFn: () => fetchTeamCollectExcluded() });
  const save = useMutation({
    mutationFn: updateTeamCollectExcluded,
    onSuccess: async (domains) => {
      client.setQueryData(EXCLUDED_QUERY_KEY, domains);
      // 로컬 판정도 같은 목록을 쓰게 한다(서버가 최종 판정한다).
      if (session) await setExcludedDomains(session.user.id, domains);
    },
  });

  const add = () => {
    const domain = normalizeExcludedDomain(draft);
    if (!domain) {
      setInputError('사이트 주소를 확인해 주세요. 예: notion.so');
      return;
    }
    setInputError(null);
    const current = excluded.data ?? [];
    if (current.includes(domain)) {
      setDraft('');
      return;
    }
    if (current.length >= 200) {
      setInputError('제외 사이트는 200개까지 넣을 수 있어요.');
      return;
    }
    save.mutate([...current, domain], { onSuccess: () => setDraft('') });
  };

  return (
    <Section title="팀 수집">
      <Row
        label="팀 수집 허용"
        description={
          owner
            ? '켜면 팀원이 각자 시간을 정해 이 기기에서 연 페이지를 팀 기록으로 모을 수 있습니다. 끄면 지금 열린 수집이 모두 끝납니다.'
            : team.collectAllowed
              ? '소유자가 허용했습니다. 팀 화면에서 팀 수집을 시작할 수 있습니다.'
              : '소유자가 허용하면 켤 수 있습니다.'
        }
      >
        {owner && (
          <Switch
            checked={!!team.collectAllowed}
            label="팀 수집 허용"
            disabled={allow.isPending}
            onChange={(value) => allow.mutate(value)}
          />
        )}
      </Row>
      {allow.isError && <Row label="허용 설정을 저장하지 못했어요." description="잠시 뒤 다시 시도해 주세요." nested />}

      <Row label="기본 제외" description="개인정보 보호를 위해 늘 팀으로 보내지 않습니다. 해제할 수 없습니다." />
      {TEAM_COLLECT_DEFAULT_EXCLUSIONS.map((item) => (
        <Row key={item} label={item} nested>
          <span className="team-collect-locked" aria-label="잠김">
            <Lock size={13} aria-hidden="true" /> 잠김
          </span>
        </Row>
      ))}

      <Row label="내 제외 사이트" description="여기 넣은 사이트와 그 하위 주소는 팀으로 가지 않고 내 기록에만 남습니다. 모든 팀에 적용됩니다.">
        <form
          className="team-collect-exclude-form"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            value={draft}
            placeholder="예: notion.so"
            aria-label="제외할 사이트"
            aria-invalid={inputError ? true : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="settings-button settings-button--primary" disabled={save.isPending || !draft.trim()}>
            {save.isPending ? '저장 중…' : '추가'}
          </button>
        </form>
      </Row>
      {inputError && <p className="settings-error" role="alert">{inputError}</p>}
      {excluded.isPending && <Row label="제외 목록을 불러오는 중…" nested />}
      {excluded.isError && (
        <Row label="제외 목록을 불러오지 못했어요." nested>
          <button type="button" className="settings-button" onClick={() => void excluded.refetch()}>
            다시 시도
          </button>
        </Row>
      )}
      {excluded.isSuccess && excluded.data.length === 0 && <Row label="아직 넣은 사이트가 없습니다." nested />}
      {excluded.data?.map((domain) => (
        <Row key={domain} label={domain} nested>
          <button
            type="button"
            className="settings-button"
            aria-label={`${domain} 제외 해제`}
            disabled={save.isPending}
            onClick={() => save.mutate((excluded.data ?? []).filter((d) => d !== domain))}
          >
            <X size={13} aria-hidden="true" /> 빼기
          </button>
        </Row>
      ))}
      {save.isError && <p className="settings-error" role="alert">제외 목록을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
    </Section>
  );
}
