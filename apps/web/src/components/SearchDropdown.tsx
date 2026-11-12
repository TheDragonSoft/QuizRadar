import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, X, BookOpen, ArrowRight, History } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { isDarkTheme } from "../state/storage";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";

const RECENTS_STORAGE_KEY = "quizradar_recent_searches";

type SearchFilterType = "ALL" | "ASSESSMENT" | "COURSE" | "SLOT";

/**
 * The top bar's search: a real input with its results attached underneath —
 * not a pop-out modal. Typing filters live; `/` or Ctrl/Cmd+K jumps here from
 * anywhere; Esc or an outside click closes it.
 */
export const SearchDropdown: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<SearchFilterType>("ALL");
  const [recents, setRecents] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const theme = useAppStore((s) => s.theme);
  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const setView = useAppStore((s) => s.setView);
  // The typed query is the app-wide search (spec §4.8: "typing re-renders
  // dashboard + calendar"). It lives in the store so every view can read it;
  // the input keeps its own copy for the immediate results list.
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
        const sourceMatch = a.source?.toLowerCase().includes(q) ?? false;

        if (
          titleMatch ||
          typeMatch ||
          courseMatch ||
          instructorMatch ||
          topicMatch ||
          roomMatch ||
          dateMatch ||
          sourceMatch
        ) {
          matches.push({
            id: a.id,
            type: "ASSESSMENT",
            title: a.title,
            subtitle: `${courseDisplayName(a.courseId, courses)} · ${a.assessmentType || "Assessment"} · ${a.displayTime || a.dateIso || "Undated"}`,
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
          matches.push({
            id: c.id,
            type: "COURSE",
            title: c.name,
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

  // A new result set always restarts the highlight at the top.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Keep the highlighted row visible while arrowing through the list.
  // (jsdom has no scrollIntoView — the optional call keeps tests alive.)
  useEffect(() => {
    if (results.length === 0) return;
    const el = document.getElementById(`search-result-${activeIndex}`) as
      (HTMLElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }) | null;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, results.length]);

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // `/` or Ctrl/Cmd+K jumps into the field from anywhere.
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
        if (useAppStore.getState().openModals.length > 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const closeAndReset = () => {
    setOpen(false);
    setQuery("");
    // Closing the search drops the app-wide filter too - otherwise the
    // dashboard would stay filtered by a query the user can no longer see.
    setSearchQuery("");
    inputRef.current?.blur();
  };

  const handleSelectResult = (item: (typeof results)[0]) => {
    addRecent(item.title);
    closeAndReset();

    if (item.type === "ASSESSMENT") {
      openAssessmentDetail(item.id);
    } else if (item.type === "COURSE") {
      setView("calendar");
    } else if (item.type === "SLOT") {
      setView("calendar");
    }
  };

  const expanded = open && results.length > 0;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:max-w-xl">
      <div
        className={`relative flex h-10 w-full min-w-[160px] sm:min-w-[200px] items-center rounded-2xl border bg-[var(--page)] shadow-xs transition-colors ${
          open
            ? "border-[var(--accent)] bg-[var(--surface)] ring-2 ring-blue-500/15"
            : "border-[var(--surface-border)] hover:bg-[var(--surface-hover)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)] focus-within:ring-2 focus-within:ring-blue-500/15"
        }`}
      >
        <SearchIcon
          className="pointer-events-none absolute left-3.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={copy.search.title}
          aria-expanded={open}
          aria-controls={open ? "topbar-search-results" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded ? `search-result-${Math.min(activeIndex, results.length - 1)}` : undefined
          }
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeAndReset();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActiveIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (results.length > 0) {
                handleSelectResult(results[Math.min(activeIndex, results.length - 1)]);
              } else if (query.trim()) {
                addRecent(query.trim());
              }
            }
          }}
          placeholder={copy.topBar.searchPlaceholder}
          className="w-full min-w-0 bg-transparent py-2 pl-9 pr-12 text-[13px] font-medium text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearchQuery("");
              inputRef.current?.focus();
            }}
            aria-label={copy.search.clearQuery}
            className="absolute right-2.5 p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <kbd
            className="pointer-events-none absolute right-2.5 hidden select-none items-center gap-0.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)] shadow-xs tabular-nums sm:flex"
            aria-hidden="true"
          >
            {copy.topBar.searchShortcut}
          </kbd>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-2xl">
          {/* Filter Type Pills */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs">
            {(
              [
                ["ALL", copy.search.typeAll],
                ["ASSESSMENT", copy.search.typeAssessments],
                ["COURSE", copy.search.typeCourses],
                ["SLOT", copy.search.typeClasses],
              ] as ReadonlyArray<[SearchFilterType, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterType(value)}
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  filterType === value
                    ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Results / Recents List */}
          <div id="topbar-search-results" className="max-h-96 min-h-0 overflow-y-auto p-2">
            {!query && recents.length > 0 && (
              <div className="p-2">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{copy.search.recents}</span>
                </div>
                <div className="space-y-1">
                  {recents.map((recentText) => (
                    <div
                      key={recentText}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setQuery(recentText);
                        setSearchQuery(recentText);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setQuery(recentText);
                          setSearchQuery(recentText);
                        }
                      }}
                      className="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_20%,transparent)]"
                    >
                      <span className="truncate">{recentText}</span>
                      <button
                        type="button"
                        onClick={(e) => removeRecent(recentText, e)}
                        aria-label={`Remove "${recentText}" from recents`}
                        className="rounded p-1.5 text-[var(--text-muted)] hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {query && results.length === 0 && (
              <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                {copy.search.noResults(query)}
              </div>
            )}

            {query && results.length > 0 && (
              <div className="space-y-1" role="listbox" aria-label={copy.search.title}>
                {results.map((item, index) => {
                  const colorInfo = item.courseId ? coursePalette(item.courseId) : null;
                  const chip = colorInfo
                    ? courseAccessibleChip(colorInfo.color, isDarkTheme(theme))
                    : null;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      id={`search-result-${index}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelectResult(item)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`group flex w-full items-center justify-between rounded-xl p-2.5 text-left transition ${
                        isActive
                          ? "bg-[color-mix(in_srgb,var(--border)_40%,transparent)]"
                          : "hover:bg-[color-mix(in_srgb,var(--border)_25%,transparent)]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {/* Course Color Pill or Icon */}
                        {item.courseId ? (
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                            style={{ backgroundColor: chip?.solidBg || "var(--accent-fill)" }}
                          >
                            {courseDisplayName(item.courseId, courses).slice(0, 2).toUpperCase()}
                          </span>
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--border)] text-[var(--text-muted)]">
                            <BookOpen className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}

                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-[var(--text)]">
                            {item.title}
                          </div>
                          <div className="truncate text-[11px] text-[var(--text-muted)]">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>

                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        {item.badgeText && (
                          <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                            {item.badgeText}
                          </span>
                        )}
                        <ArrowRight
                          className="h-4 w-4 text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Instructions */}
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--page)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
            <span>{copy.search.instructions}</span>
            <span>{copy.brand.name}</span>
          </div>
        </div>
      )}
    </div>
  );
};
