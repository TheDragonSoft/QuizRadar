import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CloudSyncModal } from "./CloudSyncModal";
import { useAppStore, initialFullState } from "../state/store";
import { setupMockIndexedDb } from "../test/mockIndexedDb";

describe("CloudSyncModal Tier Honesty & Last Backup Status", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    teardownIdb();
    vi.restoreAllMocks();
  });

  it("titles the browser companion modal 'JSON Backup & Transfer' and distinguishes lastBackupPush", () => {
    useAppStore.setState({
      data: {
        ...initialFullState,
        config: { ...initialFullState.config, lastBackupPush: null },
      },
    });

    const { rerender } = render(<CloudSyncModal modalId="cloud-sync" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "JSON Backup & Transfer" })).toBeInTheDocument();
    expect(screen.getByText("Cross-Device JSON Transfer")).toBeInTheDocument();
    expect(screen.queryByText("Transfer to Android Mobile")).not.toBeInTheDocument();
    expect(screen.getByTestId("cloud-sync-last-backup")).toHaveTextContent("Never backed up");

    useAppStore.setState({
      data: {
        ...initialFullState,
        config: { ...initialFullState.config, lastBackupPush: "2026-11-12T09:14:00Z" },
      },
    });
    rerender(<CloudSyncModal modalId="cloud-sync" onClose={vi.fn()} />);

    expect(screen.getByTestId("cloud-sync-last-backup")).toHaveTextContent(/Nov 12, 2026/i);
    expect(screen.getByTestId("cloud-sync-last-backup")).not.toHaveTextContent("Never backed up");
  });

  it("titles the desktop tier modal 'Cloud Backup & Transfer'", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    useAppStore.setState({
      data: {
        ...initialFullState,
        config: { ...initialFullState.config, lastBackupPush: "2026-11-12T09:14:00Z" },
      },
    });

    render(<CloudSyncModal modalId="cloud-sync" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Cloud Backup & Transfer" })).toBeInTheDocument();
    expect(screen.getByText("Google Drive AppData Backup")).toBeInTheDocument();
  });
});
