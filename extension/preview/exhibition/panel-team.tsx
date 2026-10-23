/**
 * 오른쪽 벽 — TEAM. 위는 팀 워크스페이스, 아래는 심사위원을 위한 측정 방법.
 *
 * 화면 조각은 실제 UI 를 옮겼다: 사이드패널 설정 · 팀(TeamSettingsSection), 공유 시트(ShareSessionDialog),
 * 팀 범위 아틀라스의 "공유된 세션" 막대와 공유한 사람 이름표. 사람은 Orbit 말장난 별칭이다(DEMO_TEAM).
 * 측정 방법은 저장소의 평가 하네스(backend/eval)와 설정(backend/app/config.py)에서 확인한 것만 쓴다.
 * 결선 벤치마크의 조건은 metrics.json 의 method 에서 온다(측정 전 TBD).
 */
import { printable, sessionById } from './content';
import { BannerFrame, Favicon, PageShot } from './frame';
import { METRICS } from './metrics';

/** 팀 화면 시연 — 사람 이름 대신 Orbit 말장난 별칭을 쓴다(실존 인물로 읽히지 않게). */
const DEMO_TEAM = {
  members: ['오르빗', '위성', '궤도'],
  teams: [
    { name: '졸업 프로젝트 팀', role: '소유자', size: 3, hue: '#727bcb' },
    { name: '여행 동아리', role: '팀원', size: 2, hue: '#3aa09a' },
  ],
  invite: 'ORBT-7K2Q',
};

const POINTS = [
  // ShareSessionDialog — 세션마다 공유/해제, 공유 뒤 추가되는 페이지도 보인다
  ['공유할 세션은 내가 고릅니다', '세션마다 따로 공유합니다. 공유한 뒤 그 세션에 더해지는 페이지도 팀에 보입니다.'],
  // TeamSettingsSection · backend api/workspaces.py invite-code
  ['팀원은 초대 코드로 들어옵니다', '코드를 새로 만들면 이전 코드는 더 이상 쓸 수 없습니다.'],
  // backend api/search.py · api/ask.py workspace_id
  ['팀에서 찾으면 공유된 세션만 나옵니다', '검색도 Ask도 그 팀에 공유된 세션 안에서만 답합니다.'],
  // newtab 아틀라스 팀 범위 — 페이지마다 공유한 사람 이름
  ['누가 공유했는지 보입니다', '페이지 카드마다 공유한 사람의 이름이 붙습니다.'],
];

/** backend/eval 의 골든셋 크기(2026-10-20 저장소 기준) */
const HARNESS = [
  ['세션 묶기', '골든 시나리오 11개', 'append · create · hold · discard 판단'],
  ['검색', '세션 10개 · 질문 19개', '기록 있는 질문 14 · 없는 질문 5'],
  ['Ask 의도 나누기', '질문 42개', '탭 이동 · 세션 찾기 · 기록 내용 찾기'],
  ['열린 탭 찾기', '질문 21개', '열린 탭 후보 11개'],
];

/** backend/app/config.py 의 기준값과 그 근거(주석에 적힌 실측) */
const THRESHOLDS = [
  ['0.28', '검색 점수 기준', '검색 골든셋에서 정답 최저 0.289와 오답 최고 0.265 사이(2026-08-05)'],
  ['0.31', '주제 선분리', '세션 묶기 골든셋의 안전 구간 0.30–0.32 가운데'],
  ['0.52', '병합 제안', '실사용 18세션 153쌍에서 정답 최저 0.533과 오답 최고 0.44 사이(2026-08-07)'],
];

export function TeamBanner() {
  return (
    <BannerFrame step={4} label="현수막 — TEAM">
      <section className="ex-team__intro">
        <h1 className="ex-team__title">
          그 링크
          <br />
          누가 올렸더라?
        </h1>
        <p className="ex-team__sub">팀에 공유한 세션은 팀원 누구나 찾고, 누가 공유했는지도 보입니다. 내가&nbsp;고른 세션만 공유되고 나머지는 나만&nbsp;봅니다.</p>
      </section>

      <section className="ex-team__stage" aria-label="팀 화면">
        <ShareSheet />
        <TeamList />
        <TeamAtlas />
      </section>

      <ul className="ex-team__points">
        {POINTS.map(([head, text]) => (
          <li key={head}>
            <b>{head}</b>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <section className="ex-measure" aria-label="측정 방법">
        <div className="ex-section-head">
          <h2>How We Measure</h2>
          <span className="ex-status">저장소의 평가 하네스</span>
        </div>
        <div className="ex-measure__bench">
          <h3>결선 벤치마크 조건</h3>
          <div className="ex-method">
            {METRICS.method.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <b>{row.value ?? 'TBD'}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="ex-measure__grid">
          <div>
            <h3>골든셋</h3>
            {HARNESS.map(([name, size, detail]) => (
              <div key={name} className="ex-measure__row">
                <b>{name}</b>
                <span>{size}</span>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <div>
            <h3>기준값과 근거</h3>
            {THRESHOLDS.map(([value, name, detail]) => (
              <div key={name} className="ex-measure__row ex-measure__row--value">
                <em>{value}</em>
                <b>{name}</b>
                <small>{detail}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </BannerFrame>
  );
}

/** 공유 시트 — 실제 문구 */
function ShareSheet() {
  const jeju = sessionById('s-jeju');
  return (
    <div className="ex-layer ex-ui ex-ui--share">
      <div className="ex-ui__row">
        <b>팀에 공유</b>
        <i className="ph ph-x" />
      </div>
      <strong>{jeju.title}</strong>
      <p>팀원은 이 세션의 제목·요약·페이지 목록을 볼 수 있고, 페이지 본문 일부가 팀 Ask 답변의 근거로 쓰여요. 공유한 뒤 이 세션에 추가되는 페이지도 팀에 보여요.</p>
      {DEMO_TEAM.teams.map((team, index) => (
        <div key={team.name} className="ex-ui__team">
          <i style={{ background: team.hue }} />
          <span>{team.name}</span>
          {index === 0 ? <em>공유</em> : <small>공유 해제</small>}
        </div>
      ))}
    </div>
  );
}

/** 설정 · 팀 — 팀 목록과 초대 코드 */
function TeamList() {
  return (
    <div className="ex-layer ex-ui ex-ui--teams">
      <span className="ex-ui__label">팀</span>
      {DEMO_TEAM.teams.map((team) => (
        <div key={team.name} className="ex-ui__team">
          <i style={{ background: team.hue }} />
          <span>{team.name}</span>
          <small>
            {team.role} · {team.size}명
          </small>
        </div>
      ))}
      <div className="ex-ui__field">
        <span>받은 초대 코드</span>
        <em>참여</em>
      </div>
      <div className="ex-ui__code">
        초대 코드 <b>{DEMO_TEAM.invite}</b>
      </div>
    </div>
  );
}

/** 팀 범위 아틀라스 — 공유된 세션 막대와 공유한 사람 이름이 붙은 카드 */
function TeamAtlas() {
  const session = sessionById('s-mv3');
  // 한 세션은 한 사람이 공유한다 — 그 세션의 카드에는 모두 같은 이름이 붙는다(아틀라스와 같다)
  const sharer = DEMO_TEAM.members[1];
  // 화면을 뺀 페이지(빈 Stack Overflow)는 건너뛴다 — 카드 수와 위 줄의 점·글이 같다
  const cards = session.pages.filter(printable).slice(0, 3);
  return (
    <div className="ex-layer ex-ui ex-ui--atlas" style={{ ['--hue' as string]: session.hue }}>
      <div className="ex-ui__row">
        <span className="ex-ui__scope">
          <i style={{ background: DEMO_TEAM.teams[0].hue }} />
          {DEMO_TEAM.teams[0].name}
        </span>
        <span className="ex-ui__muted">공유된 세션 · 페이지 {cards.length}개</span>
      </div>
      <div className="ex-ui__rail">
        <b>{session.title}</b>
        <small>{sharer}</small>
        <span className="ex-ui__dots">
          {cards.map((page, index) => (
            <i key={page.id} className={index === 1 ? 'is-on' : undefined} />
          ))}
        </span>
      </div>
      <div className="ex-ui__cards">
        {cards.map((page) => (
          <div key={page.id} className="ex-ui__card">
            <div className="ex-ui__shot">
              <PageShot url={page.url} />
            </div>
            {/* 공유한 사람 이름은 아래 띠에 — 페이지 글자를 가리지 않는다 */}
            <span className="ex-ui__site">
              <Favicon url={page.url} domain={page.domain} />
              <span>{page.domain}</span>
              <span className="ex-ui__who">{sharer}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
