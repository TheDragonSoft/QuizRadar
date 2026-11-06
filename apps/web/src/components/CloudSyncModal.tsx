import { useRef, useState } from "react";
import { Cloud, Smartphone, UploadCloud, DownloadCloud, Download, Upload, X } from "lucide-react";
import { copy } from "../copy";
import { isTauriEnvironment } from "../state/rpc";
import { useAppStore } from "../state/store";
import { rpc } from "../state/rpc";
import type { MergeReport } from "../state/types";

export function CloudSyncModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const isDesktop = isTauriEnvironment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addToast = useAppStore((s) => s.addToast);
  const refreshState = useAppStore((s) => s.refreshState);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);

  const handleLocalExport = async () => {
    setExporting(true);
    try {
      const res = await exportBackupFile();
      addToast({
        type: "success",
        message: res.path ? `Backup saved to ${res.path}` : "Secret-free JSON backup downloaded",
      });
    } catch (err) {
      addToast({
        type: "error",
        message: `Backup export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExporting(false);
    }
  };

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const jsonContent = await file.text();
      const report = await importBackupFile(undefined, jsonContent);
      addToast({
        type: "success",
        message: `Imported ${report.coursesImported} courses, ${report.assessmentsImported} assessments, ${report.topicsImported} topics`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: `Backup import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await rpc("push_cloud_backup");
      await refreshState();
      addToast({
        type: "success",
        message: copy.cloudSync.pushSucceeded,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: copy.cloudSync.pushFailed(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      // The core's `MergeReport` crosses the bridge in its raw snake_case
      // shape (it is not a state payload, so the normalizer skips it). The
      // old toast read camelCase twins that never existed and therefore
      // reported "0 added, 0 updated" for every restore.
      const res = await rpc<{
        found: boolean;
        mergeReport?: MergeReport;
      }>("pull_cloud_backup");
      await refreshState();
      if (res?.found) {
        const report = res.mergeReport;
        addToast({
          type: "success",
          message: report
            ? copy.cloudSync.mergedSummary(
                report.assessments_replaced,
                report.topics_merged,
                report.grades_merged,
                report.events_upserted,
                report.schedule_replaced,
              )
            : copy.cloudSync.mergedUnknown,
        });
      } else {
        addToast({
          type: "info",
          message: copy.cloudSync.noCloudBackup,
        });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: copy.cloudSync.pullFailed(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h2 id="cloud-sync-title" className="text-lg font-bold text-[var(--text)]">
              Cloud Backup & Transfer
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
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {/* Google Drive AppData Section — desktop tier only: the browser tier
            has no Drive RPC (honest degradation), so showing the buttons there
            produced raw "not implemented" errors. */}
        {isDesktop && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[var(--text)]">
                Google Drive AppData Backup
              </span>
              <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
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
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[var(--accent-fill)] py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{pushing ? "Pushing…" : "Push Backup"}</span>
              </button>
              <button
                type="button"
                disabled={pushing || pulling}
                onClick={handlePull}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition disabled:opacity-50"
              >
                <DownloadCloud className="h-4 w-4" />
                <span>{pulling ? "Pulling…" : "Pull & Merge"}</span>
              </button>
            </div>
          </div>
        )}

        {/* Local File Backup & Android Transfer Section */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="h-4 w-4 text-[var(--accent-ink)]" />
            <span className="text-xs font-bold text-[var(--text)]">
              {copy.settings.pairPhoneTitle}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">{copy.settings.pairPhoneHelp}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleLocalFileChange}
            aria-label={copy.settings.importBackup}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={exporting}
              onClick={handleLocalExport}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-[var(--accent-ink)]" />
              <span>{exporting ? "Exporting…" : copy.settings.exportBackup}</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
            >
              <Upload className="h-4 w-4 text-[var(--accent-ink)]" />
              <span>{copy.settings.importBackup}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
        >
          {copy.common.close}
        </button>
      </div>
    </div>
  );
}
