import React, { useEffect, useRef, useState, useCallback } from "react";
import { Moon, RefreshCw, Search, Settings, Sun, User, Sparkles } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { UpdateCheckResult } from "../state/types";

interface TopBarProps {
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onOpenAuth?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onOpenSettings, onOpenSearch, onOpenAuth }) => {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const openModal = useAppStore((s) => s.openModal);
  const checkUpdate = useAppStore((s) => s.checkUpdate);

  const [updateAvailable, setUpdateAvailable] = useState<UpdateCheckResult | null>(null);
  const [showUpdatePopover, setShowUpdatePopover] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Check for updates on mount and every hour
  useEffect(() => {
    let cancelled = false;
    async function pollUpdate() {
      try {
        const res = await checkUpdate();
        if (!cancelled && res?.available) {
          const skipped = localStorage.getItem("quizradar_skip_version");
          if (skipped !== res.latestVersion) {
            setUpdateAvailable(res);
          }
        }
      } catch {
        // ignore update check failures
      }
    }
    pollUpdate();
    const hourlyTimer = setInterval(pollUpdate, 3600_000);
    return () => {
      cancelled = true;
      clearInterval(hourlyTimer);
    };
  }, [checkUpdate]);

  const handleOpenSearchModal = useCallback(() => {
    if (onOpenSearch) {
      onOpenSearch();
    } else {
      openModal("search");
    }
  }, [onOpenSearch, openModal]);

  // Keyboard shortcut: '/' focuses global search or opens search palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement).isContentEditable
        )
      ) {
        e.preventDefault();
        handleOpenSearchModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenSearchModal]);

  const syncLabel = {
    idle: copy.topBar.syncIdle,
    syncing: copy.topBar.syncScanning,
    success: copy.topBar.syncSynced,
    error: copy.topBar.syncFailed,
  }[syncStatus];

  const displayName =
    auth.name || config.userName || auth.email || config.userEmail || copy.topBar.userSignIn;

  const handleSettingsClick = () => {
    if (onOpenSettings) {
      onOpenSettings();
    } else {
      openModal("settings");
    }
  };

  const handleUserClick = () => {
    if (onOpenAuth) {
      onOpenAuth();
    } else {
      openModal("account-profile");
    }
  };

  const handleSyncClick = () => {
    openModal("scan-progress");
    triggerSync();
  };

  return (
    <header
      data-testid="app-topbar"
      className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface)] px-4 transition-colors"
    >
      {/* Search Bar */}
      <div className="flex flex-1 max-w-md items-center">
        <div className="relative w-full cursor-pointer" onClick={handleOpenSearchModal}>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            readOnly
            value={searchQuery}
            placeholder={copy.topBar.searchPlaceholder}
            aria-label={copy.topBar.searchAriaLabel}
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page)] py-1.5 pl-9 pr-8 text-sm text-[var(--text)] placeholder-[var(--text-muted)] transition-colors focus:border-[var(--accent)] focus:outline-none cursor-pointer"
          />
          <kbd
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[var(--surface-border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] shadow-sm"
            aria-hidden="true"
          >
            {copy.topBar.searchShortcut}
          </kbd>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-2">
        {/* Update Pill if update is available */}
        {updateAvailable && (
          <div className="relative">
            <button
              type="button"
              data-testid="update-pill-btn"
              onClick={() => setShowUpdatePopover((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{copy.topBar.updateAvailable}</span>
            </button>

            {showUpdatePopover && (
              <div
                data-testid="update-popover"
                className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl z-50 text-xs"
              >
                <div className="font-bold text-[var(--text)]">
                  QuizRadar v{updateAvailable.latestVersion} Available
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 max-h-24 overflow-y-auto">
                  {updateAvailable.body || "A new update is ready to install."}
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="skip-update-btn"
                    onClick={() => {
                      if (updateAvailable.latestVersion) {
                        try {
                          localStorage.setItem(
                            "quizradar_skip_version",
                            updateAvailable.latestVersion,
                          );
                        } catch {
                          // ignore
                        }
                      }
                      setUpdateAvailable(null);
                      setShowUpdatePopover(false);
                    }}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--border)]/30"
                  >
                    Skip this version
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUpdatePopover(false);
                      handleSettingsClick();
                    }}
                    className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]"
                  >
                    Update on next launch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync Button */}
        <button
          type="button"
          onClick={handleSyncClick}
          disabled={syncStatus === "syncing"}
          aria-label={syncLabel}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-[var(--accent)] ${syncStatus === "syncing" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{syncLabel}</span>
        </button>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? copy.topBar.themeLight : copy.topBar.themeDark}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--surface-border)] text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          )}
        </button>

        {/* User Chip */}
        <button
          type="button"
          onClick={handleUserClick}
          aria-label={auth.authenticated ? `Account: ${displayName}` : copy.topBar.userSignIn}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--surface-border)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          {auth.picture || config.userPicture ? (
            <img
              src={auth.picture || config.userPicture || ""}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
              aria-hidden="true"
            />
          ) : (
            <User className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
          )}
          <span className="max-w-[120px] truncate">{displayName}</span>
        </button>

        {/* Settings Button */}
        <button
          type="button"
          onClick={handleSettingsClick}
          aria-label={copy.topBar.settingsAria}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--surface-border)] text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          <Settings className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
