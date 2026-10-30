import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { copy } from "../copy";
import { addDaysToIsoDate, getWeekStart } from "../state/store";

/**
 * Interactive mini month calendar — v4 parity port
 * (v4-final:static/app.js `renderSidebar`).
 *
 * v4's rail calendar is *not* a month picker with its own navigation: the
 * chevrons move the selected WEEK and the grid always shows the month that
 * week falls in. The selected week's row is highlighted, the selected day is a
 * filled disc, today is an outlined disc, and any day carrying an assessment
 * gets a red dot.
 */

interface MiniCalendarProps {
  /** The selected week's start, `YYYY-MM-DD` (a Sunday). */
  weekStart: string;
  /** The selected day, `YYYY-MM-DD`. */
  selectedDate?: string;
  /** Every date carrying an assessment, `YYYY-MM-DD`. */
  assessmentDates?: string[];
  onSelectDate?: (dateIso: string) => void;
  onShiftWeek?: (deltaWeeks: number) => void;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function isoToUtcNoon(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function todayIso(): string {
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return anchor.toISOString().slice(0, 10);
}

export const MiniCalendar: React.FC<MiniCalendarProps> = ({
  weekStart,
  selectedDate,
  assessmentDates = [],
  onSelectDate,
  onShiftWeek,
}) => {
  const weekStartDate = isoToUtcNoon(weekStart);
  const year = weekStartDate.getUTCFullYear();
  const month = weekStartDate.getUTCMonth();

  // v4 renders six rows starting on the Sunday on or before the 1st.
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const gridStartIso = addDaysToIsoDate(
    `${year}-${String(month + 1).padStart(2, "0")}-01`,
    -firstOfMonth.getUTCDay(),
  );

  const rows: Array<Array<{ iso: string; day: number; inMonth: boolean }>> = [];
  for (let week = 0; week < 6; week += 1) {
    const rowStartIso = addDaysToIsoDate(gridStartIso, week * 7);
    const row: Array<{ iso: string; day: number; inMonth: boolean }> = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const iso = addDaysToIsoDate(rowStartIso, dayIndex);
      const cell = isoToUtcNoon(iso);
      row.push({
        iso,
        day: cell.getUTCDate(),
        inMonth: cell.getUTCMonth() === month,
      });
    }
    rows.push(row);
  }

  const today = todayIso();

  return (
    <div data-testid="mini-calendar" className="px-0.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text)]">
          {MONTH_NAMES[month]} {year}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onShiftWeek?.(-1)}
            aria-label={copy.calendar.prevWeek}
            title={copy.calendar.prevWeek}
            className="-m-2 cursor-pointer rounded-md p-4 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onShiftWeek?.(1)}
            aria-label={copy.calendar.nextWeek}
            title={copy.calendar.nextWeek}
            className="-m-2 cursor-pointer rounded-md p-4 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium text-[var(--text-muted)]">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={`${initial}-${index}`}>{initial}</span>
        ))}
      </div>

      <div className="space-y-0.5 text-center text-[11px] tabular-nums">
        {rows.map((row) => {
          const rowStartIso = row[0].iso;
          const isSelectedWeek = rowStartIso === getWeekStart(weekStart);
          return (
            <div
              key={rowStartIso}
              className={`grid grid-cols-7 items-center py-0.5 ${
                isSelectedWeek ? "rounded-full bg-[var(--accent)]/10 dark:bg-blue-950/70" : ""
              }`}
            >
              {row.map((cell) => {
                const isSelected = cell.iso === selectedDate;
                const isToday = cell.iso === today;
                const hasAssessment = assessmentDates.includes(cell.iso);

                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => onSelectDate?.(cell.iso)}
                    aria-current={isSelected ? "date" : undefined}
                    className={`relative mx-auto flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-[11px] tabular-nums transition ${
                      isSelected
                        ? "bg-[var(--accent)] font-bold text-white"
                        : isToday
                          ? "border border-[var(--accent)] font-bold text-[var(--accent)] hover:bg-[var(--surface-hover)]"
                          : cell.inMonth
                            ? "font-medium text-[var(--text)] hover:bg-[var(--surface-hover)]"
                            : "text-[var(--text-muted)] opacity-50 hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <span>{cell.day}</span>
                    {hasAssessment && !isSelected && (
                      <span
                        className="absolute bottom-0.5 h-1 w-1 rounded-full bg-red-500"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
