import { User, LogIn, LogOut, Settings, X, ShieldCheck } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";

export function AccountProfileModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const googleLogout = useAppStore((s) => s.googleLogout);
  const microsoftLogin = useAppStore((s) => s.microsoftLogin);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const openModal = useAppStore((s) => s.openModal);

  const displayName = auth.name || config.userName || "Student User";
  const displayEmail = auth.email || config.userEmail || "Local Mode";

  const handleOpenSettings = () => {
    onClose();
    openModal({ id: "settings", props: { initialTab: "account" }, flush: true, size: "lg" });
  };
  return (
    <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <h2 id="account-profile-title" className="text-base font-bold text-[var(--text)]">
          Account Profile
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 flex flex-col items-center text-center">
        {auth.picture || config.userPicture ? (
          <img
            src={auth.picture || config.userPicture || ""}
            alt={displayName}
            className="h-16 w-16 rounded-full border-2 border-[var(--border)] object-cover shadow-sm mb-3"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-3">
            <User className="h-8 w-8" />
          </div>
        )}

        <div className="text-sm font-bold text-[var(--text)]">{displayName}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{displayEmail}</div>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Local Device Keyring Storage</span>
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-4">
        {auth.authenticated ? (
          <button
            type="button"
            onClick={googleLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
          >
            <LogOut className="h-4 w-4" />
            <span>Disconnect Google</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={googleLogin}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition"
          >
            <LogIn className="h-4 w-4" />
            <span>Connect Google Account</span>
          </button>
        )}

        {auth.hasTeamsAuth ? (
          <button
            type="button"
            onClick={microsoftLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
          >
            <LogOut className="h-4 w-4" />
            <span>Disconnect Microsoft Teams</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={microsoftLogin}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
          >
            <LogIn className="h-4 w-4" />
            <span>Connect Microsoft Teams</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleOpenSettings}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition mt-2"
        >
          <Settings className="h-4 w-4" />
          <span>Full Settings</span>
        </button>
      </div>
    </div>
  );
}
