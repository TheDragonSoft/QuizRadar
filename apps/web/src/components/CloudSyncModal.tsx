import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  HardDrive,
  Smartphone,
  UploadCloud,
  DownloadCloud,
  Download,
  Upload,
  Link2,
  QrCode,
  Camera,
  Wifi,
  Maximize2,
  ImageUp,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { isTauriEnvironment, rpc } from "../state/rpc";
import { useAppStore } from "../state/store";
import { decodePairSyncLink, encodePairSyncLink, encodePairSyncQrPayload } from "../lib/pairSync";
import {
  encodeQrMatrix,
  MAX_QR_BYTE_CAPACITY,
  qrMatrixToSvgPath,
  unpackFlatQrMatrix,
  type FlatQrMatrix,
  type QrMatrix,
} from "../lib/qrCode";
import { decodeQrFromImageFile, decodeQrFromRgba } from "../lib/qrDecoder";
import type { MergeReport } from "../state/types";

interface LanPairSessionInfo {
  uri: string;
  host: string;
  port: number;
  expiresAtIso: string;
  ttlSeconds: number;
  qr: FlatQrMatrix;
}

function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, Math.floor(secondsLeft));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBackupTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

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
  const [copyingSync, setCopyingSync] = useState(false);
  const [buildingQr, setBuildingQr] = useState(false);
  const [mergingSync, setMergingSync] = useState(false);
  const [peerLinkInput, setPeerLinkInput] = useState("");
  const [qrState, setQrState] = useState<{
    matrix: QrMatrix | null;
    compacted: boolean;
    fitsQr: boolean;
    byteLength: number;
  } | null>(null);
  const [startingLan, setStartingLan] = useState(false);
  const [lanSession, setLanSession] = useState<{
    info: LanPairSessionInfo;
    matrix: QrMatrix;
    secondsLeft: number;
  } | null>(null);
  const [expandedQr, setExpandedQr] = useState<{
    title: string;
    subtitle: string;
    matrix: QrMatrix;
  } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isDesktop = isTauriEnvironment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrImageInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanRafRef = useRef<number | null>(null);
  const lanActiveRef = useRef(false);
  const lastBackupPush = useAppStore((s) => s.data.config.lastBackupPush);
  const addToast = useAppStore((s) => s.addToast);
  const refreshState = useAppStore((s) => s.refreshState);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);

  const qrSvgPath = useMemo(() => qrMatrixToSvgPath(qrState?.matrix), [qrState]);
  const lanQrSvgPath = useMemo(() => qrMatrixToSvgPath(lanSession?.matrix), [lanSession]);
  const expandedQrSvgPath = useMemo(() => qrMatrixToSvgPath(expandedQr?.matrix), [expandedQr]);

  const stopCameraScanner = useCallback(() => {
    if (scanRafRef.current !== null) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = null;
    }
    if (cameraStreamRef.current) {
      for (const track of cameraStreamRef.current.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const stopLanSession = useCallback(async () => {
    if (!lanActiveRef.current) {
      setLanSession(null);
      return;
    }
    lanActiveRef.current = false;
    setLanSession(null);
    if (isDesktop) {
      try {
        await rpc<void>("stop_lan_pair_session");
      } catch {
        // Session may have already closed after sync or timeout.
      }
    }
  }, [isDesktop]);

  useEffect(() => {
    return () => {
      stopCameraScanner();
      if (lanActiveRef.current && isDesktop) {
        lanActiveRef.current = false;
        void rpc<void>("stop_lan_pair_session").catch(() => {});
      }
    };
  }, [isDesktop, stopCameraScanner]);

  const lanExpiresAtIso = lanSession?.info.expiresAtIso ?? null;
  const lanSessionUri = lanSession?.info.uri ?? null;

  useEffect(() => {
    if (!lanExpiresAtIso) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(lanExpiresAtIso).getTime() - Date.now()) / 1000),
      );
      setLanSession((prev) => (prev ? { ...prev, secondsLeft: remaining } : null));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lanExpiresAtIso]);

  useEffect(() => {
    if (!isDesktop || !lanSessionUri) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        if (disposed) return;
        const u1 = await listen<MergeReport>("lan-pair-completed", async (event) => {
          lanActiveRef.current = false;
          setLanSession(null);
          setExpandedQr(null);
          await refreshState();
          const report = event.payload;
          addToast({
            type: "success",
            message: report
              ? `Wi-Fi sync complete — ${copy.cloudSync.mergedSummary(
                  report.assessments_replaced,
                  report.topics_merged,
                  report.grades_merged,
                  report.events_upserted,
                  report.schedule_replaced,
                )}`
              : "Wi-Fi sync complete.",
          });
        });
        const u2 = await listen<string>("lan-pair-expired", (event) => {
          lanActiveRef.current = false;
          setLanSession(null);
          setExpandedQr(null);
          addToast({
            type: "info",
            message: event.payload || "Local Wi-Fi sync session expired.",
          });
        });
        if (disposed) {
          u1();
          u2();
        } else {
          unlisteners.push(u1, u2);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [addToast, isDesktop, lanSessionUri, refreshState]);

  const applyScannedPairValue = useCallback(
    async (rawValue: string) => {
      setPeerLinkInput(rawValue);
      const payloadJson = await decodePairSyncLink(rawValue);
      const report = await rpc<MergeReport>("merge_sync_payload", { payloadJson });
      await refreshState();
      setPeerLinkInput("");
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
    },
    [addToast, refreshState],
  );

  const handleToggleLanSync = async () => {
    if (lanSession) {
      await stopLanSession();
      return;
    }
    setStartingLan(true);
    try {
      const info = await rpc<LanPairSessionInfo>("start_lan_pair_session");
      const matrix = unpackFlatQrMatrix(info.qr);
      lanActiveRef.current = true;
      setLanSession({ info, matrix, secondsLeft: info.ttlSeconds });
    } catch (err) {
      addToast({
        type: "error",
        message: `Wi-Fi sync failed to start: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setStartingLan(false);
    }
  };

  const handleToggleCameraScanner = async () => {
    if (cameraActive) {
      stopCameraScanner();
      return;
    }
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Webcam access is unavailable in this environment. Use Upload QR Image or paste the sync link instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => {});

        const tick = () => {
          const v = videoRef.current;
          const canvas = scanCanvasRef.current;
          if (!cameraStreamRef.current || !v || !canvas) return;
          if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const decoded = decodeQrFromRgba(imageData.data, imageData.width, imageData.height);
              if (decoded) {
                stopCameraScanner();
                void applyScannedPairValue(decoded).catch((err) => {
                  addToast({
                    type: "error",
                    message: `QR merge failed: ${err instanceof Error ? err.message : String(err)}`,
                  });
                });
                return;
              }
            }
          }
          scanRafRef.current = requestAnimationFrame(tick);
        };
        scanRafRef.current = requestAnimationFrame(tick);
      });
    } catch (err) {
      stopCameraScanner();
      setCameraError(
        err instanceof Error
          ? `Camera unavailable: ${err.message}`
          : "Camera permission was denied.",
      );
    }
  };

  const handleCopyPeerSyncLink = async () => {
    setCopyingSync(true);
    try {
      const payloadJson = await rpc<string>("export_sync_payload");
      const link = await encodePairSyncLink(payloadJson);
      await navigator.clipboard.writeText(link);
      addToast({
        type: "success",
        message:
          "Serverless sync link copied (quizradar://pair). Open or paste it on your other device to merge.",
      });
    } catch (err) {
      addToast({
        type: "error",
        message: `Sync link export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setCopyingSync(false);
    }
  };

  const handleShowPeerQr = async () => {
    if (qrState) {
      setQrState(null);
      return;
    }
    setBuildingQr(true);
    try {
      const payloadJson = await rpc<string>("export_sync_payload");
      const { link, compacted, fitsQr } = await encodePairSyncQrPayload(payloadJson);
      const byteLength = new TextEncoder().encode(link).length;
      if (!fitsQr) {
        setQrState({ matrix: null, compacted, fitsQr: false, byteLength });
      } else {
        const matrix = encodeQrMatrix(link);
        setQrState({ matrix, compacted, fitsQr: true, byteLength });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: `QR generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBuildingQr(false);
    }
  };

  const handleQrImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const rawValue = await decodeQrFromImageFile(file);
      if (!rawValue) {
        addToast({
          type: "error",
          message: "No QR code was detected in the selected image.",
        });
        return;
      }
      await applyScannedPairValue(rawValue);
    } catch (err) {
      addToast({
        type: "error",
        message: `QR scan failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleMergePeerSyncLink = async () => {
    setMergingSync(true);
    try {
      const payloadJson = await decodePairSyncLink(peerLinkInput);
      const report = await rpc<MergeReport>("merge_sync_payload", { payloadJson });
      await refreshState();
      setPeerLinkInput("");
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
    } catch (err) {
      addToast({
        type: "error",
        message: `Peer sync merge failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setMergingSync(false);
    }
  };

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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            {isDesktop ? (
              <Cloud className="h-5 w-5" aria-hidden="true" />
            ) : (
              <HardDrive className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 id="cloud-sync-title" className="text-lg font-bold text-[var(--text)]">
              {isDesktop ? "Cloud Backup & Transfer" : "JSON Backup & Transfer"}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {isDesktop
                ? "Secure, secret-free data sync across your devices"
                : "Export or import a secret-free JSON backup file across devices (Google Drive sync is available on desktop & Android)"}
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
        <div
          data-testid="cloud-sync-last-backup"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] px-3.5 py-2.5 text-xs"
        >
          <span className="font-semibold text-[var(--text-muted)]">Last Cloud Backup</span>
          <span className="font-semibold tabular-nums text-[var(--text)]">
            {lastBackupPush ? formatBackupTimestamp(lastBackupPush) : "Never backed up"}
          </span>
        </div>

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

        {/* Local File Backup & Cross-Device Transfer Section */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
            <span className="text-xs font-bold text-[var(--text)]">Cross-Device JSON Transfer</span>
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

        {/* Instant Local Wi-Fi Sync (Desktop LAN HTTPS) + Offline Peer Sync (quizradar://pair) */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
              <span className="text-xs font-bold text-[var(--text)]">
                Device Pairing &amp; Local Sync
              </span>
            </div>
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Two-Way Merge
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Sync courses, schedules, assessments, topics, and grades directly between Desktop and
            Android with zero cloud relay and zero credentials in the payload.
          </p>

          {isDesktop && (
            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-semibold text-[var(--text)]">
                    Instant Local Wi-Fi Sync (Pinned HTTPS)
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    One scan performs a full two-way sync with no size limit. Auto-closes after 1
                    sync or 5 minutes.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={startingLan}
                  onClick={handleToggleLanSync}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-fill-hover)] transition disabled:opacity-50"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  <span>
                    {startingLan
                      ? "Starting…"
                      : lanSession
                        ? "Stop Wi-Fi Sync"
                        : "Start Wi-Fi Sync"}
                  </span>
                </button>
              </div>

              {lanSession && (
                <div className="mt-3 flex flex-col items-center gap-2 border-t border-[var(--border)] pt-3 text-center">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedQr({
                        title: "Instant Wi-Fi Sync QR (Pinned HTTPS)",
                        subtitle: `https://${lanSession.info.host}:${lanSession.info.port} · expires in ${formatCountdown(lanSession.secondsLeft)}`,
                        matrix: lanSession.matrix,
                      })
                    }
                    className="group relative rounded-lg bg-white p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-fill)]"
                    aria-label="Enlarge Wi-Fi sync QR code"
                  >
                    <svg
                      data-testid="lan-pair-qr-svg"
                      viewBox={`0 0 ${lanSession.matrix.size + 8} ${lanSession.matrix.size + 8}`}
                      width="196"
                      height="196"
                      shapeRendering="crispEdges"
                      role="img"
                      aria-label="QuizRadar local Wi-Fi sync QR code"
                    >
                      <rect
                        width={lanSession.matrix.size + 8}
                        height={lanSession.matrix.size + 8}
                        fill="#ffffff"
                      />
                      <path d={lanQrSvgPath} fill="#000000" />
                    </svg>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-slate-600">
                      <Maximize2 className="h-3 w-3" /> Click QR to enlarge
                    </span>
                  </button>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Scan with Android camera to open{" "}
                    <span className="font-mono font-semibold">quizradar://lan</span> ·{" "}
                    <span className="font-mono">
                      https://{lanSession.info.host}:{lanSession.info.port}
                    </span>{" "}
                    · closes in{" "}
                    <span className="font-mono font-semibold">
                      {formatCountdown(lanSession.secondsLeft)}
                    </span>{" "}
                    (QR v{lanSession.matrix.version}-L).
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Protected by a one-time pinned TLS certificate and single-use bearer token. If
                    campus Wi-Fi isolates devices, use Offline QR / Sync Link below.
                  </p>
                </div>
              )}
            </div>
          )}

          <input
            ref={qrImageInputRef}
            type="file"
            accept="image/*"
            onChange={handleQrImageSelect}
            aria-label="Upload pairing QR image"
            className="hidden"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <button
              type="button"
              disabled={copyingSync}
              onClick={handleCopyPeerSyncLink}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 px-3 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition disabled:opacity-50"
            >
              <Link2 className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span>{copyingSync ? "Building…" : "Copy Sync Link"}</span>
            </button>
            <button
              type="button"
              disabled={buildingQr}
              onClick={handleShowPeerQr}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 px-3 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition disabled:opacity-50"
            >
              <QrCode className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span>
                {buildingQr ? "Encoding…" : qrState ? "Hide QR Code" : "Show Pairing QR Code"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleToggleCameraScanner}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 px-3 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
            >
              <Camera className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span>{cameraActive ? "Stop Camera" : "Scan with Camera"}</span>
            </button>
            <button
              type="button"
              onClick={() => qrImageInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 px-3 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
            >
              <ImageUp className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
              <span>Upload QR Image</span>
            </button>
          </div>

          {cameraError && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {cameraError}
            </p>
          )}

          {cameraActive && (
            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="mx-auto max-h-56 w-full rounded-lg bg-black object-cover"
              />
              <canvas ref={scanCanvasRef} className="hidden" />
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Point your webcam at the QuizRadar QR code on your phone to merge automatically.
              </p>
            </div>
          )}

          {qrState && (
            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
              {qrState.fitsQr && qrState.matrix ? (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      qrState.matrix &&
                      setExpandedQr({
                        title: "Offline Pairing QR Code (quizradar://pair)",
                        subtitle: `QR v${qrState.matrix.version}-L · ${qrState.byteLength} bytes${qrState.compacted ? " · compact mode" : ""}`,
                        matrix: qrState.matrix,
                      })
                    }
                    className="rounded-lg bg-white p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-fill)]"
                    aria-label="Enlarge offline pairing QR code"
                  >
                    <svg
                      data-testid="pair-qr-svg"
                      viewBox={`0 0 ${qrState.matrix.size + 8} ${qrState.matrix.size + 8}`}
                      width="208"
                      height="208"
                      shapeRendering="crispEdges"
                      role="img"
                      aria-label="QuizRadar pairing QR code"
                    >
                      <rect
                        width={qrState.matrix.size + 8}
                        height={qrState.matrix.size + 8}
                        fill="#ffffff"
                      />
                      <path d={qrSvgPath} fill="#000000" />
                    </svg>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-slate-600">
                      <Maximize2 className="h-3 w-3" /> Click QR to enlarge
                    </span>
                  </button>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Scan with your Android camera or Google Lens to open{" "}
                    <span className="font-mono font-semibold">quizradar://pair</span> directly in
                    QuizRadar (v{qrState.matrix.version}-L, {qrState.byteLength} bytes
                    {qrState.compacted ? ", compact mode" : ""}).
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Compressed sync link is {qrState.byteLength} bytes, which exceeds the ISO/IEC
                  18004 QR capacity ({MAX_QR_BYTE_CAPACITY} bytes). Use{" "}
                  {isDesktop ? "\u201CStart Wi-Fi Sync\u201D, " : ""}&ldquo;Copy Sync Link&rdquo; or
                  JSON transfer instead.
                </p>
              )}
            </div>
          )}

          {expandedQr && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={expandedQr.title}
              data-testid="expanded-qr-overlay"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
              onClick={() => setExpandedQr(null)}
            >
              <div
                className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[var(--text)]">{expandedQr.title}</span>
                  <button
                    type="button"
                    onClick={() => setExpandedQr(null)}
                    aria-label="Close enlarged QR code"
                    className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <svg
                    viewBox={`0 0 ${expandedQr.matrix.size + 8} ${expandedQr.matrix.size + 8}`}
                    width="320"
                    height="320"
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label={expandedQr.title}
                  >
                    <rect
                      width={expandedQr.matrix.size + 8}
                      height={expandedQr.matrix.size + 8}
                      fill="#ffffff"
                    />
                    <path d={expandedQrSvgPath} fill="#000000" />
                  </svg>
                </div>
                <p className="text-xs text-[var(--text-muted)]">{expandedQr.subtitle}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={peerLinkInput}
              onChange={(e) => setPeerLinkInput(e.target.value)}
              placeholder="Paste quizradar://pair?d=... link from phone"
              aria-label="Paste peer sync link"
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-fill)]"
            />
            <button
              type="button"
              disabled={mergingSync || !peerLinkInput.trim()}
              onClick={handleMergePeerSyncLink}
              className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-fill-hover)] transition disabled:opacity-50"
            >
              {mergingSync ? "Merging…" : "Merge"}
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
