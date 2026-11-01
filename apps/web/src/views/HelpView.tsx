import React, { useState } from "react";
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
  Keyboard,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { RadarMark } from "../components/BrandMarks";

export const HelpView: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (idx: number) => {
    setOpenFaq((prev) => (prev === idx ? null : idx));
  };

  const FAQS = [
    {
      q: "Where are my credentials and tokens stored?",
      a: "On Desktop, OAuth tokens live strictly inside your OS Keyring (Windows Credential Manager / macOS Keychain / Linux Secret Service). On Android, they reside in EncryptedSharedPreferences. On the Web PWA companion, sessions are kept in short-lived memory only. Tokens never cross a network or leave your hardware.",
    },
    {
      q: "Does QuizRadar require or communicate with a central cloud server?",
      a: "No. QuizRadar is entirely zero-server. All parsers, timetable conflict algorithms, and calendar computations run locally inside the Rust core (or pure Rust WebAssembly). There is no user tracking, no backend database, and no telemetry.",
    },
    {
      q: "How does the AI assistant extract announcements without compromising privacy?",
      a: "QuizRadar uses BYOK (Bring Your Own Key) directly with Google Gemini. Requests travel securely via HTTPS straight from your client device to Google's API using header authentication. Your key is kept in local secure storage, never shared or proxied.",
    },
    {
      q: "Can I export my exam dates to Google Calendar or Outlook?",
      a: "Yes. You can perform 2-way synchronization with Google Calendar directly from Desktop, or export universal standard .ics calendar files from any assessment detail modal.",
    },
  ];

  return (
    <section data-testid="view-help" className="view-transition space-y-8 max-w-5xl mx-auto pb-12">
      {/* Brand Hero Banner */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-gradient-to-r from-blue-700 via-indigo-800 to-slate-900 p-6 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <RadarMark animated className="h-12 w-12 shrink-0 drop-shadow-md" />
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Platform Capabilities &amp; Companion Help
            </h1>
            <p className="mt-1 text-xs text-blue-100 max-w-xl leading-relaxed">
              Zero-server, local-first intelligence engine for student timetables, exam radar, study
              roadmap, and calendar sync.
            </p>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Cheatsheet */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-[var(--accent-ink)] font-bold text-sm">
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          <span>Keyboard Shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Search</span>
            <kbd className="keycap">/</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Dashboard</span>
            <kbd className="keycap">D</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Study Tasks</span>
            <kbd className="keycap">T</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Week Calendar</span>
            <kbd className="keycap">C</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Focus Timer</span>
            <kbd className="keycap">F</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Help Screen</span>
            <kbd className="keycap">?</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Settings Modal</span>
            <kbd className="keycap">S</kbd>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
            <span className="text-[var(--text-muted)] font-medium">Dismiss / Close</span>
            <kbd className="keycap">Esc</kbd>
          </div>
        </div>
      </div>

      {/* Tier Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-bold text-sm">
            <Monitor className="h-4 w-4" aria-hidden="true" />
            <span>Desktop Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Full native workstation hub. Runs Tauri 2 with in-process Rust core, OS keyring token
            storage, background source sync, and 2-way Google Calendar push.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-800 dark:text-blue-300 text-[11px] font-semibold">
            Status: Primary Workstation
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
            <span>Android Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Full mobile companion. Jetpack Compose M3 bound to Rust via UniFFI,
            EncryptedSharedPreferences, WorkManager background sync, and live Glance home screen
            widgets.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
            Status: Primary Mobile
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm">
            <Globe className="h-4 w-4" aria-hidden="true" />
            <span>PWA Companion Tier</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Lightweight browser companion (current view). Pure Rust compiled to WebAssembly,
            IndexedDB storage, Service Worker offline cache, and 1h memory-only auth sessions.
          </p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-900 dark:text-amber-200 text-[11px] font-semibold">
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
                <td className="py-3 px-4 text-amber-800 dark:text-amber-300 font-medium">
                  Pure Rust WASM
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Local Storage Engine</td>
                <td className="py-3 px-4">
                  SQLite (
                  <code className="rounded bg-[var(--page)] px-1 py-0.5 font-mono text-[11px]">
                    quizradar.db
                  </code>
                  )
                </td>
                <td className="py-3 px-4">
                  SQLite (
                  <code className="rounded bg-[var(--page)] px-1 py-0.5 font-mono text-[11px]">
                    quizradar.db
                  </code>
                  )
                </td>
                <td className="py-3 px-4 text-amber-800 dark:text-amber-300 font-medium">
                  IndexedDB (
                  <code className="rounded bg-[var(--page)] px-1 py-0.5 font-mono text-[11px]">
                    quizradar
                  </code>
                  )
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Auto Background Scans</td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Full (OS loopback)
                </td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> WorkManager daemon
                  </span>
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Manual Scan button
                    only
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Google Calendar Auto-Sync</td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Direct GCal API push
                </td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Direct GCal API push
                  </span>
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-medium">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Unavailable · Export{" "}
                    <code className="rounded bg-[var(--page)] px-1 py-0.5 font-mono text-[11px]">
                      .ics
                    </code>
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Token Security & Storage</td>
                <td className="py-3 px-4">OS Keyring (Encrypted)</td>
                <td className="py-3 px-4">Android Keystore</td>
                <td className="py-3 px-4 text-amber-800 dark:text-amber-300 font-medium">
                  1h Memory-only (No disk tokens)
                </td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Home Screen Widget</td>
                <td className="py-3 px-4 text-[var(--text-muted)]">N/A</td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Glance Widget
                </td>
                <td className="py-3 px-4 text-[var(--text-muted)]">N/A (App Icon only)</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-medium">Offline Shell & Cache</td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> 100% Local
                </td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> 100% Local
                  </span>
                </td>
                <td className="py-3 px-4 text-emerald-700 dark:text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Service Worker
                    precache
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
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-400">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
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
              <Share2 className="h-3 w-3 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            </div>
            <p>Tap the Share button at the bottom of the screen (box with arrow pointing up).</p>
          </li>
          <li className="p-3.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] space-y-1">
            <div className="flex items-center gap-1 font-bold text-[var(--text)]">
              <span>3. Add to Home</span>
              <PlusSquare className="h-3 w-3 text-blue-700 dark:text-blue-400" aria-hidden="true" />
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
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span>Privacy & Security Guarantees</span>
        </div>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          QuizRadar operates with zero central servers. Your tokens never leave your device, your
          schedules and grades are stored locally on your own hardware, and AI requests travel
          directly from your device to Google&rsquo;s Gemini API with your own API key.
        </p>
      </div>

      {/* Frequently Asked Questions Accordion */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 space-y-4 shadow-xs">
        <div className="flex items-center gap-2 text-[var(--accent-ink)] font-bold text-sm">
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
          <span>Frequently Asked Questions</span>
        </div>
        <div className="divide-y divide-[var(--surface-border)]">
          {FAQS.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={idx} className="py-3">
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between text-left font-semibold text-xs text-[var(--text)] hover:text-[var(--accent-ink)] transition"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-[var(--accent-ink)]" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{faq.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
