import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { apiBaseUrl } from '../../../../lib/api';
import type { OrbitSettings, OrbitTheme } from '../../../../lib/settings';
import type { ServerSettings, Workspace } from '../../../../lib/types';
import { useAuth } from '../../../../lib/useAuth';
import { useActiveWorkspace } from '../../../../lib/useWorkspaces';
import { useWorkspaceMembers, useWorkspaceMutations } from '../../../sidepanel/hooks/useWorkspaces';
import type { SettingsPageId } from './settings-nav';

/*
 * 설정 페이지의 공용 부품.
 *
 * 대부분의 설정은 캔버스 위에 얇은 구분선으로만 나뉜 채 놓인다. 카드는 묶음이나 상태를
 * 따로 말해야 할 때만 쓴다 — 모든 줄을 카드로 만들면 위계가 사라진다.
 */

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="settings-page__head">
      <h2 className="settings-page__title">{title}</h2>
      <p className="settings-page__lead">{description}</p>
    </header>
  );
}

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h3 className="settings-section__title">{title}</h3>}
      <div className="settings-section__rows">{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
  nested = false,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
  /** 상위 설정이 켜졌을 때만 드러나는 세부 항목. 한 단계 들여 쓴다. */
  nested?: boolean;
}) {
  return (
    <div className={`settings-row${nested ? ' settings-row--nested' : ''}`}>
      <div className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        {description && <span className="settings-row__desc">{description}</span>}
      </div>
      {children && <div className="settings-row__control">{children}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`settings-switch${checked ? ' settings-switch--on' : ''}`}
    >
      <span className="settings-switch__knob" />
    </button>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix: string;
  label: string;
}) {
  return (
    <div className="settings-stepper">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
        }}
      />
      <span>{suffix}</span>
    </div>
  );
}

export function Value({ children }: { children: React.ReactNode }) {
  return <span className="settings-value">{children}</span>;
}

function Status({ state, children }: { state: 'on' | 'off' | 'idle'; children: React.ReactNode }) {
  return (
    <span className={`settings-status settings-status--${state}`}>
      <span className="settings-status__dot" />
      {children}
    </span>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────

interface PageProps {
  settings: OrbitSettings;
  patch: (partial: Partial<OrbitSettings>) => void;
  health: UseQueryResult<boolean>;
  serverSettings: UseQueryResult<ServerSettings>;
  saveServerSettings: (patch: Partial<ServerSettings>) => void;
  serverBusy: boolean;
  account: string | null;
  onSignOut: () => void;
  onNavigate: (page: SettingsPageId) => void;
  /** 워크스페이스 페이지가 처음 보여 줄 워크스페이스. undefined 면 지금 보고 있는 곳, null 이면 내 Orbit. */
  workspaceId?: string | null;
}

/** 개인 워크스페이스의 보이는 이름 — 비워 두면 "내 Orbit". */
export const personalName = (settings: OrbitSettings) => settings.personalWorkspaceName?.trim() || '내 Orbit';

/** 입력을 마치면(엔터·포커스 이동) 저장하는 이름 칸. 빈 값이면 원래 이름으로 돌아간다. */
function NameField({
  value,
  placeholder,
  onSave,
  disabled = false,
  status = null,
}: {
  value: string;
  placeholder: string;
  onSave: (name: string) => void;
  disabled?: boolean;
  /** 저장 버튼이 없는 칸이라 저장됐는지를 옆에 보여 준다. */
  status?: 'saving' | 'saved' | null;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onSave(next);
  };
  return (
    <span className="settings-name">
    <input
      className="settings-input"
      value={draft}
      placeholder={placeholder}
      maxLength={60}
      disabled={disabled}
      aria-label="워크스페이스 이름"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
      <span className="settings-saved" role="status" data-state={status ?? 'idle'}>
        {status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨' : '엔터로 저장'}
      </span>
    </span>
  );
}

/**
 * 워크스페이스 설정 — 내 Orbit 은 이름만, 팀은 이름·초대·멤버·나가기(삭제)를 다룬다.
 * 이름 바꾸기·초대·내보내기·삭제는 소유자만 한다(서버 규칙과 같다). 멤버는 보기와 나가기만.
 */
function WorkspacePage({ settings, patch, workspaceId }: PageProps) {
  const { workspaces, scopeId } = useActiveWorkspace();
  const [personalSaved, setPersonalSaved] = useState(false);
  // 칩을 고르기 전에는 지금 범위를 따른다. 저장된 범위는 마운트 뒤에 비동기로 읽히므로 초기값으로 굳히면
  // 늘 내 Orbit 으로 열린다.
  const [picked, setPicked] = useState<string | null | undefined>(workspaceId);
  const targetId = picked === undefined ? scopeId : picked;
  const team = targetId ? workspaces.find((workspace) => workspace.id === targetId) ?? null : null;

  return (
    <>
      <PageHeader
        title="워크스페이스"
        description="내 Orbit과 팀 워크스페이스의 이름, 초대, 멤버를 관리합니다."
      />

      <div className="settings-chips" role="tablist" aria-label="설정할 워크스페이스">
        {[{ id: null as string | null, name: personalName(settings) }, ...workspaces].map((space) => (
          <button
            key={space.id ?? 'me'}
            type="button"
            role="tab"
            aria-selected={space.id === (team?.id ?? null)}
            className={`settings-chip${space.id === (team?.id ?? null) ? ' settings-chip--on' : ''}`}
            onClick={() => setPicked(space.id)}
          >
            {space.name}
          </button>
        ))}
      </div>

      {team ? (
        <TeamSettings
          key={team.id}
          team={team}
          // 지금 범위를 개인으로 돌리는 일은 공용 훅이 한다(useWorkspaceMutations).
          onGone={() => setPicked(null)}
        />
      ) : (
        <Section title="내 Orbit">
          <Row label="이름" description="나만 보는 개인 기록의 이름입니다. 비워 두면 “내 Orbit”으로 보입니다.">
            <NameField
              key={settings.personalWorkspaceName ?? ''}
              value={settings.personalWorkspaceName ?? ''}
              placeholder="내 Orbit"
              status={personalSaved ? 'saved' : null}
              onSave={(name) => {
                patch({ personalWorkspaceName: name || null });
                setPersonalSaved(true);
              }}
            />
          </Row>
          <Row label="공개 범위">
            <Value>나만 봅니다</Value>
          </Row>
        </Section>
      )}

      {!team && <StartTeam onReady={(id) => setPicked(id)} />}
    </>
  );
}

/**
 * 내 Orbit 페이지의 다음 행동 — 팀을 만들거나 초대 코드로 들어간다. 프로필 메뉴의 같은 동작과
 * 같은 공용 훅을 쓰고, 성공하면 그 팀으로 옮겨 가 설정을 이어서 보여 준다.
 */
function StartTeam({ onReady }: { onReady: (workspaceId: string) => void }) {
  const { select } = useActiveWorkspace();
  const { create, join } = useWorkspaceMutations();
  const [form, setForm] = useState<'create' | 'join' | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || join.isPending;

  const submit = () => {
    const value = draft.trim();
    if (!value) {
      setError(form === 'create' ? '이름을 입력해 주세요.' : '초대 코드를 입력해 주세요.');
      return;
    }
    setError(null);
    const onSuccess = (workspace: Workspace) => {
      select(workspace.id);
      onReady(workspace.id);
    };
    if (form === 'create') {
      create.mutate(value, { onSuccess, onError: () => setError('만들지 못했어요. 잠시 뒤 다시 시도해 주세요.') });
    } else {
      join.mutate(value, { onSuccess, onError: () => setError('코드가 맞지 않거나 만료됐어요.') });
    }
  };

  const open = (next: 'create' | 'join') => {
    setForm(next);
    setDraft('');
    setError(null);
  };

  return (
    <Section title="팀과 함께 쓰기">
      <Row label="팀 워크스페이스" description="세션을 팀에 공유하고 함께 찾아봅니다. 내 Orbit의 기록은 공유하기 전까지 나만 봅니다.">
        <span className="settings-invite">
          <button
            type="button"
            className={`settings-button settings-button--primary${form === 'create' ? ' settings-button--on' : ''}`}
            aria-expanded={form === 'create'}
            onClick={() => open('create')}
          >
            새 팀 워크스페이스 만들기
          </button>
          <button
            type="button"
            className={`settings-button${form === 'join' ? ' settings-button--on' : ''}`}
            aria-expanded={form === 'join'}
            onClick={() => open('join')}
          >
            초대 코드로 참여
          </button>
        </span>
      </Row>
      {form && (
        <Row label={form === 'create' ? '새 팀 이름' : '초대 코드'} nested>
          <span className="settings-name settings-reveal">
            <input
              className="settings-input"
              value={draft}
              placeholder={form === 'create' ? '예: 졸업 프로젝트 팀' : '받은 코드를 붙여 넣으세요'}
              maxLength={form === 'create' ? 60 : 64}
              autoFocus
              disabled={pending}
              aria-label={form === 'create' ? '새 팀 이름' : '초대 코드'}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setForm(null);
              }}
            />
            <button type="button" className="settings-button settings-button--primary" disabled={pending} onClick={submit}>
              {pending ? (form === 'create' ? '만드는 중…' : '참여하는 중…') : form === 'create' ? '만들기' : '참여'}
            </button>
          </span>
        </Row>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

function TeamSettings({ team, onGone }: { team: Workspace; onGone: () => void }) {
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const owner = team.role === 'owner';
  const members = useWorkspaceMembers(team.id);
  const mutations = useWorkspaceMutations();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  /** 두 번 눌러야 실행되는 위험한 동작 — 어떤 것을 확인 중인지 */
  const [confirming, setConfirming] = useState<string | null>(null);
  const failed = [mutations.rename, mutations.issueInvite, mutations.removeMember, mutations.remove].find(
    (mutation) => mutation.isError,
  );

  return (
    <>
      <Section title="기본 정보">
        <Row label="이름" description={owner ? undefined : '이름은 소유자만 바꿀 수 있습니다.'}>
          <NameField
            key={team.name}
            value={team.name}
            placeholder="내 Orbit"
            disabled={!owner || mutations.rename.isPending}
            status={mutations.rename.isPending ? 'saving' : mutations.rename.isSuccess ? 'saved' : null}
            onSave={(name) => {
              if (name) mutations.rename.mutate({ workspaceId: team.id, name });
            }}
          />
        </Row>
        <Row label="내 역할">
          <Value>{owner ? '소유자' : '멤버'}</Value>
        </Row>
      </Section>

      <Section title="초대">
        {owner ? (
          <Row
            label="초대 코드"
            description={
              confirming === 'reissue'
                ? '이전 코드는 더 이상 쓸 수 없어요. 이미 보낸 코드로는 참여할 수 없습니다.'
                : '코드를 받은 사람은 프로필 메뉴의 “초대 코드로 참여”에서 이 팀에 들어옵니다. 새로 만들면 이전 코드는 더 이상 쓸 수 없어요.'
            }
          >
            <span className="settings-invite">
              {invite && (
                <>
                  <code>{invite.code}</code>
                  <button
                    type="button"
                    className="settings-button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(invite.code).then(() => setCopied(true));
                    }}
                  >
                    {copied ? '복사됨' : '복사'}
                  </button>
                </>
              )}
              <button
                type="button"
                className={`settings-button ${invite ? '' : 'settings-button--primary'}${confirming === 'reissue' ? ' settings-button--danger' : ''}`}
                disabled={mutations.issueInvite.isPending}
                onClick={() => {
                  // 이미 코드를 보냈을 수 있으니 새로 만들 때는 한 번 더 확인한다(이전 코드가 바로 무효가 된다).
                  if (invite && confirming !== 'reissue') {
                    setConfirming('reissue');
                    return;
                  }
                  setConfirming(null);
                  mutations.issueInvite.mutate(team.id, {
                    onSuccess: (code) => {
                      setInvite(code);
                      setCopied(false);
                    },
                  });
                }}
              >
                {mutations.issueInvite.isPending
                  ? '만드는 중…'
                  : confirming === 'reissue'
                    ? '한 번 더 누르면 새 코드를 만듭니다'
                    : invite
                      ? '새 코드 만들기'
                      : '초대 코드 만들기'}
              </button>
            </span>
          </Row>
        ) : (
          <Row label="초대 코드" description="초대는 소유자만 할 수 있습니다." />
        )}
        {invite && (
          <Row label="만료" nested>
            <Value>{new Date(invite.expiresAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</Value>
          </Row>
        )}
      </Section>

      <Section title={`멤버 ${members.data ? members.data.length : team.memberCount}명`}>
        {members.isPending && <Row label="멤버를 불러오는 중…" />}
        {members.isError && <Row label="멤버를 불러오지 못했어요." description="잠시 뒤 다시 열어 주세요." />}
        {members.data?.map((member) => {
          const key = `kick-${member.userId}`;
          return (
            <Row
              key={member.userId}
              label={`${member.name ?? '이름 없음'}${member.userId === me ? ' (나)' : ''}`}
              description={[member.role === 'owner' ? '소유자' : '멤버', member.email].filter(Boolean).join(' · ')}
            >
              {owner && member.userId !== me && (
                <button
                  type="button"
                  className={`settings-button${confirming === key ? ' settings-button--danger' : ''}`}
                  disabled={mutations.removeMember.isPending}
                  onClick={() => {
                    if (confirming !== key) {
                      setConfirming(key);
                      return;
                    }
                    setConfirming(null);
                    mutations.removeMember.mutate({ workspaceId: team.id, userId: member.userId });
                  }}
                >
                  {confirming === key ? '한 번 더 누르면 내보냅니다' : '내보내기'}
                </button>
              )}
            </Row>
          );
        })}
      </Section>

      {failed && <p className="settings-error" role="alert">요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}

      <button
        type="button"
        className="settings-danger-button"
        disabled={mutations.remove.isPending || mutations.removeMember.isPending}
        onClick={() => {
          const key = owner ? 'delete' : 'leave';
          if (confirming !== key) {
            setConfirming(key);
            return;
          }
          setConfirming(null);
          if (owner) mutations.remove.mutate(team.id, { onSuccess: onGone });
          else mutations.removeMember.mutate({ workspaceId: team.id, userId: me }, { onSuccess: onGone });
        }}
      >
        {confirming === (owner ? 'delete' : 'leave')
          ? owner
            ? '한 번 더 누르면 워크스페이스를 삭제합니다'
            : '한 번 더 누르면 워크스페이스에서 나갑니다'
          : owner
            ? '워크스페이스 삭제'
            : '워크스페이스 나가기'}
      </button>
      <p className="settings-footnote">
        {owner
          ? '삭제하면 팀과 공유 관계만 사라집니다. 공유됐던 세션은 각자의 내 Orbit에 그대로 남습니다.'
          : '나가면 내가 공유한 세션의 공유가 풀립니다. 내 세션은 내 Orbit에 그대로 남습니다.'}
      </p>
    </>
  );
}

function connectionState(health: PageProps['health']) {
  if (health.isLoading) return { state: 'idle' as const, label: '확인 중…' };
  return health.data
    ? { state: 'on' as const, label: '연결됨' }
    : { state: 'off' as const, label: '미연결' };
}

const THEMES: { id: OrbitTheme; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: '시스템 설정 따르기', Icon: Monitor },
  { id: 'light', label: '라이트', Icon: Sun },
  { id: 'dark', label: '다크', Icon: Moon },
];

function GeneralPage({ settings, patch, health }: PageProps) {
  const connection = connectionState(health);
  return (
    <>
      <PageHeader title="일반" description="Orbit의 기본 동작과 환경을 설정합니다." />

      <Section title="환경설정">
        <Row label="모양" description="시스템을 고르면 OS 설정을 따라 자동으로 바뀝니다.">
          <div className="settings-theme">
            {THEMES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={settings.theme === id}
                className={settings.theme === id ? 'settings-theme--on' : undefined}
                onClick={() => patch({ theme: id })}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="백엔드 연결">
        <Row label="연결 상태">
          <Status state={connection.state}>{connection.label}</Status>
        </Row>
      </Section>

      <Section title="단축키">
        <Row label="Orbit 열기">
          <kbd className="settings-kbd">Alt + Shift + O</kbd>
        </Row>
      </Section>

      <Section title="앱 정보">
        <Row label="버전">
          <Value>0.0.1</Value>
        </Row>
      </Section>
    </>
  );
}

function CollectionPage({ settings, patch }: PageProps) {
  return (
    <>
      <PageHeader
        title="수집 및 동기화"
        description="브라우징 데이터를 Orbit에 기록하고 동기화하는 방식을 설정합니다."
      />

      <Section title="탐색 기록">
        <Row label="탐색 기록 수집" description="방문한 페이지와 탐색 흐름을 기록합니다.">
          <Switch
            label="탐색 기록 수집"
            checked={settings.collectionEnabled}
            onChange={(collectionEnabled) => patch({ collectionEnabled })}
          />
        </Row>
        <Row label="본문 저장" description="AI 검색과 세션 요약을 위해 필요한 페이지 내용을 저장합니다.">
          <Switch
            label="본문 저장"
            checked={settings.contentCapture}
            onChange={(contentCapture) => patch({ contentCapture })}
          />
        </Row>
        <Row label="민감 도메인 제외" description="은행·로그인 등 민감한 페이지는 본문을 저장하지 않습니다. 방문(제목·주소)은 기록됩니다.">
          <Switch
            label="민감 도메인 제외"
            checked={settings.excludeSensitive}
            onChange={(excludeSensitive) => patch({ excludeSensitive })}
          />
        </Row>
      </Section>

      <Section title="동기화">
        <Row label="자동 동기화" description="설정한 조건에 따라 데이터를 서버와 동기화합니다.">
          <Switch
            label="자동 동기화"
            checked={settings.autoSyncEnabled}
            onChange={(autoSyncEnabled) => patch({ autoSyncEnabled })}
          />
        </Row>

        {/* 조건이 꺼져 있으면 그 조건의 세부값은 물어볼 이유가 없다. */}
        {settings.autoSyncEnabled && (
          <>
            <Row label="동기화 주기" nested>
              <div className="settings-segment">
                {([15, 30, 60] as const).map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={
                      settings.autoSyncIntervalMin === minutes ? 'settings-segment--on' : undefined
                    }
                    onClick={() => patch({ autoSyncIntervalMin: minutes })}
                  >
                    {minutes}분
                  </button>
                ))}
              </div>
            </Row>
            <Row label="유휴 감지 기준" nested>
              <Stepper
                label="유휴 감지 기준"
                value={settings.idleSyncMin}
                onChange={(idleSyncMin) => patch({ idleSyncMin })}
                min={1}
                max={120}
                suffix="분"
              />
            </Row>
            <Row label="이벤트 개수 기준" nested>
              <Stepper
                label="이벤트 개수 기준"
                value={settings.countThreshold}
                onChange={(countThreshold) => patch({ countThreshold })}
                min={1}
                max={200}
                suffix="개"
              />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}

function SessionPage({ serverSettings, saveServerSettings, serverBusy }: PageProps) {
  return (
    <>
      <PageHeader
        title="세션 및 검색"
        description="Orbit이 탐색 기록을 세션으로 구성하는 방식을 설정합니다."
      />

      <Section title="세션 구성">
        <Row
          label="자동 병합"
          description={
            serverSettings.isError
              ? '서버 설정을 불러오지 못했습니다.'
              : '서로 연관된 탐색 세션을 자동으로 하나의 흐름으로 병합합니다.'
          }
        >
          <Switch
            label="자동 병합"
            checked={serverSettings.data?.autoMergeEnabled ?? false}
            disabled={serverBusy}
            onChange={(autoMergeEnabled) => saveServerSettings({ autoMergeEnabled })}
          />
        </Row>
      </Section>

      <p className="settings-note">
        세션 이름 변경과 폴더 정리는 대시보드의 네비게이터에서 할 수 있습니다.
      </p>
    </>
  );
}

function AiPage({ settings, patch }: PageProps) {
  return (
    <>
      <PageHeader title="AI" description="Orbit이 AI를 쓰는 방식을 설정합니다." />

      <Section title="검색">
        <Row
          label="더 정확한 결과 보기"
          description="AI가 검색 결과를 다시 정렬합니다. 응답이 1–2초 늦어집니다."
        >
          <Switch
            label="더 정확한 결과 보기"
            checked={settings.rerankEnabled}
            onChange={(rerankEnabled) => patch({ rerankEnabled })}
          />
        </Row>
      </Section>

      <Section title="AI가 쓰이는 곳">
        <Row label="세션 요약" description="탐색 흐름을 읽어 세션 제목과 요약을 만듭니다." />
        <Row label="세션화" description="이벤트를 주제별 세션으로 묶습니다." />
        <Row label="Ask AI" description="저장된 세션을 근거로 질문에 답합니다." />
      </Section>
    </>
  );
}

function PrivacyPage({ settings, onNavigate }: PageProps) {
  return (
    <>
      <PageHeader
        title="개인정보 보호"
        description="Orbit이 무엇을 저장하고 무엇을 저장하지 않는지 확인합니다."
      />

      <div className="settings-callout">
        <p>
          Orbit은 사용자의 브라우저 데이터를 다룹니다. 탐색 기록 수집은 기본적으로 꺼져 있고,
          켠 뒤에도 민감한 페이지는 본문 없이 방문(제목·주소)만 남습니다. 수집한 내용은 사용자의 계정에만 연결됩니다.
        </p>
      </div>

      <Section title="현재 상태">
        <Row label="탐색 기록 수집">
          <Status state={settings.collectionEnabled ? 'on' : 'off'}>
            {settings.collectionEnabled ? '켜짐' : '꺼짐'}
          </Status>
        </Row>
        <Row label="민감 도메인 제외">
          <Status state={settings.excludeSensitive ? 'on' : 'off'}>
            {settings.excludeSensitive ? '적용 중' : '해제됨'}
          </Status>
        </Row>
        <Row label="본문 저장">
          <Status state={settings.contentCapture ? 'on' : 'off'}>
            {settings.contentCapture ? '켜짐' : '꺼짐'}
          </Status>
        </Row>
      </Section>

      <button
        type="button"
        className="settings-link-button"
        onClick={() => onNavigate('collection')}
      >
        수집 및 동기화에서 변경
      </button>
    </>
  );
}

function DataPage({ account, onSignOut }: PageProps) {
  return (
    <>
      <PageHeader
        title="데이터 관리"
        description="Orbit에 저장된 데이터와 계정을 관리합니다."
      />

      <Section title="계정">
        <Row label="로그인 계정">
          <Value>{account ?? '—'}</Value>
        </Row>
      </Section>

      <Section title="저장된 데이터">
        <Row
          label="세션과 페이지"
          description="세션은 대시보드에서 하나씩 삭제할 수 있습니다. 삭제하면 그 세션의 요약과 검색 색인도 함께 지워집니다."
        />
        <Row
          label="로컬 대기열"
          description="아직 서버로 보내지 않은 이벤트는 브라우저에만 있습니다. 동기화하면 비워집니다."
        />
      </Section>

      <button type="button" className="settings-danger-button" onClick={onSignOut}>
        로그아웃
      </button>
    </>
  );
}

function ConnectionPage({ health }: PageProps) {
  const connection = connectionState(health);
  return (
    <>
      <PageHeader title="연결" description="Orbit이 붙어 있는 서버를 확인합니다." />

      <Section title="백엔드">
        <Row label="상태">
          <Status state={connection.state}>{connection.label}</Status>
        </Row>
        <Row label="주소">
          <Value>{apiBaseUrl}</Value>
        </Row>
      </Section>

      <button
        type="button"
        className="settings-link-button"
        onClick={() => void health.refetch()}
        disabled={health.isFetching}
      >
        {health.isFetching ? '확인 중…' : '다시 확인'}
      </button>

      {!health.isLoading && !health.data && (
        <p className="settings-note">
          서버가 꺼져 있으면 세션 저장과 검색이 동작하지 않습니다. 로컬에 쌓인 이벤트는
          연결이 돌아오면 다시 전송됩니다.
        </p>
      )}
    </>
  );
}

function AboutPage() {
  return (
    <>
      <PageHeader title="정보" description="Orbit에 대해." />

      <div className="settings-callout">
        <p>
          Orbit은 브라우저 탐색을 상시 기록해 세션으로 다시 엮는 Personal Exploration Memory
          입니다. 흩어진 탭과 검색을 하나의 흐름으로 되돌려 놓는 것을 목표로 합니다.
        </p>
      </div>

      <Section title="버전">
        <Row label="Orbit">
          <Value>0.0.1</Value>
        </Row>
        <Row label="단축키">
          <kbd className="settings-kbd">Alt + Shift + O</kbd>
        </Row>
      </Section>
    </>
  );
}

export const SETTINGS_PAGES: Record<SettingsPageId, (props: PageProps) => React.ReactElement> = {
  workspace: WorkspacePage,
  general: GeneralPage,
  collection: CollectionPage,
  session: SessionPage,
  ai: AiPage,
  privacy: PrivacyPage,
  data: DataPage,
  connection: ConnectionPage,
  about: AboutPage,
};
