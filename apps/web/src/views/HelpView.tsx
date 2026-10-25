import React from "react";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Smartphone,
  Monitor,
  Globe,
  Share2,
  PlusSquare,
  ShieldCheck,
} from "lucide-react";

export const HelpView: React.FC = () => {
  return (
    <section data-testid="view-help" className="view-transition space-y-8 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
          Platform Capabilities & Companion Help
        </h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          QuizRadar is zero-server and local-first. We believe in total honesty about what each
          device tier can and cannot do.
        </p>
      </div>

      {/* Tier Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-blue-500 font-bold text-sm">
            <Monitor className="h-4 w-4" />
            <span>Desktop Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Full native workstation hub. Runs Tauri 2 with in-process Rust core, OS keyring token
            storage, background source sync, and 2-way Google Calendar push.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 text-[11px] font-semibold">
            Status: Primary Workstation
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm">
            <Smartphone className="h-4 w-4" />
            <span>Android Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Full mobile companion. Jetpack Compose M3 bound to Rust via UniFFI,
            EncryptedSharedPreferences, WorkManager background sync, and live Glance home screen
            widgets.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-semibold">
            Status: Primary Mobile
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-500 font-bold text-sm">
            <Globe className="h-4 w-4" />
            <span>PWA Companion Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Lightweight browser companion (current view). Pure Rust compiled to WebAssembly,
            IndexedDB storage, Service Worker offline cache, and 1h memory-only auth sessions.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 text-[11px] font-semibold">
            Status: Browser Companion
          </div>
        </div>
      </div>

      {/* Capability Matrix Table */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[var(--surface-border)] bg-[var(--page)] flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--text)]">Per-Tier Capability Matrix</h2>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">v5.0 Spec Locked</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-muted)] font-semibold">
                <th className="py-3 px-4">Feature / Capability</th>
                <th className="py-3 px-4">Desktop (Tauri 2)</th>
                <th className="py-3 px-4">Android (Compose)</th>
                <th className="py-3 px-4">PWA Companion (Browser)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--surface-border)] text-[var(--text)]">
              <tr>
                <td className="py-3 px-4 font-medium">Core Runtime</td>
                <td className="py-3 px-4">Native Rust</td>
                <td className="py-3 px-4">Native Rust (UniFFI)</td>
                <td className="py-3 px-4 text-amber-400">Pure Rust WASM</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Local Storage Engine</td>
                <td className="py-3 px-4">SQLite (`quizradar.db`)</td>
                <td className="py-3 px-4">SQLite (`quizradar.db`)</td>
                <td className="py-3 px-4 text-amber-400">IndexedDB (`quizradar`)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Auto Background Scans</td>
                <td className="py-3 px-4 text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> Full (OS loopback)
                </td>
                <td className="py-3 px-4 text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> WorkManager daemon
                  </span>
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" /> Manual Scan button only
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Google Calendar Auto-Sync</td>
                <td className="py-3 px-4 text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> Direct GCal API push
                </td>
                <td className="py-3 px-4 text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> Direct GCal API push
                  </span>
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5 text-rose-400">
                    <XCircle className="h-3.5 w-3.5" /> Unavailable · Export `.ics`
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Token Security & Storage</td>
                <td className="py-3 px-4">OS Keyring (Encrypted)</td>
                <td className="py-3 px-4">Android Keystore</td>
                <td className="py-3 px-4 text-amber-400">1h Memory-only (No disk tokens)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Home Screen Widget</td>
                <td className="py-3 px-4 text-[var(--text-muted)]">N/A</td>
                <td className="py-3 px-4 text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> Glance Widget
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">N/A (App Icon only)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Offline Shell & Cache</td>
                <td className="py-3 px-4 text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> 100% Local
                </td>
                <td className="py-3 px-4 text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> 100% Local
                  </span>
                </td>
                <td className="py-3 px-4 text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> Service Worker precache
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Cloud Backup Channel</td>
                <td className="py-3 px-4">Google Drive appData</td>
                <td className="py-3 px-4">Google Drive appData</td>
                <td className="py-3 px-4">File Export / Import</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* iOS Installation Panel */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 space-y-4">
        <div className="flex items-center gap-2.5 text-[var(--text)]">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">Add to Home Screen (iOS / iPadOS)</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Apple does not allow sideloading or background sync without App Store approval. The
              PWA provides a full standalone experience for iOS users.
            </p>
          </div>
        </div>

        <ol className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-[var(--text-muted)] mt-2">
          <li className="p-3.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] space-y-1">
            <span className="font-bold text-[var(--text)]">1. Open in Safari</span>
            <p>Ensure you are viewing QuizRadar in Apple Safari on your iPhone or iPad.</p>
          </li>
          <li className="p-3.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] space-y-1">
            <div className="flex items-center gap-1 font-bold text-[var(--text)]">
              <span>2. Tap Share</span>
              <Share2 className="h-3 w-3 text-blue-400" />
            </div>
            <p>Tap the Share button at the bottom of the screen (box with arrow pointing up).</p>
          </li>
          <li className="p-3.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] space-y-1">
            <div className="flex items-center gap-1 font-bold text-[var(--text)]">
              <span>3. Add to Home</span>
              <PlusSquare className="h-3 w-3 text-blue-400" />
            </div>
            <p>Scroll down the share sheet and select &ldquo;Add to Home Screen&rdquo;.</p>
          </li>
          <li className="p-3.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] space-y-1">
            <span className="font-bold text-[var(--text)]">4. Launch App</span>
            <p>Tap &ldquo;Add&rdquo;. QuizRadar will launch full-screen without browser chrome.</p>
          </li>
        </ol>
      </div>

      {/* Honesty Invariants */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 space-y-3">
        <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm">
          <ShieldCheck className="h-4 w-4" />
          <span>Privacy & Security Guarantees</span>
        </div>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          QuizRadar operates with zero central servers. Your tokens never leave your device, your
          schedules and grades are stored locally on your own hardware, and AI requests travel
          directly from your device to Google&rsquo;s Gemini API with your own API key.
        </p>
      </div>
    </section>
  );
};
