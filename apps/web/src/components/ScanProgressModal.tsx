import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";
import { RadarMark } from "./BrandMarks";
import { copy } from "../copy";
import { SYNC_PROGRESS_EVENT } from "../state/ipcEvents";
import { useAppStore } from "../state/store";

interface ProgressPayload {
  name: string;
  stage: string;
  found: number;
  done: number;
}

/**
 * The core emits machine-checkable stage labels (`03` §B3). They are shown
 * as words, never as a staged animation: an unknown label falls through
 * verbatim rather than being dressed up as progress.
 */
const STAGE_LABELS: Record<string, string> = {
  connecting: "Connecting…",
  searching: "Searching…",
  fetching: "Fetching…",
  parsing: "Reading…",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function ScanProgressModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const syncProgressMessage = useAppStore((s) => s.syncProgressMessage);
  const syncOutcome = useAppStore((s) => s.syncOutcome);
  const cancelSync = useAppStore((s) => s.cancelSync);

  // One entry per source that actually reported progress. Nothing is added
  // until the backend says it ran.
  const [sources, setSources] = useState<Record<string, ProgressPayload>>({});
  const scanning = syncStatus === "syncing";

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setupListener() {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          const cleanup = await listen<ProgressPayload>(SYNC_PROGRESS_EVENT, (event) => {
            const payload = event.payload;
            setSources((prev) => ({ ...prev, [payload.name]: payload }));
          });
          unlisten = cleanup;
        } catch {
          // The desktop event bridge is unavailable: the overlay then shows
          // the outcome only — never an invented progress stage.
        }
      }
    }
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // A new scan starts from a clean slate.
  useEffect(() => {
    if (scanning) setSources({});
  }, [scanning]);

  // A finished scan (success or canceled) closes itself shortly after the
  // outcome renders, so the overlay never lingers over the app. While a scan
  // is running the TopBar keeps the overlay non-dismissible on purpose, so
  // Escape/backdrop can never hide a scan in flight; errors stay open until
  // the user reads and closes them.
  useEffect(() => {
    if (scanning || !syncOutcome) return;
    if (syncOutcome.status === "success" || syncOutcome.status === "canceled") {
      const t = setTimeout(() => onClose(), 2200);
      return () => clearTimeout(t);
    }
  }, [scanning, syncOutcome, onClose]);

  const sourceList = useMemo(() => Object.values(sources), [sources]);
  const totalFound = sourceList.reduce((sum, source) => sum + source.found, 0);
  const totalDone = sourceList.reduce((sum, source) => sum + source.done, 0);
  const percent = totalFound > 0 ? Math.min(100, Math.round((totalDone / totalFound) * 100)) : null;

  const outcome = scanning ? null : syncOutcome;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          {scanning ? (
            <RadarMark animated className="h-10 w-10 shrink-0 drop-shadow-sm" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
              {outcome?.status === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : outcome?.status === "canceled" ? (
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
            </div>
          )}
          <div>
            <h2 id="scan-progress-title" className="text-base font-bold text-[var(--text)]">
              {scanning
                ? copy.topBar.syncScanning
                : outcome?.status === "success"
                  ? copy.scan.scanComplete
                  : outcome?.status === "canceled"
                    ? copy.scan.scanCanceledTitle
                    : copy.scan.scanFailedTitle}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {scanning
                ? copy.scan.sourcesRunning(sourceList.length)
                : outcome?.status === "success"
                  ? copy.scan.scanSummary(outcome.totalNew, outcome.totalUpdated)
                  : outcome?.status === "canceled"
                    ? copy.topBar.syncCanceled
                    : outcome?.message || copy.scan.scanFailedTitle}
            </p>
          </div>
        </div>
        {!scanning && (
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.common.close}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {scanning ? (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
            <span>{syncProgressMessage || copy.scan.waitingForSources}</span>
            <span>
              {percent !== null ? `${totalDone}/${totalFound} items` : copy.scan.noItemsYet}
            </span>
          </div>

          {/* The bar shows a real ratio or nothing at all — it never invents
              a percentage for work that has not reported any count. */}
          <div className="w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--border)_40%,transparent)] h-2">
            {percent !== null ? (
              <div
                className="h-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="h-full w-full animate-pulse bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]" />
            )}
          </div>

          {sourceList.length > 0 && (
            <ul className="space-y-1.5 text-xs text-[var(--text-muted)]">
              {sourceList.map((source) => (
                <li key={source.name} className="flex items-center justify-between gap-3">
                  <span className="truncate text-[var(--text)]">{source.name}</span>
                  <span className="shrink-0">
                    {stageLabel(source.stage)}
                    {source.found > 0 ? ` · ${source.done}/${source.found}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : outcome ? (
        <div className="mt-6 space-y-3">
          {outcome.notes.length > 0 && (
            <ul className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--page)] p-3 text-xs text-[var(--text-muted)]">
              {outcome.notes.map((note, index) => (
                <li key={`${index}-${note}`}>• {note}</li>
              ))}
            </ul>
          )}
          {outcome.status === "canceled" && (
            <p className="text-xs text-[var(--text-muted)]">{copy.scan.cancelKeepsData}</p>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--text-muted)]">{copy.scan.noScanRunning}</p>
      )}

      <div className="mt-6 flex items-center justify-end">
        {scanning ? (
          <button
            type="button"
            onClick={() => {
              void cancelSync();
            }}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
          >
            {copy.common.cancel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
          >
            {copy.common.close}
          </button>
        )}
      </div>
    </div>
  );
}
