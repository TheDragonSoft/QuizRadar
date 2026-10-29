/**
 * Cross-tier IPC event names.
 *
 * The desktop shell emits these events; the web tier listens to them. The two
 * sides live in different packages, so the name is pinned here and asserted
 * against the shell's source in `syncProgressContract.test.ts` — the scan
 * overlay once listened for `sync-progress` while the shell emitted
 * `source-progress`, which froze the overlay on a stale stage for the whole
 * scan.
 */
export const SYNC_PROGRESS_EVENT = "sync-progress";
