import React from "react";
import {
  CheckCircle2,
  Link,
  Map as MapIcon,
  Plus,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";
import { copy } from "../../copy";

export const FirstRunEmpty: React.FC<{ onAddCourse: () => void; onConnect: () => void }> = ({
  onAddCourse,
  onConnect,
}) => (
  <div
    data-testid="empty-dashboard-no-courses"
    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"
  >
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <MapIcon className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyEmptyTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">
      {copy.dashboard.studyEmptyBody}
    </p>
    <div className="flex items-center justify-center gap-2 pt-1">
      <button
        type="button"
        onClick={onAddCourse}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[var(--accent-fill-hover)] active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.dashboard.studyEmptyAddCourse}</span>
      </button>
      <button
        type="button"
        onClick={onConnect}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition active:scale-95 dark:border-slate-700 dark:text-slate-200"
      >
        <Link className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.dashboard.connectAccount}</span>
      </button>
    </div>
  </div>
);

/** The study panel's "nothing matched" state. Deliberately NOT the all-clear
 *  card: the plans are still pending, the search just hid them. */
export const SearchNoMatchesEmpty: React.FC<{
  title: string;
  body: string;
  onClear: () => void;
}> = ({ title, body, onClear }) => (
  <div
    data-testid="study-empty-search"
    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"
  >
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <SearchIcon className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">{title}</div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">{body}</p>
    <button
      type="button"
      onClick={onClear}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition active:scale-95 dark:border-slate-700 dark:text-slate-200"
    >
      <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{copy.dashboard.searchClear}</span>
    </button>
  </div>
);

export const AllClearEmpty: React.FC<{ onCreateEvent: () => void }> = ({ onCreateEvent }) => (
  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyAllClearTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">
      {copy.dashboard.studyAllClearBody}
    </p>
    <button
      type="button"
      onClick={onCreateEvent}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[var(--accent-fill-hover)] active:scale-95"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{copy.dashboard.studyAddCustomEvent}</span>
    </button>
  </div>
);
