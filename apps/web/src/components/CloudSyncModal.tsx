import { useState } from "react";
import { Cloud, Smartphone, UploadCloud, DownloadCloud, X, ShieldCheck } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { rpc } from "../state/rpc";

export function CloudSyncModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const addToast = useAppStore((s) => s.addToast);
  const refreshState = useAppStore((s) => s.refreshState);

  const handlePush = async () => {
    setPushing(true);
    try {
      await rpc("push_cloud_backup");
      await refreshState();
      addToast({
        type: "success",
        message: "Data-only cloud backup successfully uploaded to Google Drive AppData",
      });
    } catch (err) {
      addToast({
        type: "error",
        message: `Cloud backup push failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      const res = await rpc<{
        found: boolean;
        mergeReport?: { assessmentsAdded: number; assessmentsUpdated: number };
      }>("pull_cloud_backup");
      await refreshState();
      if (res?.found) {
        addToast({
          type: "success",
          message: `Cloud backup merged (${res.mergeReport?.assessmentsAdded || 0} added, ${res.mergeReport?.assessmentsUpdated || 0} updated)`,
        });
      } else {
        addToast({
          type: "info",
          message: "No cloud backup file found in Google Drive AppData",
        });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: `Cloud backup pull failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all">
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h2 id="cloud-sync-title" className="text-lg font-bold text-[var(--text)]">
              Cloud Backup & Pairing
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Secure, secret-free data sync across your devices
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

      <div className="mt-5 space-y-5">
        {/* Google Drive AppData Section */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[var(--text)]">
              Google Drive AppData Backup
            </span>
            <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
              Data Only
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Uploads or downloads your verified exam radar, courses, and grades directly to your
            private Google Drive AppData folder.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pushing || pulling}
              onClick={handlePush}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition disabled:opacity-50"
            >
              <UploadCloud className="h-4 w-4" />
              <span>{pushing ? "Pushing…" : "Push Backup"}</span>
            </button>
            <button
              type="button"
              disabled={pushing || pulling}
              onClick={handlePull}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition disabled:opacity-50"
            >
              <DownloadCloud className="h-4 w-4" />
              <span>{pulling ? "Pulling…" : "Pull & Merge"}</span>
            </button>
          </div>
        </div>

        {/* Android Pairing Section */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-xs font-bold text-[var(--text)]">
              {copy.settings.pairPhoneTitle}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">{copy.settings.pairPhoneHelp}</p>
          <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-xs font-mono text-[var(--text-muted)] select-all bg-[var(--surface)]">
            quizradar://pair?endpoint=local
          </div>
        </div>

        {/* Security / Privacy Assurance */}
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>
            Honesty Doctrine: OAuth tokens and API keys never cross the network or enter cloud
            backups.
          </span>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
        >
          {copy.common.close}
        </button>
      </div>
    </div>
  );
}
