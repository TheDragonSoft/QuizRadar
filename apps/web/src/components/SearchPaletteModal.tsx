import { useState, useEffect, useMemo, useRef } from "react";
import { Search as SearchIcon, X, BookOpen, ArrowRight, History } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { coursePalette } from "../lib/coursePalette";

const RECENTS_STORAGE_KEY = "quizradar_recent_searches";

export function SearchPaletteModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "ASSESSMENT" | "COURSE" | "SLOT">("ALL");
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const setView = useAppStore((s) => s.setView);

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
  }, []);

  // Save query to recents
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        const courseMatch =
          a.courseId?.toLowerCase().includes(q) || a.courseName?.toLowerCase().includes(q);
        const instructorMatch = a.instructor?.toLowerCase().includes(q);
        const topicMatch = a.topics?.some((t) => t.toLowerCase().includes(q));

        if (titleMatch || courseMatch || instructorMatch || topicMatch) {
          matches.push({
            id: a.id,
            type: "ASSESSMENT",
            title: a.title,
            subtitle: `${a.courseId || "General"} · ${a.assessmentType} · ${a.displayTime || a.dateIso || "Undated"}`,
            courseId: a.courseId,
            dateIso: a.dateIso,
            badgeText: a.assessmentType,
          });
        }
      });
    }

    // Search Courses
    if (filterType === "ALL" || filterType === "COURSE") {
      courses.forEach((c) => {
        if (c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) {
          matches.push({
            id: c.id,
            type: "COURSE",
            title: `${c.id} — ${c.name}`,
            subtitle: "Enrolled Course",
            courseId: c.id,
            badgeText: "Course",
          });
        }
      });
    }

    // Search Schedule Slots (Classes)
    if (filterType === "ALL" || filterType === "SLOT") {
      slots.forEach((s) => {
        if (
          s.courseId.toLowerCase().includes(q) ||
          s.courseName.toLowerCase().includes(q) ||
          s.room?.toLowerCase().includes(q) ||
          s.type.toLowerCase().includes(q)
        ) {
          matches.push({
            id: s.id,
            type: "SLOT",
            title: `${s.courseId} ${s.type}`,
            subtitle: `${s.day} ${s.displayTime} @ ${s.room || "—"}`,
            courseId: s.courseId,
            badgeText: s.type,
          });
        }
      });
    }

    return matches.slice(0, 20);
  }, [query, filterType, assessments, courses, slots]);

  const handleSelectResult = (item: (typeof results)[0]) => {
    addRecent(item.title);
    onClose();

    if (item.type === "ASSESSMENT") {
      openAssessmentDetail(item.id);
    } else if (item.type === "COURSE") {
      setView("calendar");
    } else if (item.type === "SLOT") {
      setView("calendar");
    }
  };

  return (
    <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl transition-all overflow-hidden">
      {/* The palette is a command surface: the input is the only visible
          control, so the dialog needs a heading of its own to be named. */}
      <h2 id="search-palette-title" className="sr-only">
        {copy.search.title}
      </h2>
      {/* Search Input Bar */}
      <div className="flex items-center border-b border-[var(--border)] px-4 py-3.5">
        <SearchIcon className="h-5 w-5 text-[var(--text-muted)] shrink-0 mr-3" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-palette-results"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (results.length > 0) {
                handleSelectResult(results[0]);
              } else if (query.trim()) {
                addRecent(query.trim());
              }
            }
          }}
          placeholder={copy.search.placeholder}
          className="w-full bg-transparent text-sm font-medium text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={copy.search.clearQuery}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] mr-2"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--border)]/20"
        >
          Esc
        </button>
      </div>

      {/* Filter Type Pills */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--page)] px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => setFilterType("ALL")}
          className={`rounded-lg px-2.5 py-1 font-semibold transition ${
            filterType === "ALL"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.search.typeAll}
        </button>
        <button
          type="button"
          onClick={() => setFilterType("ASSESSMENT")}
          className={`rounded-lg px-2.5 py-1 font-semibold transition ${
            filterType === "ASSESSMENT"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.search.typeAssessments}
        </button>
        <button
          type="button"
          onClick={() => setFilterType("COURSE")}
          className={`rounded-lg px-2.5 py-1 font-semibold transition ${
            filterType === "COURSE"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.search.typeCourses}
        </button>
        <button
          type="button"
          onClick={() => setFilterType("SLOT")}
          className={`rounded-lg px-2.5 py-1 font-semibold transition ${
            filterType === "SLOT"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.search.typeClasses}
        </button>
      </div>

      {/* Results / Recents List */}
      <div id="search-palette-results" className="max-h-96 overflow-y-auto p-2">
        {!query && recents.length > 0 && (
          <div className="p-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              <History className="h-3.5 w-3.5" />
              <span>{copy.search.recents}</span>
            </div>
            <div className="space-y-1">
              {recents.map((recentText) => (
                <div
                  key={recentText}
                  role="button"
                  tabIndex={0}
                  onClick={() => setQuery(recentText)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setQuery(recentText);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-[var(--text)] hover:bg-[var(--border)]/20 cursor-pointer"
                >
                  <span className="truncate">{recentText}</span>
                  <button
                    type="button"
                    onClick={(e) => removeRecent(recentText, e)}
                    className="p-1 text-[var(--text-muted)] hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {query && results.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--text-muted)]">
            {copy.search.noResults(query)}
          </div>
        )}

        {query && results.length > 0 && (
          <div className="space-y-1">
            {results.map((item) => {
              const colorInfo = item.courseId ? coursePalette(item.courseId) : null;
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => handleSelectResult(item)}
                  className="w-full flex items-center justify-between rounded-xl p-2.5 text-left transition hover:bg-[var(--border)]/25 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Course Color Pill or Icon */}
                    {item.courseId ? (
                      <span
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: colorInfo?.color || "var(--accent)" }}
                      >
                        {item.courseId.slice(0, 3)}
                      </span>
                    ) : (
                      <span className="h-7 w-7 rounded-lg flex items-center justify-center bg-[var(--border)] text-[var(--text-muted)] shrink-0">
                        <BookOpen className="h-4 w-4" />
                      </span>
                    )}

                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--text)] truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {item.badgeText && (
                      <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                        {item.badgeText}
                      </span>
                    )}
                    <ArrowRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Instructions */}
      <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--page)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
        <span>{copy.search.instructions}</span>
        <span>{copy.brand.name}</span>
      </div>
    </div>
  );
}
