/**
 * Pure IndexedDB persistence for the QuizRadar PWA tier.
 * Schema version 1 matching SQLite SCHEMA_VERSION = 1 from core/src/store/db.rs.
 * Stores: courses, slots, assessments, topics_done, grades, events, feeds, config_kv, tokens_meta.
 */

import type {
  Assessment,
  Course,
  ScheduleData,
  ScheduleSlot,
  CustomCalendarEvent,
  FeedConfig,
} from "../state/types";
import { aliasDeep } from "../state/ipcShape";

export const IDB_DATABASE_NAME = "quizradar";
export const IDB_SCHEMA_VERSION = 5;

export interface IdbMigrationStep {
  version: number;
  description: string;
  migrate?: (db: IDBDatabase, tx?: IDBTransaction | null) => void;
}

export const IDB_MIGRATIONS: readonly IdbMigrationStep[] = [
  {
    version: 1,
    description: "initial_schema",
    migrate: (db) => {
      const initialStores: Record<string, string> = {
        courses: "id",
        slots: "id",
        assessments: "id",
        topics_done: "key",
        grades: "assessment_id",
        events: "id",
        feeds: "id",
        config_kv: "key",
        tokens_meta: "key",
        kv_meta: "key",
      };
      for (const [name, keyPath] of Object.entries(initialStores)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      }
    },
  },
  {
    version: 2,
    description: "source_provenance",
    // Assessments are schemaless JSON records in IndexedDB;
    // last_seen_source_run and retired_source_run properties persist on save.
  },
  {
    version: 3,
    description: "content_addressed_topic_keys",
    // Data migration performed idempotently via ensureTopicKeysContentAddressed().
  },
  {
    version: 4,
    description: "non_ai_suite_extensions",
    migrate: (db) => {
      const m4Stores = [
        "attendance",
        "flashcards",
        "quiz_attempts",
        "mistake_bank",
        "study_sessions",
      ] as const;
      for (const name of m4Stores) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    },
  },
  {
    version: 5,
    description: "cached_emails_and_ai_extractions",
    migrate: (db) => {
      if (!db.objectStoreNames.contains("cached_emails")) {
        db.createObjectStore("cached_emails", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("email_ai_extractions")) {
        db.createObjectStore("email_ai_extractions", { keyPath: "cache_key" });
      }
    },
  },
] as const;

export interface IdbGradeRecord {
  assessment_id: string;
  achieved_score?: number | null;
  max_score?: number | null;
  weightage_percent?: number | null;
  updated_at?: string;
}

export interface IdbTopicRecord {
  key: string;
  done: boolean;
  updated_at?: string;
}

export interface IdbConfigRecord {
  key: string;
  value: unknown;
}

export interface IdbTokenMetaRecord {
  key: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  scopes?: string[];
  updated_at?: string;
}

const STORE_NAMES = [
  "courses",
  "slots",
  "assessments",
  "topics_done",
  "grades",
  "events",
  "feeds",
  "config_kv",
  "tokens_meta",
  "kv_meta",
  "attendance",
  "flashcards",
  "quiz_attempts",
  "mistake_bank",
  "study_sessions",
  "cached_emails",
  "email_ai_extractions",
] as const;

type StoreName = (typeof STORE_NAMES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function resetIdbForTests(): void {
  dbPromise = null;
}

export function openIdb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      dbPromise = null;
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = indexedDB.open(IDB_DATABASE_NAME, IDB_SCHEMA_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction;
      const oldVersion = event.oldVersion;
      for (const step of IDB_MIGRATIONS) {
        if (step.version > oldVersion && step.version <= IDB_SCHEMA_VERSION) {
          step.migrate?.(db, tx);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      // Old connections blocking upgrade
      console.warn("IndexedDB upgrade blocked by open tab");
    };
  });

  return dbPromise;
}

export async function idbGetAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openIdb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Every single-op helper resolves on TRANSACTION COMMIT, not request success:
 * a request can succeed and the transaction still abort at commit (quota,
 * connection close), and resolving early would tell the caller a write
 * persisted when it was rolled back.
 */
export async function idbPut<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await openIdb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbDelete(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openIdb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbClear(storeName: StoreName): Promise<void> {
  const db = await openIdb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function idbResetAll(): Promise<void> {
  const db = await openIdb();
  // One transaction across every store: a per-store loop can half-complete
  // (quota, tab close mid-reset) and leave a corrupted hybrid database after
  // a destructive "Reset Everything" the user double-confirmed.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, "readwrite");
    for (const name of STORE_NAMES) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

// ---------------------------------------------------------------------------
// High-level Domain Store Helpers
// ---------------------------------------------------------------------------

export async function loadScheduleData(): Promise<ScheduleData> {
  const courses = await idbGetAll<Course>("courses");
  const slots = await idbGetAll<ScheduleSlot>("slots");
  const semesterRecord = await idbGet<IdbConfigRecord>("config_kv", "semester");
  return {
    semester: (semesterRecord?.value as string) || null,
    courses,
    // The stored slots may predate the snake_case twins (older browser
    // builds wrote camelCase only). Adding the twins here means every
    // consumer — the WASM core (snake_case) and the React views (camelCase)
    // — reads the same slot, whatever shape it was stored in.
    slots: aliasDeep(slots),
  };
}

export async function saveScheduleData(schedule: ScheduleData): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["courses", "slots", "config_kv"], "readwrite");
    const courseStore = tx.objectStore("courses");
    const slotStore = tx.objectStore("slots");
    const configStore = tx.objectStore("config_kv");

    courseStore.clear();
    for (const c of schedule.courses) {
      courseStore.put(c);
    }

    slotStore.clear();
    for (const s of schedule.slots) {
      slotStore.put(s);
    }

    if (schedule.semester !== undefined) {
      configStore.put({ key: "semester", value: schedule.semester });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function upsertCourse(course: Course): Promise<void> {
  await idbPut("courses", course);
}

export async function deleteCourse(courseId: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["courses", "slots"], "readwrite");
    const courseStore = tx.objectStore("courses");
    const slotStore = tx.objectStore("slots");

    courseStore.delete(courseId);

    // Delete associated slots
    const req = slotStore.getAll();
    req.onsuccess = () => {
      const slots = req.result as ScheduleSlot[];
      for (const slot of slots) {
        if (slot.courseId === courseId) {
          slotStore.delete(slot.id);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function loadAssessments(): Promise<Assessment[]> {
  return await idbGetAll<Assessment>("assessments");
}

export async function saveAssessments(assessments: Assessment[]): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assessments", "readwrite");
    const store = tx.objectStore("assessments");
    store.clear();
    for (const a of assessments) {
      store.put(a);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function upsertAssessment(assessment: Assessment): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assessments", "readwrite");
    const store = tx.objectStore("assessments");
    store.put(assessment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function deleteAssessment(id: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assessments", "readwrite");
    const store = tx.objectStore("assessments");
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Detects pre-v3 positional topic keys (e.g. `quiz-1::0`).
 * Content-addressed keys use an `h` prefix for the hash (e.g. `quiz-1::h7b4c8a1f`).
 */
export function isLegacyPositionalTopicKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  const lastSep = key.lastIndexOf("::");
  if (lastSep === -1) return false;
  const suffix = key.slice(lastSep + 2);
  return /^\d+$/.test(suffix);
}

export async function loadTopicsDone(): Promise<Record<string, boolean>> {
  const records = await idbGetAll<IdbTopicRecord>("topics_done");
  const map: Record<string, boolean> = {};
  for (const r of records) {
    if (r.done) {
      map[r.key] = true;
    }
  }
  return map;
}

/** Raw `topics_done` rows (migration input — keys may predate content addressing). */
export async function loadTopicRecords(): Promise<IdbTopicRecord[]> {
  return idbGetAll<IdbTopicRecord>("topics_done");
}

/**
 * One-transaction topic-key rewrite (the browser twin of SQLite migration 3):
 * deletes every key listed, puts the rewritten entries, and stamps the
 * `config_kv` marker — a half-applied key migration can never exist.
 */
export async function rewriteTopicKeys(
  removeKeys: string[],
  puts: IdbTopicRecord[],
  markerKey: string,
): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["topics_done", "config_kv"], "readwrite");
    const topics = tx.objectStore("topics_done");
    for (const key of removeKeys) {
      topics.delete(key);
    }
    for (const record of puts) {
      topics.put(record);
    }
    tx.objectStore("config_kv").put({ key: markerKey, value: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function setTopicDone(key: string, done: boolean): Promise<void> {
  if (done) {
    await idbPut("topics_done", { key, done: true, updated_at: new Date().toISOString() });
  } else {
    await idbDelete("topics_done", key);
  }
}

export async function loadGrades(): Promise<Record<string, IdbGradeRecord>> {
  const records = await idbGetAll<IdbGradeRecord>("grades");
  const map: Record<string, IdbGradeRecord> = {};
  for (const r of records) {
    map[r.assessment_id] = r;
  }
  return map;
}

export async function saveGrade(record: IdbGradeRecord): Promise<void> {
  await idbPut("grades", {
    ...record,
    updated_at: new Date().toISOString(),
  });
}

export async function loadCustomEvents(): Promise<CustomCalendarEvent[]> {
  return await idbGetAll<CustomCalendarEvent>("events");
}

export async function upsertCustomEvent(event: CustomCalendarEvent): Promise<void> {
  await idbPut("events", event);
}

export async function deleteCustomEvent(id: string): Promise<void> {
  await idbDelete("events", id);
}

export async function loadFeeds(): Promise<FeedConfig[]> {
  return await idbGetAll<FeedConfig>("feeds");
}

export async function upsertFeed(feed: FeedConfig): Promise<void> {
  await idbPut("feeds", feed);
}

export async function deleteFeed(id: string): Promise<void> {
  await idbDelete("feeds", id);
}

export async function getConfigValue<T>(key: string, fallback: T): Promise<T> {
  const record = await idbGet<IdbConfigRecord>("config_kv", key);
  if (!record || record.value === undefined || record.value === null) {
    return fallback;
  }
  return record.value as T;
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  await idbPut("config_kv", { key, value });
}

export async function loadAllConfig(): Promise<Record<string, unknown>> {
  const records = await idbGetAll<IdbConfigRecord>("config_kv");
  const config: Record<string, unknown> = {};
  for (const r of records) {
    config[r.key] = r.value;
  }
  return config;
}
