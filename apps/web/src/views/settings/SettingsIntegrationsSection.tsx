import { useRef, useState } from "react";
import {
  Sliders,
  Trash2,
  Calendar,
  Upload,
  Download,
  RotateCcw,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { copy } from "../../copy";
import { useAppStore } from "../../state/store";
import { isTauriEnvironment } from "../../state/rpc";
import { APP_VERSION } from "../../generated/version";
import type { FeedConfig } from "../../state/types";
import { SECTION_ID } from "./constants";

export function SettingsIntegrationsSection() {
  const config = useAppStore((s) => s.data.config);
  const feeds = useAppStore((s) => s.data.config.feeds || []);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const upsertFeed = useAppStore((s) => s.upsertFeed);
  const deleteFeed = useAppStore((s) => s.deleteFeed);
  const runGcalSync = useAppStore((s) => s.runGcalSync);
  const checkUpdate = useAppStore((s) => s.checkUpdate);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);
  const resetDatabase = useAppStore((s) => s.resetDatabase);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const isBrowserTier = !isTauriEnvironment();

  // Moodle state
  const [moodleUrl, setMoodleUrl] = useState(config.moodleUrl || "");
  const [moodleIcalUrl, setMoodleIcalUrl] = useState(config.moodleIcalUrl || "");
  const [moodleAccordionOpen, setMoodleAccordionOpen] = useState(false);
  const [moodleAdvancedOpen, setMoodleAdvancedOpen] = useState(false);

  // Canvas & Blackboard state
  const canvasFeed = feeds.find(
    (f) => f.id === "feed-canvas-lms" || f.name.toLowerCase().includes("canvas"),
  );
  const blackboardFeed = feeds.find(
    (f) => f.id === "feed-blackboard-lms" || f.name.toLowerCase().includes("blackboard"),
  );
  const [canvasAccordionOpen, setCanvasAccordionOpen] = useState(false);
  const [canvasIcalUrl, setCanvasIcalUrl] = useState(() => canvasFeed?.url || "");
  const [blackboardAccordionOpen, setBlackboardAccordionOpen] = useState(false);
  const [blackboardIcalUrl, setBlackboardIcalUrl] = useState(() => blackboardFeed?.url || "");

  // Feed add state
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");

  // Update check state
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  const handleBrowserImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const jsonText = await file.text();
      const report = await importBackupFile(undefined, jsonText);
      // A quiet import contradicts the honesty doctrine — surface the real
      // counts and any partial-failure warnings, like the backup modal does.
      addToast({
        type: "success",
        message: `Imported ${report.coursesImported} courses, ${report.assessmentsImported} assessments, ${report.topicsImported} topics`,
      });
      for (const warning of report.warnings) {
        addToast({ type: "warning", message: warning });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleSaveMoodle = async () => {
    await updateConfig({
      moodleUrl: moodleUrl.trim() || undefined,
      moodleIcalUrl: moodleIcalUrl.trim() || undefined,
      moodleEnabled: Boolean(moodleUrl.trim() || moodleIcalUrl.trim()),
    });
    addToast({
      type: "success",
      message: "Moodle configuration saved",
    });
  };

  const handleSaveCanvas = async () => {
    const trimmed = canvasIcalUrl.trim();
    if (trimmed && !trimmed.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    if (trimmed) {
      await upsertFeed({
        id: "feed-canvas-lms",
        name: "Canvas LMS Calendar",
        url: trimmed,
        enabled: true,
      });
      addToast({
        type: "success",
        message: "Canvas LMS calendar feed connected",
      });
    } else if (canvasFeed) {
      await deleteFeed(canvasFeed.id);
      addToast({
        type: "info",
        message: "Canvas LMS calendar feed removed",
      });
    }
  };

  const handleSaveBlackboard = async () => {
    const trimmed = blackboardIcalUrl.trim();
    if (trimmed && !trimmed.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    if (trimmed) {
      await upsertFeed({
        id: "feed-blackboard-lms",
        name: "Blackboard Learn Calendar",
        url: trimmed,
        enabled: true,
      });
      addToast({
        type: "success",
        message: "Blackboard Learn calendar feed connected",
      });
    } else if (blackboardFeed) {
      await deleteFeed(blackboardFeed.id);
      addToast({
        type: "info",
        message: "Blackboard Learn calendar feed removed",
      });
    }
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = newFeedUrl.trim();
    const trimmedName = newFeedName.trim();
    if (!trimmedUrl.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    const newFeed: FeedConfig = {
      id: `feed-${Date.now()}`,
      name: trimmedName || "External Calendar",
      url: trimmedUrl,
      enabled: true,
    };
    await upsertFeed(newFeed);
    setNewFeedName("");
    setNewFeedUrl("");
  };

  const handleResetData = () => {
    openModal({
      id: "app-confirm",
      props: {
        title: "Reset All Local Data?",
        message: copy.settings.resetDatabaseWarn,
        destructive: true,
        confirmLabel: "Reset Everything",
        onConfirm: () => {
          // Double-confirm
          openModal({
            id: "app-confirm",
            props: {
              title: "Are you absolutely sure?",
              // Same copy source as the first dialog: one wipe-scope
              // statement, so the two confirms can never drift apart again.
              message: copy.settings.resetDatabaseWarnFinal,
              destructive: true,
              confirmLabel: "Yes, Permanently Delete",
              onConfirm: async () => {
                // resetDatabase toasts its own failure; only claim success
                // when the wipe actually happened. (The page stays — the
                // freshly emptied state is honest evidence enough.)
                const wiped = await resetDatabase();
                if (!wiped) return;
                addToast({
                  type: "info",
                  message: "All application data reset. Fresh database initialized.",
                });
              },
            },
          });
        },
      },
    });
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateResult(null);
    try {
      const res = await checkUpdate();
      if (res.available) {
        setUpdateResult(`Update available: v${res.latestVersion}`);
      } else if (res.error) {
        setUpdateResult(res.error);
      } else {
        setUpdateResult(`QuizRadar is up to date (v${res.currentVersion}).`);
      }
    } catch (err) {
      setUpdateResult(`Update check error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <section id={SECTION_ID.integrations} className="scroll-mt-6 space-y-6">
      <div className="border-b border-[var(--border)] pb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
          <Sliders className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
          {copy.settings.tabIntegrations}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {copy.settings.sectionIntegrationsSub}
        </p>
      </div>

      {/* Google Calendar Section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.integrationsHeader}
            </h3>
          </div>
          <button
            type="button"
            onClick={runGcalSync}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
          >
            {copy.settings.gcalPushNow}
          </button>
        </div>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between text-xs font-semibold text-[var(--text)]">
            <span>{copy.settings.gcalAutoPush}</span>
            <input
              type="checkbox"
              checked={config.autoSyncGcal}
              onChange={(e) => updateConfig({ autoSyncGcal: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
            />
          </label>
          <p className="text-xs text-[var(--text-muted)]">
            Pushes the fresh radar to Google Calendar after every scan that found something. A scan
            that fetched nothing, or a Calendar scope refusal, is reported in the scan notes — never
            silently skipped.
          </p>
        </div>
      </div>

      {/* University Sources Section — spec `01` §4.9: each source is
          a user control. Gmail follows the Google account itself; the
          Teams and Classroom toggles exclude one source from scans
          without disconnecting the account. */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          University Sources
        </h3>
        <div className="space-y-3">
          <label
            htmlFor="settings-teams-toggle"
            className="flex cursor-pointer items-center justify-between"
          >
            <span className="text-xs font-semibold text-[var(--text)]">
              Microsoft Teams
              <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                {config.teamsAccountName ? "connected" : "not connected"}
              </span>
            </span>
            <input
              id="settings-teams-toggle"
              type="checkbox"
              aria-label="Scan Microsoft Teams announcements"
              checked={config.teamsEnabled}
              onChange={(e) => updateConfig({ teamsEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
            />
          </label>
          <label
            htmlFor="settings-classroom-toggle"
            className="flex cursor-pointer items-center justify-between"
          >
            <span className="text-xs font-semibold text-[var(--text)]">
              Google Classroom
              <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                follows the Google account
              </span>
            </span>
            <input
              id="settings-classroom-toggle"
              type="checkbox"
              aria-label="Scan Google Classroom coursework"
              checked={config.classroomEnabled}
              onChange={(e) => updateConfig({ classroomEnabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
            />
          </label>
          <p className="text-xs text-[var(--text-muted)]">
            Gmail scans run whenever the Google account is connected. These toggles exclude a source
            from the next scan; an excluded source never retires its earlier announcements.
          </p>
        </div>
      </div>

      {/* Moodle LMS Section */}
      <div
        data-testid="settings-moodle-card"
        className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
      >
        <button
          type="button"
          aria-label="Moodle LMS Calendar Feed"
          onClick={() => setMoodleAccordionOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.moodleTitle}
            </h3>
            {config.moodleEnabled && (moodleIcalUrl || moodleUrl) && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                Connected
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
            <span>{moodleAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
            {moodleAccordionOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
        </button>

        {moodleAccordionOpen && (
          <div className="mt-3.5 space-y-3.5 pt-3 border-t border-[var(--border)]">
            {/* Step-by-step instructions */}
            <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
              <div className="font-bold text-[var(--text)]">{copy.settings.moodleGuideTitle}</div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                <li>{copy.settings.moodleGuideStep1}</li>
                <li>{copy.settings.moodleGuideStep2}</li>
                <li>{copy.settings.moodleGuideStep3}</li>
                <li>{copy.settings.moodleGuideStep4}</li>
                <li>{copy.settings.moodleGuideStep5}</li>
              </ol>
            </div>

            {/* Primary: Moodle Personal iCal Feed URL */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label
                  htmlFor="settings-moodle-ical"
                  className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {copy.settings.moodleIcalPrimaryLabel}
                </label>
                <span className="text-[10px] text-[var(--accent-ink)] font-semibold">
                  Recommended
                </span>
              </div>
              <p className="mb-1.5 text-xs text-[var(--text-muted)]">
                {copy.settings.moodleIcalPrimaryHelp}
              </p>
              <input
                id="settings-moodle-ical"
                type="url"
                value={moodleIcalUrl}
                onChange={(e) => setMoodleIcalUrl(e.target.value)}
                placeholder="https://moodle.university.edu/calendar/export_execute.php?..."
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>

            {/* Demoted / Advanced: REST Web Service URL */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
              <button
                type="button"
                onClick={() => setMoodleAdvancedOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left cursor-pointer"
              >
                <span className="text-xs font-semibold text-[var(--text-muted)]">
                  {copy.settings.moodleAdvancedTitle}
                </span>
                <span className="text-[11px] text-[var(--accent-ink)] font-medium">
                  {moodleAdvancedOpen ? "Hide" : "Show"}
                </span>
              </button>
              <p className="text-[11px] text-[var(--text-muted)]">
                {copy.settings.moodleAdvancedHelp}
              </p>
              {moodleAdvancedOpen && (
                <div className="pt-2">
                  <label
                    htmlFor="settings-moodle-url"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    {copy.settings.moodleRestUrlLabel}
                  </label>
                  <input
                    id="settings-moodle-url"
                    type="url"
                    value={moodleUrl}
                    onChange={(e) => setMoodleUrl(e.target.value)}
                    placeholder={copy.settings.moodleRestPlaceholder}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                  />
                </div>
              )}
            </div>

            {/* Actions & Enable Toggle */}
            <div className="flex items-center justify-between pt-1">
              <label
                htmlFor="settings-moodle-toggle"
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  id="settings-moodle-toggle"
                  type="checkbox"
                  aria-label="Enable Moodle LMS integration"
                  checked={config.moodleEnabled}
                  onChange={(e) => updateConfig({ moodleEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
                <span className="text-xs font-semibold text-[var(--text)]">Enable Moodle Sync</span>
              </label>

              <button
                type="button"
                onClick={handleSaveMoodle}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
              >
                {copy.settings.saveMoodle}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Canvas LMS Integration Accordion */}
      <div
        data-testid="settings-canvas-card"
        className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
      >
        <button
          type="button"
          aria-label="Canvas LMS Calendar Feed"
          onClick={() => setCanvasAccordionOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Canvas LMS Integration
            </h3>
            {canvasFeed?.enabled && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                Connected
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
            <span>{canvasAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
            {canvasAccordionOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
        </button>

        {canvasAccordionOpen && (
          <div className="mt-3.5 space-y-3 pt-3 border-t border-[var(--border)]">
            {/* Step-by-step instructions */}
            <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
              <div className="font-bold text-[var(--text)]">
                How to extract your private Canvas Calendar Feed:
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                <li>Log into your university Canvas portal in a browser.</li>
                <li>
                  Click <strong>Calendar</strong> in the left global navigation sidebar.
                </li>
                <li>
                  In the right sidebar or footer, click <strong>Calendar Feed</strong>.
                </li>
                <li>
                  Copy the private URL ending in{" "}
                  <code className="text-[var(--accent-ink)] font-mono">.ics</code> and paste it
                  below:
                </li>
              </ol>
            </div>

            <div>
              <label
                htmlFor="settings-canvas-ical"
                className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
              >
                Canvas Private iCal Feed URL
              </label>
              <input
                id="settings-canvas-ical"
                type="url"
                value={canvasIcalUrl}
                onChange={(e) => setCanvasIcalUrl(e.target.value)}
                placeholder="https://canvas.institution.edu/feeds/calendars/user_...ics"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveCanvas}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
              >
                {canvasFeed ? "Update Canvas Feed" : "Connect Canvas Feed"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Blackboard Learn Integration Accordion */}
      <div
        data-testid="settings-blackboard-card"
        className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
      >
        <button
          type="button"
          aria-label="Blackboard Learn Calendar Feed"
          onClick={() => setBlackboardAccordionOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Blackboard Learn Integration
            </h3>
            {blackboardFeed?.enabled && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                Connected
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
            <span>{blackboardAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
            {blackboardAccordionOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
        </button>

        {blackboardAccordionOpen && (
          <div className="mt-3.5 space-y-3 pt-3 border-t border-[var(--border)]">
            {/* Step-by-step instructions */}
            <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
              <div className="font-bold text-[var(--text)]">
                How to extract your Blackboard Calendar Link:
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                <li>Log into your university Blackboard Learn portal.</li>
                <li>
                  Navigate to the <strong>Calendar</strong> tool from the base navigation or course
                  list.
                </li>
                <li>
                  At the bottom or under the gear icon, click <strong>Share Calendar</strong> or{" "}
                  <strong>External Calendar Link</strong>.
                </li>
                <li>
                  Copy the generated{" "}
                  <code className="text-[var(--accent-ink)] font-mono">.ics</code> webcal or https
                  link and paste it below:
                </li>
              </ol>
            </div>

            <div>
              <label
                htmlFor="settings-blackboard-ical"
                className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
              >
                Blackboard Calendar Feed URL
              </label>
              <input
                id="settings-blackboard-ical"
                type="url"
                value={blackboardIcalUrl}
                onChange={(e) => setBlackboardIcalUrl(e.target.value)}
                placeholder="https://blackboard.institution.edu/webapps/calendar/export/..."
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveBlackboard}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
              >
                {blackboardFeed ? "Update Blackboard Feed" : "Connect Blackboard Feed"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Notification Preferences Section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {copy.settings.notificationPrefsTitle}
        </h3>
        <p className="text-xs text-[var(--text-muted)]">{copy.settings.notificationPrefsNote}</p>
      </div>

      {/* External ICS Feeds Section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {copy.settings.feedsTitle}
        </h3>

        <form onSubmit={handleAddFeed} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            required
            aria-label="Feed name"
            value={newFeedName}
            onChange={(e) => setNewFeedName(e.target.value)}
            placeholder={copy.settings.feedNamePlaceholder}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none sm:w-1/3"
          />
          <input
            type="url"
            required
            aria-label="Feed HTTPS URL"
            value={newFeedUrl}
            onChange={(e) => setNewFeedUrl(e.target.value)}
            placeholder={copy.settings.feedUrlPlaceholder}
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base sm:text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-[var(--accent-fill)] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]"
          >
            {copy.settings.addFeed}
          </button>
        </form>

        {feeds.length === 0 ? (
          <div className="text-xs italic text-[var(--text-muted)]">{copy.settings.noFeeds}</div>
        ) : (
          <div className="space-y-2">
            {feeds.map((feed) => (
              <div
                key={feed.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-[var(--text)]">{feed.name}</div>
                  <div className="truncate text-xs text-[var(--text-muted)]">{feed.url}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={feed.enabled}
                    aria-label={`Enable feed ${feed.name}`}
                    onClick={() => upsertFeed({ ...feed, enabled: !feed.enabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      feed.enabled ? "bg-[var(--accent-fill)]" : "bg-slate-300 dark:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-2xs transition-transform ${
                        feed.enabled ? "translate-x-[18px]" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFeed(feed.id)}
                    aria-label={`Delete feed ${feed.name}`}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Backup, Restore & Reset Section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {copy.settings.backupHeader}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              exportBackupFile();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>{copy.settings.exportBackup}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (isBrowserTier) {
                backupFileInputRef.current?.click();
              } else {
                void importBackupFile();
              }
            }}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{copy.settings.importBackup}</span>
          </button>
          <input
            ref={backupFileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label={copy.settings.importBackup}
            className="hidden"
            onChange={handleBrowserImportBackup}
          />

          <button
            type="button"
            onClick={handleResetData}
            className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-500/10 dark:text-red-400"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>{copy.settings.resetDatabase}</span>
          </button>
        </div>
      </div>

      {/* Software Updates Section */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.updaterHeader}
            </h3>
            <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
              {updateResult || `Current release: v${APP_VERSION}`}
            </div>
          </div>
          <button
            type="button"
            disabled={updateChecking}
            onClick={handleCheckUpdate}
            className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] disabled:opacity-50"
          >
            {updateChecking ? "Checking…" : copy.settings.checkUpdates}
          </button>
        </div>
      </div>

      {/* Advanced Settings (Folded Accordion at the bottom) */}
      <details className="group rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 transition">
        <summary className="flex cursor-pointer items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text)]">
          <span>Advanced Settings &amp; Custom OAuth Overrides</span>
          <ChevronRight
            className="h-4 w-4 transition-transform group-open:rotate-90 text-[var(--text-muted)]"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-4 pt-3 border-t border-[var(--border)] space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            The app ships with working built-in Google OAuth credentials out-of-the-box. Only enter
            custom client IDs below if you wish to override the built-in configuration with your own
            Google Cloud Console or Microsoft Azure tenant app.
          </p>
          <div>
            <label
              htmlFor="settings-google-client-id"
              className="block text-xs font-semibold text-[var(--text)] mb-1"
            >
              Google Client ID (Optional Override)
            </label>
            <input
              id="settings-google-client-id"
              type="text"
              placeholder="Leave empty to use built-in Google client"
              value={config.googleClientId || ""}
              onChange={(e) => updateConfig({ googleClientId: e.target.value.trim() || undefined })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-base sm:text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="settings-ms-client-id"
              className="block text-xs font-semibold text-[var(--text)] mb-1"
            >
              Microsoft Azure Client ID (Optional Override)
            </label>
            <input
              id="settings-ms-client-id"
              type="text"
              placeholder="Leave empty to use built-in Microsoft client"
              value={config.teamsClientId || ""}
              onChange={(e) => updateConfig({ teamsClientId: e.target.value.trim() || undefined })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-base sm:text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        </div>
      </details>
    </section>
  );
}
