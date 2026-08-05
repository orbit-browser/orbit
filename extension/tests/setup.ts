// 전역 대역 설치 — lib 코드는 IndexedDB와 chrome.* 전역을 직접 사용한다.
import 'fake-indexeddb/auto';
import { fakeBrowser } from 'wxt/testing';

// fakeBrowser는 promise 스타일 storage/alarms를 구현하므로 MV3 chrome 전역을 대체할 수 있다.
(globalThis as { chrome?: unknown }).chrome = fakeBrowser;
