import type { UseQueryResult } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { apiBaseUrl } from '../../../../lib/api';
import type { OrbitSettings, OrbitTheme } from '../../../../lib/settings';
import type { ServerSettings } from '../../../../lib/types';
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
        <Row label="민감 도메인 제외" description="은행, 로그인 및 기타 민감한 페이지를 자동으로 제외합니다.">
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
          켠 뒤에도 민감 도메인은 제외됩니다. 수집한 내용은 사용자의 계정에만 연결됩니다.
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
  general: GeneralPage,
  collection: CollectionPage,
  session: SessionPage,
  ai: AiPage,
  privacy: PrivacyPage,
  data: DataPage,
  connection: ConnectionPage,
  about: AboutPage,
};
