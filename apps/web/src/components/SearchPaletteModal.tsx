import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X, BookOpen, ArrowRight, History } from "lucide-react";
import { useAppStore } from "../state/store";
import { isDarkTheme } from "../state/storage";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";

const RECENTS_STORAGE_KEY = "quizradar_recent_searches";
type SearchFilterType = "ALL" | "ASSESSMENT" | "COURSE" | "SLOT";

export const SearchPaletteModal: React.FC<{
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}> = ({ onClose }) => {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<SearchFilterType>("ALL");
  const [recents, setRecents] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const theme = useAppStore((s) => s.theme);
  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const setView = useAppStore((s) => s.setView);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);

  // Load recents on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENTS_STORAGE_KEY);
      if (saved) {
        setRecents(JSON.parse(saved).slice(0, 6));
      }
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  }, []);

  const addRecent = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const updated = [
      trimmed,
      ...recents.filter((r) => r.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, 6);
    setRecents(updated);
    try {
      localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const removeRecent = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = recents.filter((r) => r !== text);
    setRecents(updated);
    try {
      localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSearchQuery(val);
  };

  // Filtered search results
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const matches: Array<{
      id: string;
      type: "ASSESSMENT" | "COURSE" | "SLOT";
      title: string;
      subtitle: string;
      courseId?: string | null;
      dateIso?: string | null;
      badgeText?: string;
    }> = [];

    // Search Assessments
    if (filterType === "ALL" || filterType === "ASSESSMENT") {
      assessments.forEach((a) => {
        const titleMatch = a.title.toLowerCase().includes(q);
        const typeMatch = (a.assessmentType || "").toLowerCase().includes(q);
        const courseMatch =
          a.courseId?.toLowerCase().includes(q) || a.courseName?.toLowerCase().includes(q);
        const instructorMatch = a.instructor?.toLowerCase().includes(q);
        const topicMatch = a.topics?.some((t) => t.toLowerCase().includes(q));
        const roomMatch = a.room?.toLowerCase().includes(q) ?? false;
        const dateMatch = a.dateIso?.includes(q) ?? false;

        if (
          titleMatch ||
          typeMatch ||
          courseMatch ||
          instructorMatch ||
          topicMatch ||
          roomMatch ||
          dateMatch
        ) {
          matches.push({
            id: a.id,
            type: "ASSESSMENT",
            title: a.title,
            subtitle: `${courseDisplayName(a.courseId, courses)} · ${a.dateIso || "Undated"} ${
              a.displayTime ? `· ${a.displayTime}` : ""
            }`,
            courseId: a.courseId,
            dateIso: a.dateIso,
            badgeText: a.assessmentType || "Assessment",
          });
        }
      });
    }

    // Search Courses
    if (filterType === "ALL" || filterType === "COURSE") {
      courses.forEach((c) => {
        if (c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) {
          const courseSlotCount = slots.filter((s) => s.courseId === c.id).length;
          matches.push({
            id: c.id,
            type: "COURSE",
            title: c.name,
            subtitle: `${c.id} · ${courseSlotCount} weekly class slot(s)`,
            courseId: c.id,
            badgeText: "Course",
          });
        }
      });
    }

    // Search Slots
    if (filterType === "ALL" || filterType === "SLOT") {
      slots.forEach((s) => {
        const courseName = courseDisplayName(s.courseId, courses).toLowerCase();
        if (
          s.courseId.toLowerCase().includes(q) ||
          courseName.includes(q) ||
          s.day.toLowerCase().includes(q) ||
          (s.room && s.room.toLowerCase().includes(q))
        ) {
          matches.push({
            id: s.id,
            type: "SLOT",
            title: `${courseDisplayName(s.courseId, courses)} ${s.type}`,
            subtitle: `${s.day} ${s.displayTime} · ${s.room ? `@ ${s.room}` : "—"}`,
            courseId: s.courseId,
            badgeText: s.type,
          });
        }
      });
    }

    return matches.slice(0, 20);
  }, [query, filterType, assessments, courses, slots]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const handleSelectResult = (item: (typeof results)[0]) => {
    addRecent(item.title);
    onClose();

    if (item.type === "ASSESSMENT") {
      openAssessmentDetail(item.id);
    } else if (item.type === "COURSE" || item.type === "SLOT") {
      setView("calendar");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = results.length > 0 ? (prev + 1) % results.length : 0;
        document.getElementById(`search-result-${next}`)?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = results.length > 0 ? (prev - 1 + results.length) % results.length : 0;
        document.getElementById(`search-result-${next}`)?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIndex]) {
        handleSelectResult(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-testid="search-palette-modal"
      className="flex flex-col w-full overflow-hidden rounded-2xl bg-[var(--surface)] text-[var(--text)]"
    >
      <h2 id="search-palette-modal-title" className="sr-only">
        Search assessments, courses, and timetable
      </h2>

      {/* Top Search Input */}
      <div className="relative flex items-center border-b border-[var(--surface-border)] px-4 py-3.5">
        <SearchIcon className="h-5 w-5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls="search-palette-results"
          aria-activedescendant={results[activeIndex] ? `search-result-${activeIndex}` : undefined}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search assessments, courses, topics, rooms..."
          aria-label="Global search input"
          className="search-palette-input w-full bg-transparent px-3 text-sm font-medium text-[var(--text)] outline-none ring-0 border-0 focus:outline-none focus:ring-0 placeholder:text-[var(--text-muted)]"
          style={{ outline: "none", boxShadow: "none" }}
        />
        {query && (
          <button
            type="button"
            onClick={() => handleQueryChange("")}
            aria-label="Clear search"
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <kbd className="ml-2 hidden sm:inline-flex items-center rounded-md border border-[var(--surface-border)] bg-[var(--page)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
          ESC
        </kbd>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-[var(--surface-border)] px-4 py-2 bg-[var(--page)] text-xs">
        {(
          [
            { id: "ALL", label: "All" },
            { id: "ASSESSMENT", label: "Assessments" },
            { id: "COURSE", label: "Courses" },
            { id: "SLOT", label: "Class Slots" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterType(tab.id)}
            className={`rounded-lg px-2.5 py-1 font-semibold transition ${
              filterType === tab.id
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs border border-[var(--surface-border)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="max-h-[380px] min-h-[160px] overflow-y-auto p-2">
        {query.trim().length === 0 ? (
          <div className="p-4 space-y-4">
            {recents.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] mb-2">
                  <History className="h-3.5 w-3.5" />
                  <span>Recent Searches</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recents.map((r) => (
                    <div
                      key={r}
                      role="group"
                      aria-label={`Recent search ${r}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] text-xs font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => handleQueryChange(r)}
                        className="px-2.5 py-1 hover:text-[var(--accent-ink)] cursor-pointer"
                      >
                        {r}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => removeRecent(r, e)}
                        aria-label={`Remove recent search ${r}`}
                        className="pr-2 py-1 text-[var(--text-muted)] hover:text-red-500 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="text-center py-6 text-xs text-[var(--text-muted)]">
              Type to search across assessments, courses, timetable rooms, and study topics.
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            No matches found for &quot;{query}&quot;.
          </div>
        ) : (
          <div
            id="search-palette-results"
            role="listbox"
            aria-label="Search results"
            className="space-y-1"
          >
            {results.map((res, idx) => {
              const isActive = idx === activeIndex;
              const course = res.courseId ? courses.find((c) => c.id === res.courseId) : null;
              const hex =
                course?.color || (res.courseId ? coursePalette(res.courseId).color : "#1a73e8");
              const chip = res.courseId ? courseAccessibleChip(hex, isDarkTheme(theme)) : null;

              return (
                <div
                  key={`${res.type}-${res.id}-${idx}`}
                  id={`search-result-${idx}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSelectResult(res)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 cursor-pointer transition ${
                    isActive
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "hover:bg-[var(--surface-hover)] text-[var(--text)]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {res.courseId && chip ? (
                      <span
                        style={{
                          backgroundColor: chip.bg,
                          color: chip.text,
                          borderColor: chip.border,
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold"
                      >
                        {courseDisplayName(res.courseId, courses).slice(0, 3)}
                      </span>
                    ) : (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--page)] text-[var(--text-muted)]">
                        <BookOpen className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-[var(--text)]">
                        {res.title}
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-muted)]">
                        {res.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {res.badgeText && (
                      <span className="rounded-md bg-[var(--page)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] border border-[var(--surface-border)]">
                        {res.badgeText}
                      </span>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Navigation Hints */}
      <div className="flex items-center justify-between border-t border-[var(--surface-border)] px-4 py-2 bg-[var(--page)] text-[10px] text-[var(--text-muted)]">
        <div className="flex items-center gap-3">
          <span>
            <kbd className="font-semibold">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-semibold">↵</kbd> select
          </span>
          <span>
            <kbd className="font-semibold">esc</kbd> close
          </span>
        </div>
        <span>QuizRadar Search</span>
      </div>
    </div>
  );
};
