import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EventStatus, ExplorationEvent } from './types';

export interface OrbitDB extends DBSchema {
  events: {
    key: string;
    value: ExplorationEvent;
    indexes: {
      'by-status': EventStatus;
      'by-visitedAt': string;
      'by-account-status': [string, EventStatus];
      'by-account-visitedAt': [string, string];
    };
  };
}

const DB_NAME = 'orbit';
const DB_VERSION = 2;
export const EVENTS_STORE = 'events';

// lazy 싱글턴 — SW 컨텍스트 어디서 호출하든 같은 연결을 재사용한다.
let dbPromise: Promise<IDBPDatabase<OrbitDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OrbitDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OrbitDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'eventId' });
          store.createIndex('by-status', 'status');
          store.createIndex('by-visitedAt', 'visitedAt');
        }
        if (oldVersion < 2) {
          const store = tx.objectStore(EVENTS_STORE);
          // v1 이벤트에는 계정이 없다. 지금 로그인한 계정에 붙이면 계정을 바꾼 브라우저에서 남의
          // 방문이 그 계정으로 올라가므로, 주인을 알 수 없는 로컬 큐는 비운다(synced는 서버에 있다).
          void store.clear();
          store.createIndex('by-account-status', ['accountId', 'status']);
          store.createIndex('by-account-visitedAt', ['accountId', 'visitedAt']);
        }
      },
    });
  }
  return dbPromise;
}
