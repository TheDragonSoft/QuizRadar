import { copy } from "../copy";
import type { DesktopAuthProfile, DesktopConfig } from "./types";

export interface SyncStatusSummary {
  label: string;
  activeCount: number;
  statusVariant: "active" | "warning" | "neutral";
  lastSyncedText: string;
}

export function computeActiveSourceCount(
  config?: Partial<DesktopConfig> | null,
  auth?: Partial<DesktopAuthProfile> | null,
): number {
  if (!config && !auth) return 0;
  let count = 0;

  // Gmail
  if (auth?.hasGmailScope || (auth?.authenticated && config?.lastGmailSync)) {
    count += 1;
  }

  // Microsoft Teams
  if (config?.teamsEnabled && auth?.hasTeamsAuth) {
    count += 1;
  }

  // Moodle
  if (config?.moodleEnabled && (config?.moodleUrl || config?.moodleIcalUrl)) {
    count += 1;
  }

  // Google Classroom
  if (config?.classroomEnabled && auth?.authenticated) {
    count += 1;
  }

  // Active feeds
  if (config?.feeds && Array.isArray(config.feeds)) {
    count += config.feeds.filter((f) => f.enabled).length;
  }

  return count;
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
