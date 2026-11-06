import { useState } from "react";
import { LogIn, LogOut, Settings, X, ShieldCheck, Database } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { isTauriEnvironment } from "../state/rpc";

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
  const openSettings = useAppStore((s) => s.openSettings);
  const [imgBroken, setImgBroken] = useState(false);

  const displayName = auth.name || config.userName || "Student User";
  const displayEmail = auth.email || config.userEmail || "Local Mode";
  const pictureUrl = auth.picture || config.userPicture || "";

  const handleOpenSettings = () => {
    onClose();
    openSettings("account");
  };

  // Sign-out wipes tokens — destructive enough to earn a confirmation step.
  const confirmSignOut = (provider: "google" | "microsoft") => {
    const logout = provider === "google" ? googleLogout : microsoftLogout;
    openModal({
      id: "app-confirm",
      props: {
        title: copy.accountProfile.signOutConfirmTitle,
        message: copy.accountProfile.signOutConfirmBody,
        destructive: true,
        confirmLabel: copy.accountProfile.signOutConfirmAction,
        onConfirm: () => {
          void logout();
        },
      },
    });
  };
  return (
    <div className="w-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <h2 id="account-profile-title" className="text-base font-bold text-[var(--text)]">
          {copy.accountProfile.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 flex flex-col items-center text-center">
        {pictureUrl && !imgBroken ? (
          <img
            src={pictureUrl}
            alt={displayName}
            onError={() => setImgBroken(true)}
            className="h-16 w-16 rounded-2xl border-2 border-[var(--border)] object-cover shadow-sm mb-3"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold text-xl shadow-md mb-3">
            {displayName
              .split(" ")
              .map((w) => w[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase() || "QR"}
          </div>
        )}

        <div className="text-sm font-bold text-[var(--text)]">{displayName}</div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">{displayEmail}</div>

        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {isTauriEnvironment()
              ? copy.accountProfile.storageKeyring
              : copy.accountProfile.storageMemory}
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-4">
        <p className="text-xs text-[var(--text-muted)] text-center">
          {copy.accountProfile.scopesNote}
        </p>

        {auth.authenticated ? (
          <button
            type="button"
            onClick={() => confirmSignOut("google")}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-500/10 transition"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{copy.accountProfile.signOutGoogle}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={googleLogin}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent-fill)] py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>{copy.accountProfile.connectGoogle}</span>
          </button>
        )}

        {auth.hasTeamsAuth ? (
          <button
            type="button"
            onClick={() => confirmSignOut("microsoft")}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{copy.accountProfile.signOutMicrosoft}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={microsoftLogin}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>{copy.accountProfile.connectMicrosoft}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            openModal({ id: "cloud-sync" });
          }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
        >
          <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>{copy.topBar.dataBackupTitle}</span>
        </button>

        <button
          type="button"
          onClick={handleOpenSettings}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition mt-2"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          <span>{copy.accountProfile.fullSettings}</span>
        </button>
      </div>
    </div>
  );
}
