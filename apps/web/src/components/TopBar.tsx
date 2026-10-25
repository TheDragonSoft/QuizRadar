import React, { useEffect, useRef } from "react";
import { Moon, RefreshCw, Search, Settings, Sun, User } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";

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
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const openModal = useAppStore((s) => s.openModal);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: '/' focuses global search when not typing in form controls
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
        searchInputRef.current?.focus();
        onOpenSearch?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenSearch]);

  const syncLabel = {
    idle: copy.topBar.syncIdle,
    syncing: copy.topBar.syncScanning,
    success: copy.topBar.syncSynced,
    error: copy.topBar.syncFailed,
  }[syncStatus];

  const displayName = auth.name || auth.email || copy.topBar.userSignIn;

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
      openModal("account");
    }
  };

  return (
    <header
      data-testid="app-topbar"
      className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface)] px-4 transition-colors"
    >
      {/* Search Bar */}
      <div className="flex flex-1 max-w-md items-center">
        <div className="relative w-full">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={copy.topBar.searchPlaceholder}
            aria-label={copy.topBar.searchAriaLabel}
            className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page)] py-1.5 pl-9 pr-8 text-sm text-[var(--text)] placeholder-[var(--text-muted)] transition-colors focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
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
        {/* Sync Button */}
        <button
          type="button"
          onClick={() => triggerSync()}
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
          {auth.picture ? (
            <img
              src={auth.picture}
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
