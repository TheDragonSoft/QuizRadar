import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Maximize2, Minimize2, Share2, ShieldCheck, X } from "lucide-react";
import { copy } from "../copy";
import { COURSE_PACK_WEB_BASE_URL } from "../lib/coursePack";
import { qrMatrixToSvgPath, unpackFlatQrMatrix } from "../lib/qrCode";
import { useAppStore } from "../state/store";
import type { CoursePackExportResult } from "../state/types";

export interface CoursePackShareModalProps {
  courseId?: string;
}

export function CoursePackShareModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as CoursePackShareModalProps;
  const courseId = modalProps.courseId || "";

  const exportCoursePack = useAppStore((s) => s.exportCoursePack);
  const addToast = useAppStore((s) => s.addToast);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CoursePackExportResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<"web" | "deep" | null>(null);
  const [qrLarge, setQrLarge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!courseId.trim()) {
      setError("Select a course to share.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    exportCoursePack(courseId, COURSE_PACK_WEB_BASE_URL)
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, exportCoursePack]);

  const unpackedQr = useMemo(
    () => (result?.qr ? unpackFlatQrMatrix(result.qr) : null),
    [result?.qr],
  );
  const qrPath = useMemo(() => qrMatrixToSvgPath(unpackedQr), [unpackedQr]);

  const linkRec = result?.links as unknown as Record<string, unknown> | undefined;
  const webUrl = String(linkRec?.web_url ?? linkRec?.webUrl ?? "");
  const deepLink = String(linkRec?.deep_link ?? linkRec?.deepLink ?? "");
  const fitsQr = Boolean(linkRec?.fits_qr ?? linkRec?.fitsQr ?? false);
  const byteLen = Number(linkRec?.byte_len ?? linkRec?.byteLen ?? 0);

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function" && webUrl.length > 0;

  const copyValue = async (text: string, which: "web" | "deep") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(which);
      if (which === "web") {
        addToast({ type: "success", message: copy.coursePack.copiedWebLink });
      }
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      addToast({
        type: "error",
        message: "Clipboard copy unavailable — select and copy manually.",
      });
    }
  };

  const handleNativeShare = async () => {
    if (!canNativeShare || !result) return;
    try {
      await navigator.share({
        title: `${result.pack.course.id} — ${result.pack.course.name}`,
        text: `Import ${result.pack.course.id} (${result.pack.slots.length} weekly slots, ${result.pack.assessments.length} deadlines) in QuizRadar:`,
        url: webUrl,
      });
    } catch {
      // User dismissed OS share sheet — no error toast needed.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--text)]">
      <div className="flex shrink-0 items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="course-pack-share-title" className="text-lg font-bold text-[var(--text)]">
              {copy.coursePack.shareTitle}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.coursePack.shareSubtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{copy.coursePack.privacyBadge}</span>
        </div>

        {loading && (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">
            Preparing privacy-scrubbed Course Pack...
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        {!loading && !error && result && (
          <>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-bold text-[var(--text)]">
                    {result.pack.course.id} — {result.pack.course.name}
                  </span>
                  {result.pack.semester && (
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      ({result.pack.semester})
                    </span>
                  )}
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {result.pack.slots.length} slot(s) · {result.pack.assessments.length}{" "}
                  assessment(s) · {byteLen} B
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="course-pack-web-url"
                className="block text-xs font-semibold text-[var(--text-muted)]"
              >
                Classmate Share Link
              </label>
              <div className="flex gap-2">
                <input
                  id="course-pack-web-url"
                  type="text"
                  readOnly
                  value={webUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-xs text-[var(--text)]"
                />
                <button
                  type="button"
                  onClick={() => copyValue(webUrl, "web")}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-fill-hover)]"
                >
                  {copiedKey === "web" ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {copiedKey === "web" ? "Copied" : copy.coursePack.copyWebLink}
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-2)]"
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.coursePack.shareNative}
                  </button>
                )}
              </div>
            </div>

            {fitsQr && qrPath && unpackedQr ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  <svg
                    role="img"
                    aria-label={`QR code for ${result.pack.course.id} Course Pack`}
                    viewBox={`0 0 ${unpackedQr.size + 8} ${unpackedQr.size + 8}`}
                    className={qrLarge ? "h-64 w-64" : "h-44 w-44"}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={unpackedQr.size + 8}
                      height={unpackedQr.size + 8}
                      fill="#ffffff"
                    />
                    <path d={qrPath} fill="#111827" />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={() => setQrLarge((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                >
                  {qrLarge ? (
                    <>
                      <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> Shrink QR
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Tap to enlarge QR
                    </>
                  )}
                </button>
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
                This Course Pack is too detailed to fit inside a single QR code ({byteLen} bytes).
                Copy and share the Classmate Link above instead.
              </p>
            )}

            <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-[var(--text-muted)]">
                {copy.coursePack.deepLinkSummary}
              </summary>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  readOnly
                  aria-label="Native deep link URI"
                  value={deepLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)]"
                />
                <button
                  type="button"
                  onClick={() => copyValue(deepLink, "deep")}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 font-semibold text-[var(--text)] hover:bg-[var(--surface-2)]"
                >
                  {copiedKey === "deep" ? "Copied" : "Copy"}
                </button>
              </div>
            </details>
          </>
        )}
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-2)]"
        >
          {copy.common.close}
        </button>
      </div>
    </div>
  );
}
