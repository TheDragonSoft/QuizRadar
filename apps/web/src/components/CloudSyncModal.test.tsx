import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CloudSyncModal } from "./CloudSyncModal";
import { useAppStore, initialFullState } from "../state/store";
import { setRpcMockHandler } from "../state/rpc";
import { setupMockIndexedDb } from "../test/mockIndexedDb";

describe("CloudSyncModal Tier Honesty & Last Backup Status", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
  });

  afterEach(() => {
    setRpcMockHandler(null);
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

  it("renders the pairing QR SVG when Show Pairing QR Code is clicked", async () => {
    setRpcMockHandler((fn) => {
      if (fn === "export_sync_payload") {
        return Promise.resolve(
          JSON.stringify({
            schema_version: 1,
            client_device_id: "quizradar-pwa",
            updated_at: "2026-11-16T22:00:00Z",
            schedule: { semester: null, courses: [], slots: [] },
            assessments: [],
            completed_topics: {},
            grades: {},
            custom_events: [],
            feeds: [],
          }) as never,
        );
      }
      return null;
    });
    useAppStore.setState({
      data: {
        ...initialFullState,
        config: { ...initialFullState.config, lastBackupPush: null },
      },
    });

    render(<CloudSyncModal modalId="cloud-sync" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Pairing QR Code" }));

    await waitFor(() => {
      expect(screen.getByTestId("pair-qr-svg")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Hide QR Code" })).toBeInTheDocument();

    // Tap-to-enlarge opens full-width lightbox overlay
    fireEvent.click(screen.getByRole("button", { name: "Enlarge offline pairing QR code" }));
    expect(screen.getByTestId("expanded-qr-overlay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close enlarged QR code" }));
    expect(screen.queryByTestId("expanded-qr-overlay")).not.toBeInTheDocument();
  });

  it("starts and stops Desktop Instant Local Wi-Fi Sync (LAN HTTPS) with pinned QR", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const calls: string[] = [];
    setRpcMockHandler((fn) => {
      calls.push(fn);
      if (fn === "start_lan_pair_session") {
        return Promise.resolve({
          uri: "quizradar://lan?h=192.168.1.42&p=51823&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&fp=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&v=1",
          host: "192.168.1.42",
          port: 51823,
          expiresAtIso: new Date(Date.now() + 300_000).toISOString(),
          ttlSeconds: 300,
          qr: {
            version: 1,
            size: 21,
            modules: "1".repeat(21 * 21),
          },
        } as never);
      }
      if (fn === "stop_lan_pair_session") {
        return Promise.resolve(undefined as never);
      }
      return null;
    });
    useAppStore.setState({
      data: {
        ...initialFullState,
        config: { ...initialFullState.config, lastBackupPush: null },
      },
    });

    const { unmount } = render(<CloudSyncModal modalId="cloud-sync" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Start Wi-Fi Sync" }));

    await waitFor(() => {
      expect(screen.getByTestId("lan-pair-qr-svg")).toBeInTheDocument();
    });
    expect(screen.getByText(/https:\/\/192\.168\.1\.42:51823/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Wi-Fi Sync" })).toBeInTheDocument();

    unmount();
    expect(calls).toContain("stop_lan_pair_session");
  });
});
