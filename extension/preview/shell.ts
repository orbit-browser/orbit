/** 미리보기 겉틀: 후보 이름, 사이드패널 토글, 데이터 초기화, 탭 열기 안내. */
const label = document.getElementById('variant')!;
label.textContent = `· ${import.meta.env.VITE_PREVIEW_LABEL ?? '현재 화면'}`;
document.title = `Orbit 미리보기 — ${import.meta.env.VITE_PREVIEW_LABEL ?? '현재 화면'}`;

// 주소 옵션: ?route=atlas&theme=dark&scope=w-capstone&panel=0 — 같은 화면을 다시 열거나 스크린샷을 찍을 때.
const params = new URLSearchParams(location.search);
const passOn = new URLSearchParams();
for (const key of ['theme', 'scope']) {
  const value = params.get(key);
  if (value !== null) passOn.set(key, value);
}
const query = passOn.toString() ? `?${passOn}` : '';
(document.getElementById('newtab') as HTMLIFrameElement).src = `./newtab.html${query}${params.get('route') === 'atlas' ? '#/orbit-atlas' : ''}`;
(document.getElementById('sidepanel') as HTMLIFrameElement).src = `./sidepanel.html${query}`;
if (params.get('panel') === '0') document.body.classList.add('no-panel');

const panelButton = document.getElementById('toggle-panel')!;
panelButton.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('no-panel');
  panelButton.textContent = hidden ? '사이드패널 보이기' : '사이드패널 숨기기';
});
if (document.body.classList.contains('no-panel')) panelButton.textContent = '사이드패널 보이기';

document.getElementById('reset')!.addEventListener('click', () => {
  Object.keys(localStorage).filter((key) => key.startsWith('orbit-preview:')).forEach((key) => localStorage.removeItem(key));
  for (const frame of document.querySelectorAll('iframe')) frame.contentWindow?.location.reload();
});

const toast = document.getElementById('toast')!;
let timer = 0;
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { kind?: string; what?: string; urls?: string[] };
  if (data?.kind !== 'orbit-preview:open') return;
  toast.textContent = `미리보기라 실제로 열지 않아요 — ${data.what}${data.urls?.[0] ? `: ${data.urls[0]}` : ''}`;
  toast.classList.add('show');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
});
