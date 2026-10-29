import { copy } from "../copy";
import type { DesktopAuthProfile, DesktopConfig } from "./types";

export interface SyncStatusSummary {
  label: string;
  activeCount: number;
  statusVariant: "active" | "warning" | "neutral";
  lastSyncedText: string;
}

/**
 * The sources that are actually connected and enabled, named. This is the
 * single honest source of truth for the "N sources" counts: the dashboard KPI
 * card used to hardcode a `true` for Gmail and a static "Gmail, Teams,
 * Moodle" line, which claimed connections the user never made.
 */
export function computeActiveSourceLabels(
  config?: Partial<DesktopConfig> | null,
  auth?: Partial<DesktopAuthProfile> | null,
): string[] {
  if (!config && !auth) return [];
  const labels: string[] = [];

  // Gmail
  if (auth?.hasGmailScope || (auth?.authenticated && config?.lastGmailSync)) {
    labels.push("Gmail");
  }

  // Microsoft Teams
  if (config?.teamsEnabled && auth?.hasTeamsAuth) {
    labels.push("Teams");
  }

  // Moodle
  if (config?.moodleEnabled && (config?.moodleUrl || config?.moodleIcalUrl)) {
    labels.push("Moodle");
  }

  // Google Classroom
  if (config?.classroomEnabled && auth?.authenticated) {
    labels.push("Classroom");
  }

  // Active feeds (under the user's own label for each one)
  if (config?.feeds && Array.isArray(config.feeds)) {
    for (const feed of config.feeds) {
      if (feed.enabled) labels.push(feed.name || feed.id);
    }
  }

  return labels;
}

export function computeActiveSourceCount(
  config?: Partial<DesktopConfig> | null,
  auth?: Partial<DesktopAuthProfile> | null,
): number {
  return computeActiveSourceLabels(config, auth).length;
}

export function formatLastSynced(timestamp?: string | null): string {
  if (!timestamp || !timestamp.trim()) {
    return copy.sidebar.syncFooter.neverSynced;
  }
  return copy.sidebar.syncFooter.lastSynced(timestamp);
}

export function computeSyncStatusSummary(
  config?: Partial<DesktopConfig> | null,
  auth?: Partial<DesktopAuthProfile> | null,
): SyncStatusSummary {
  const activeCount = computeActiveSourceCount(config, auth);
  const lastSyncTimestamp = config?.lastGmailSync || config?.lastGcalSync || null;
  const lastSyncedText = formatLastSynced(lastSyncTimestamp);

  if (activeCount > 0) {
    return {
      label: copy.sidebar.syncFooter.radarActive(activeCount),
      activeCount,
      statusVariant: "active",
      lastSyncedText,
    };
  }

  if (auth?.authenticated) {
    return {
      label: copy.sidebar.syncFooter.signedInAutoOff,
      activeCount: 0,
      statusVariant: "warning",
      lastSyncedText,
    };
  }

  return {
    label: copy.sidebar.syncFooter.noSources,
    activeCount: 0,
    statusVariant: "neutral",
    lastSyncedText,
  };
}
