import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { copy } from "../copy";

interface MiniCalendarProps {
  selectedDate?: string; // YYYY-MM-DD
  onSelectDate?: (dateIso: string) => void;
  assessmentDates?: string[]; // YYYY-MM-DD set
}

export const MiniCalendar: React.FC<MiniCalendarProps> = ({
  selectedDate,
  onSelectDate,
  assessmentDates = [],
}) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "short",
  });

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Calculate grid
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const dayCells = [];

  // Prev month filler
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    dayCells.push({
      day,
      isCurrentMonth: false,
      dateIso: `${viewMonth === 0 ? viewYear - 1 : viewYear}-${String(viewMonth === 0 ? 12 : viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    dayCells.push({
      day,
      isCurrentMonth: true,
      dateIso: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  // Next month filler
  const totalSlots = Math.ceil(dayCells.length / 7) * 7;
  const remaining = totalSlots - dayCells.length;
  for (let day = 1; day <= remaining; day++) {
    dayCells.push({
      day,
      isCurrentMonth: false,
      dateIso: `${viewMonth === 11 ? viewYear + 1 : viewYear}-${String(viewMonth === 11 ? 1 : viewMonth + 2).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div
      data-testid="mini-calendar"
      className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2.5 shadow-sm"
      aria-label={copy.sidebar.miniCalendarTitle}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-bold text-[var(--text)]">
          {monthName} {viewYear}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-[var(--text-muted)]">
        <span>Su</span>
        <span>Mo</span>
        <span>Tu</span>
        <span>We</span>
        <span>Th</span>
        <span>Fr</span>
        <span>Sa</span>
      </div>

      {/* Day cells */}
      <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {dayCells.map((cell) => {
          const isToday = cell.dateIso === todayIso;
          const isSelected = cell.dateIso === selectedDate;
          const hasAssessment = assessmentDates.includes(cell.dateIso);

          return (
            <button
              key={cell.dateIso}
              type="button"
              onClick={() => onSelectDate?.(cell.dateIso)}
              className={`relative flex h-6 w-full items-center justify-center rounded-md text-[11px] font-medium transition ${
                isSelected
                  ? "bg-[var(--accent)] text-white font-bold"
                  : isToday
                    ? "border border-[var(--accent)] font-bold text-[var(--accent)]"
                    : cell.isCurrentMonth
                      ? "text-[var(--text)] hover:bg-[var(--surface-hover)]"
                      : "text-[var(--text-muted)] opacity-40 hover:opacity-70"
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
    </div>
  );
};
