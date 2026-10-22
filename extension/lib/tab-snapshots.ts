// 탭 화면 미리보기 저장소 — 기기 안 IndexedDB 에만 두고 서버로 보내지 않는다(CTO 결정 2026-10-23).
// 계정 귀속 큐(lib/events)와 같은 원칙: 행마다 accountId 를 싣고, 지금 로그인한 계정 것만 읽는다.
// 이벤트 DB 와 따로 둔다 — 사진은 크고 수명 규칙이 달라서 이벤트 DB 버전을 올릴 이유가 없다.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { updateSettings } from './settings';
import type { MemberBrief } from './types';

export interface TabSnapshot {
  /** `${accountId}\n${정규화 URL}` */
  id: string;
  accountId: string;
  url: string;
  /** 400px 폭 JPEG data URL */
  dataUrl: string;
  /** epoch ms */
  capturedAt: number;
}

interface SnapshotDB extends DBSchema {
  snapshots: {
    key: string;
    value: TabSnapshot;
    indexes: { 'by-account': string; 'by-capturedAt': number };
  };
}

const DB_NAME = 'orbit-snapshots';
const STORE = 'snapshots';
/** 개수 상한. 넘치면 가장 오래 찍은 것부터 지운다. */
export const SNAPSHOT_MAX_COUNT = 300;
/** 용량 상한(data URL 글자 수 기준, 대략 바이트). 400px JPEG 한 장은 보통 20~40KB 다. */
export const SNAPSHOT_MAX_BYTES = 15 * 1024 * 1024;

let dbPromise: Promise<IDBPDatabase<SnapshotDB>> | null = null;

function getSnapshotDB(): Promise<IDBPDatabase<SnapshotDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SnapshotDB>(DB_NAME, 2, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('by-account', 'accountId');
        // 상한 정리가 오래된 것부터 커서로 훑도록(전체를 메모리에 올리지 않게).
        if (oldVersion < 2) tx.objectStore(STORE).createIndex('by-capturedAt', 'capturedAt');
      },
    });
  }
  return dbPromise;
}

/** 같은 페이지로 볼 주소. 조각(#)만 다른 주소는 같은 화면이다. 판정할 수 없으면 null. */
export function snapshotKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

const rowId = (accountId: string, key: string) => `${accountId}\n${key}`;

/** 이 계정이 그 페이지를 마지막으로 찍은 시각. 없으면 null. */
export async function snapshotCapturedAt(accountId: string, rawUrl: string): Promise<number | null> {
  const key = snapshotKey(rawUrl);
  if (!key) return null;
  const row = await (await getSnapshotDB()).get(STORE, rowId(accountId, key));
  return row?.capturedAt ?? null;
}

/** 사진을 넣고(같은 페이지는 바꾼다) 상한을 넘으면 오래된 것부터 지운다. */
export async function putSnapshot(
  accountId: string,
  rawUrl: string,
  dataUrl: string,
  capturedAt = Date.now(),
): Promise<void> {
  const key = snapshotKey(rawUrl);
  if (!key) return;
  const db = await getSnapshotDB();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.put({ id: rowId(accountId, key), accountId, url: key, dataUrl, capturedAt });
  // 최신부터 한 장씩 훑어 상한 안에 드는 만큼 남기고, 넘친 뒤의 (더 오래된) 것은 모두 지운다.
  let count = 0;
  let bytes = 0;
  let cursor = await tx.store.index('by-capturedAt').openCursor(null, 'prev');
  while (cursor) {
    const size = cursor.value.dataUrl.length;
    if (count < SNAPSHOT_MAX_COUNT && bytes + size <= SNAPSHOT_MAX_BYTES) {
      count += 1;
      bytes += size;
    } else {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** 이 계정이 찍은 사진 중 주어진 페이지들의 것. 키는 정규화 URL 이다(`snapshotKey`). */
export async function loadSnapshots(accountId: string, rawUrls: readonly string[]): Promise<Record<string, string>> {
  const wanted = new Set(rawUrls.map(snapshotKey).filter((key): key is string => key !== null));
  if (wanted.size === 0) return {};
  const rows = await (await getSnapshotDB()).getAllFromIndex(STORE, 'by-account', accountId);
  const result: Record<string, string> = {};
  for (const row of rows) if (wanted.has(row.url)) result[row.url] = row.dataUrl;
  return result;
}

/** 이 계정의 사진을 모두 지운다(설정 "저장된 미리보기 지우기"). 지운 수를 돌려준다. */
export async function clearSnapshots(accountId: string): Promise<number> {
  const db = await getSnapshotDB();
  const tx = db.transaction(STORE, 'readwrite');
  const keys = await tx.store.index('by-account').getAllKeys(accountId);
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
  return keys.length;
}

/**
 * 지금 계정이 아닌 계정의 사진 중 `maxAgeMs` 보다 오래된 것을 지운다(큐의 `pruneOtherAccounts` 와 같은
 * 7일 규칙). 로그아웃 상태(null)면 모든 계정이 대상이다.
 */
export async function pruneOtherAccountSnapshots(currentAccountId: string | null, maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const db = await getSnapshotDB();
  const tx = db.transaction(STORE, 'readwrite');
  let deleted = 0;
  let cursor = await tx.store.index('by-capturedAt').openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    if (cursor.value.accountId !== currentAccountId) {
      await cursor.delete();
      deleted += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return deleted;
}

/**
 * 이 세션에 내 기기 사진을 붙여도 되는가. 개인 범위의 세션과, 팀 범위에서는 내가 공유한 세션만 된다 —
 * 남의 세션에 내 사진을 붙이면 그 사람이 본 화면처럼 보이고, 내 화면이 그 사람 세션에 섞인다.
 * 팀 범위에서 공유자를 아직 모르면(목록을 받기 전) 붙이지 않는다.
 */
export function canShowSnapshots(
  teamScope: boolean,
  sharedBy: MemberBrief | undefined,
  myUserId: string | null,
): boolean {
  if (!teamScope) return true;
  return myUserId !== null && sharedBy?.userId === myUserId;
}

/**
 * 화면을 찍으려면 `<all_urls>` 가 필요하다. 설치 때 받지 않고(optional_host_permissions) 사용자가 미리보기를
 * 켤 때만 받고, 끌 때 돌려준다(보안 검토 M1, CTO 2026-10-23).
 */
export const SNAPSHOT_PERMISSION: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

export async function hasSnapshotPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(SNAPSHOT_PERMISSION);
  } catch {
    return false;
  }
}

/**
 * 미리보기 켜기. 권한 요청은 사용자 조작 안에서만 되므로 클릭 처리기에서 곧바로 부른다(앞에 다른 await 없음).
 * 권한을 받았을 때만 켜고 true 를 돌려준다.
 */
export async function enableTabSnapshots(): Promise<boolean> {
  const granted = await chrome.permissions.request(SNAPSHOT_PERMISSION).catch(() => false);
  if (granted) await updateSettings({ tabSnapshotsEnabled: true });
  return granted;
}

/** 미리보기 끄기. 설정을 먼저 끄고(찍기·표시가 멈춘다) 권한을 돌려준다. 사진은 지우지 않는다(화면이 묻는다). */
export async function disableTabSnapshots(): Promise<void> {
  await updateSettings({ tabSnapshotsEnabled: false });
  await chrome.permissions.remove(SNAPSHOT_PERMISSION).catch(() => false);
}
