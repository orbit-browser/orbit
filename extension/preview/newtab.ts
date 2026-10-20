import './boot';
import { setPageShots } from '../entrypoints/newtab/components/atlas/page-shots';

// 아틀라스 카드의 실제 페이지 화면(capture-shots.mjs 가 찍는다). 없으면 카드가 회색 자리표시로 그린다.
const shots = (await fetch(new URL('./shots/index.json', location.href))
  .then((response) => (response.ok ? response.json() : {}))
  .catch(() => ({}))) as Record<string, string>;
setPageShots(Object.fromEntries(Object.entries(shots).map(([url, path]) => [url, new URL(path, location.href).href])));

await import('../entrypoints/newtab/main');
