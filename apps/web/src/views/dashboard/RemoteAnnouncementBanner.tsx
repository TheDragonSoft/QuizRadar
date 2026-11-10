import React, { useEffect, useState } from "react";
import { Sparkles, X as XIcon } from "lucide-react";
import { useFeatureFlag, useFeatureFlagPayload } from "../../lib/analytics";

/**
 * Remote Announcement Banner wired to PostHog feature flag `banner-announcement`.
 */
export const RemoteAnnouncementBanner: React.FC = () => {
  const isEnabled = useFeatureFlag("banner-announcement", false);
  const payload = useFeatureFlagPayload<{ message?: string; active?: boolean }>(
    "banner-announcement",
  );
  const [dismissed, setDismissed] = useState(false);

  const message = payload?.message || (typeof payload === "string" ? payload : "");
  const isActive = payload?.active !== false;

  useEffect(() => {
    if (message) {
      const isDismissed = localStorage.getItem(`quizradar_dismissed_banner_${message}`) === "true";
      setDismissed(isDismissed);
    }
  }, [message]);

  if (!isEnabled || !isActive || !message || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(`quizradar_dismissed_banner_${message}`, "true");
    setDismissed(true);
  };

  return (
    <div
      data-testid="remote-announcement-banner"
      className="flex items-center justify-between gap-3 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-blue-500/10 p-3 text-xs text-slate-800 dark:border-blue-800/60 dark:text-blue-100"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles
          className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden="true"
        />
        <span className="font-medium leading-snug">{message}</span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-black/5 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white transition"
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
