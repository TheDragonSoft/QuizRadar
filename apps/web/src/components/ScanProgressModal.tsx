import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";

interface ProgressPayload {
  name: string;
  stage: string;
  found: number;
  done: number;
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

  const [progress, setProgress] = useState<ProgressPayload>({
    name: "Scanning Sources",
    stage: "Connecting…",
    found: 0,
    done: 0,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setupListener() {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          const cleanup = await listen<ProgressPayload>("sync-progress", (event) => {
            setProgress(event.payload);
          });
          unlisten = cleanup;
        } catch {
          // ignore
        }
      }
    }
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-progress-title"
      className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <div>
            <h2 id="scan-progress-title" className="text-base font-bold text-[var(--text)]">
              {copy.topBar.syncScanning}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {progress.name} · {progress.stage}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
          <span>{syncProgressMessage || progress.stage}</span>
          <span>
            {progress.found > 0 ? `${progress.done}/${progress.found} items` : "Searching…"}
          </span>
        </div>

        <div className="w-full overflow-hidden rounded-full bg-[var(--border)]/40 h-2">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-300"
            style={{
              width:
                progress.found > 0
                  ? `${Math.min(100, Math.round((progress.done / progress.found) * 100))}%`
                  : "60%",
            }}
          />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-3 text-xs text-[var(--text-muted)] space-y-1">
          <div className="font-semibold text-[var(--text)]">Honest Scan Doctrine</div>
          <div>• Direct on-device fetches from authorized student accounts</div>
          <div>• Scans run concurrently without sending tokens to any server</div>
          <div>• User-edited grades and custom calendar events are safely preserved</div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
        >
          {syncStatus === "success" ? copy.common.close : copy.common.cancel}
        </button>
      </div>
    </div>
  );
}
