import React, { useState } from "react";
import { ArrowLeft, Radio } from "lucide-react";
import { COURSE_PALETTE_PRESETS, coursePalette } from "../lib/coursePalette";
import { copy } from "../copy";
import { MiniCalendar } from "../components/MiniCalendar";
import { useAppStore } from "../state/store";

export const DevRig: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const addToast = useAppStore((s) => s.addToast);
  const openModal = useAppStore((s) => s.openModal);
  const [selectedDate, setSelectedDate] = useState("2026-10-23");

  const sampleCourses = [
    { id: "CSE241", name: "Digital Design", ...coursePalette("CSE241") },
    { id: "MAT102", name: "Calculus II", ...coursePalette("MAT102") },
    { id: "PHY201", name: "University Physics", ...coursePalette("PHY201") },
  ];

  return (
    <div
      data-testid="dev-rig-container"
      className="min-h-screen bg-[var(--page)] p-6 text-[var(--text)]"
    >
      {/* Dev Rig Header */}
      <div className="mb-8 flex items-center justify-between border-b border-[var(--surface-border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-sm">
            <Radio className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">QuizRadar Component DevRig</h1>
            <p className="text-xs text-[var(--text-muted)]">
              Isolated component showcase · Zero backend side-effects · No demo universe hacks
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-2 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Exit DevRig</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Section 1: Color Tokens & Course Palettes */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Design Tokens & Course Palettes (8 Presets)
          </h2>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {COURSE_PALETTE_PRESETS.map((color, idx) => (
              <div
                key={color}
                className="flex flex-col items-center rounded-xl border border-[var(--surface-border)] p-2.5 text-center shadow-xs"
              >
                <span
                  className="h-8 w-8 rounded-full shadow-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="mt-2 text-[11px] font-bold">Preset {idx + 1}</span>
                <span className="text-[10px] text-[var(--text-muted)] uppercase">{color}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-[var(--surface-border)] pt-4">
            <span className="text-xs font-semibold text-[var(--text-muted)]">
              Sample Course Chips (Deterministic FNV-1a derived)
            </span>
            <div className="flex flex-wrap gap-2">
              {sampleCourses.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: c.bg,
                    borderColor: c.border,
                    color: c.color,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.id} · {c.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Mini Month Calendar */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Mini Month Calendar (Pure & Reactive)
          </h2>
          <div className="mt-4 max-w-xs">
            <MiniCalendar
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              assessmentDates={["2026-10-23", "2026-10-27", "2026-11-03"]}
            />
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Selected Date: <code className="font-semibold">{selectedDate}</code>
          </p>
        </div>

        {/* Section 3: Modal Stack Test Trigger */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Declarative Modal Stack (Escape & Focus Trap)
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Test layered modal opening, focus entrapment, and Escape key dismissal order.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                openModal({ id: "dev-modal-alpha", props: { message: "Layer 1 modal dialog." } })
              }
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white shadow-sm"
            >
              Open Modal 1
            </button>
            <button
              type="button"
              onClick={() =>
                openModal({ id: "dev-modal-beta", props: { message: "Layer 2 stacked dialog." } })
              }
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)]"
            >
              Open Modal 2
            </button>
          </div>
        </div>

        {/* Section 4: Toast System Trigger */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Toast Notification System
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Test toast styling variants and automatic dismiss queues.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                addToast({ type: "info", message: "Scan completed. 0 candidate emails found." })
              }
              className="rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            >
              Info Toast
            </button>
            <button
              type="button"
              onClick={() => addToast({ type: "success", message: copy.topBar.syncSynced })}
              className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
            >
              Success Toast
            </button>
            <button
              type="button"
              onClick={() =>
                addToast({ type: "warning", message: "Moodle session expired. Re-authenticate." })
              }
              className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 dark:bg-amber-900 dark:text-amber-200"
            >
              Warning Toast
            </button>
            <button
              type="button"
              onClick={() =>
                addToast({ type: "error", message: "Failed to connect to Microsoft Graph." })
              }
              className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800 dark:bg-rose-900 dark:text-rose-200"
            >
              Error Toast
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
