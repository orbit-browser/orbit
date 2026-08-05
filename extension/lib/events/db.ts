import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EventStatus, ExplorationEvent } from './types';

export interface OrbitDB extends DBSchema {
  events: {
    key: string;
    value: ExplorationEvent;
    indexes: {
      'by-status': EventStatus;
      'by-visitedAt': string;
    };
  };
}

const DB_NAME = 'orbit';
const DB_VERSION = 1;
export const EVENTS_STORE = 'events';

// lazy 싱글턴 — SW 컨텍스트 어디서 호출하든 같은 연결을 재사용한다.
let dbPromise: Promise<IDBPDatabase<OrbitDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OrbitDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OrbitDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(EVENTS_STORE, { keyPath: 'eventId' });
        store.createIndex('by-status', 'status');
        store.createIndex('by-visitedAt', 'visitedAt');
      },
    });
  }
  return dbPromise;
}
