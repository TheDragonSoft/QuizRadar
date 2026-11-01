/**
 * In-memory IndexedDB mock for unit tests in Node/JSDOM environments.
 */
import { resetIdbForTests } from "../pwadapters/idbStore";

interface MockRequest<T = unknown> {
  result: T;
  onsuccess: ((ev: { target: MockRequest<T> }) => void) | null;
  onerror: ((ev: { target: MockRequest<T> }) => void) | null;
}

interface MockTx {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  objectStore: (name: string) => {
    getAll: () => MockRequest<unknown[]>;
    get: (key: unknown) => MockRequest<unknown>;
    put: (val: Record<string, unknown>) => MockRequest<void>;
    delete: (key: unknown) => MockRequest<void>;
    clear: () => MockRequest<void>;
  };
}

interface MockOpenDbRequest {
  result: unknown;
  onupgradeneeded: ((ev: { target: MockOpenDbRequest }) => void) | null;
  onsuccess: ((ev: { target: MockOpenDbRequest }) => void) | null;
  onerror: ((ev: { target: MockOpenDbRequest }) => void) | null;
}

export function setupMockIndexedDb(): () => void {
  const stores = new Map<string, Map<string, unknown>>();

  const mockDb = {
    objectStoreNames: {
      contains: () => true,
    },
    transaction: (storeNames: string | string[]): MockTx => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const n of names) {
        if (!stores.has(n)) stores.set(n, new Map());
      }

      const tx: MockTx = {
        oncomplete: null,
        onerror: null,
        objectStore: (name: string) => {
          const map = stores.get(name) || new Map<string, unknown>();
          return {
            getAll: (): MockRequest<unknown[]> => {
              const req: MockRequest<unknown[]> = {
                result: Array.from(map.values()),
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              }, 0);
              return req;
            },
            get: (key: unknown): MockRequest<unknown> => {
              const req: MockRequest<unknown> = {
                result: map.get(String(key)),
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              }, 0);
              return req;
            },
            put: (val: Record<string, unknown>): MockRequest<void> => {
              const key = val.id ?? val.key ?? val.assessment_id;
              map.set(String(key), val);
              const req: MockRequest<void> = {
                result: undefined,
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              }, 0);
              return req;
            },
            delete: (key: unknown): MockRequest<void> => {
              map.delete(String(key));
              const req: MockRequest<void> = {
                result: undefined,
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              }, 0);
              return req;
            },
            clear: (): MockRequest<void> => {
              map.clear();
              const req: MockRequest<void> = {
                result: undefined,
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                req.onsuccess?.({ target: req });
                tx.oncomplete?.();
              }, 0);
              return req;
            },
          };
        },
      };

      return tx;
    },
    createObjectStore: () => {},
  };

  const idb = {
    open: (): MockOpenDbRequest => {
      const req: MockOpenDbRequest = {
        result: mockDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };

  const globalScope = globalThis as unknown as { indexedDB?: unknown };
  const originalGlobalIdb = globalScope.indexedDB;
  globalScope.indexedDB = idb;
  resetIdbForTests();

  const windowScope =
    typeof window !== "undefined" ? (window as unknown as { indexedDB?: unknown }) : null;
  if (windowScope) {
    windowScope.indexedDB = idb;
  }

  return () => {
    resetIdbForTests();
    globalScope.indexedDB = originalGlobalIdb;
    if (windowScope) {
      windowScope.indexedDB = originalGlobalIdb;
    }
  };
}
