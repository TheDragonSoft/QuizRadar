import React from "react";
import { AlertTriangle, Calendar, ShieldCheck, Sparkles, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";

export const ConflictBanner: React.FC = () => {
  const alerts = useAppStore((s) => s.data.dashboard.conflictAlerts) || [];
  const isDismissed = useAppStore((s) => !!s.data.config.dismissConflictBanner);
  const customEvents = useAppStore((s) => s.data.config.customEvents) || [];
  const dismissConflicts = useAppStore((s) => s.dismissConflicts);
  const scheduleStudyBlocks = useAppStore((s) => s.scheduleStudyBlocks);
  const setView = useAppStore((s) => s.setView);

  // Hidden when dismissed or when no conflict alerts exist
  if (alerts.length === 0 || isDismissed) {
    return null;
  }

  const studyBlocks = customEvents.filter(
    (e) => e.id && (e.id.startsWith("study-block-") || e.id.startsWith("study_block_")),
  );
  // The core decides per conflict pair whether a study block already covers
  // it (`is_mitigated`). "Any study block exists" used to flip the whole
  // banner to "Mitigated" - a block for one cluster used to hide an
  // uncovered conflict.
  const mitigatedAlerts = alerts.filter((a) => a.isMitigated);
  const unresolvedAlerts = alerts.filter((a) => !a.isMitigated);

  // 1. Mitigated state: Emerald Shield (every conflict pair is covered)
  if (unresolvedAlerts.length === 0) {
    return (
      <div
        data-testid="conflict-banner-mitigated"
        className="rounded-2xl p-4 bg-emerald-500/10 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/80 text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs transition"
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1 min-w-0">
            <div className="text-xs font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-2 flex-wrap">
              <span>{copy.dashboard.conflictBanner.mitigatedTitle(studyBlocks.length)}</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-[11px] font-bold">
                {copy.dashboard.conflictBanner.mitigatedBadge}
              </span>
            </div>
            <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              {copy.dashboard.conflictBanner.mitigatedBody(alerts.length)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setView("calendar")}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.conflictBanner.viewOnCalendarAction}</span>
          </button>
          <button
            type="button"
            onClick={dismissConflicts}
            aria-label={copy.dashboard.conflictBanner.dismissTitle}
            title={copy.dashboard.conflictBanner.dismissTitle}
            className="p-1.5 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 transition cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // 2. Unresolved state: Amber Alert
  return (
    <div
      data-testid="conflict-banner-unresolved"
      className="rounded-2xl p-4 bg-amber-500/10 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-xs transition"
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5 min-w-0">
          <div className="text-xs font-bold text-amber-900 dark:text-amber-100 flex items-center gap-2">
            <span>{copy.dashboard.conflictBanner.unresolvedTitle(unresolvedAlerts.length)}</span>
          </div>
          {mitigatedAlerts.length > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {copy.dashboard.conflictBanner.partiallyMitigatedNote(mitigatedAlerts.length)}
            </p>
          )}
          <div className="space-y-1">
            {unresolvedAlerts.map((a, idx) => {
              const labelA = a.titleA || a.assessmentAId;
              const labelB = a.titleB || a.assessmentBId;
              return (
                <div
                  key={idx}
                  className="text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2 flex-wrap"
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                      a.severity === "critical"
                        ? "bg-red-500/20 text-red-800 dark:text-red-300"
                        : "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                    }`}
                  >
                    {a.severity.toUpperCase()}
                  </span>
                  <span>
                    {a.message.includes(String(labelA)) ? (
                      a.message
                    ) : labelA === labelB ? (
                      // Same title twice reads as a stutter — disambiguate with
                      // the two assessment ids instead.
                      <>
                        <strong>{labelA}</strong> ({a.assessmentAId} vs {a.assessmentBId}):{" "}
                        {a.message}
                      </>
                    ) : (
                      <>
                        <strong>{labelA}</strong> and <strong>{labelB}</strong>: {a.message}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => scheduleStudyBlocks()}
          className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.conflictBanner.autoScheduleAction}</span>
        </button>
        <button
          type="button"
          onClick={dismissConflicts}
          aria-label={copy.dashboard.conflictBanner.dismissTitle}
          title={copy.dashboard.conflictBanner.dismissTitle}
          className="p-1.5 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 transition cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
