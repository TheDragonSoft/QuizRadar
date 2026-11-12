import React from "react";
import {
  BookOpen,
  Calendar,
  CalendarDays,
  CalendarPlus,
  MapPin,
  RefreshCw,
  Sparkles,
  UserCheck,
  Zap,
} from "lucide-react";
import { copy } from "../../copy";
import { useAppStore } from "../../state/store";
import { courseDisplayName } from "../../lib/coursePalette";
import { safeExternalUrl } from "../../lib/safeUrl";
import type { Assessment } from "../../state/types";
import { stripRoomPrefix } from "./formatters";

export interface NextUpHeroProps {
  assessment: Assessment | null;
  testId?: string;
  onOpenDetail: () => void;
  onOpenCalendar: () => void;
  onConnect: () => void;
  onSync: () => void;
}

const HERO_SHELL =
  "hero-view-transition relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-[#1e3a8a] via-[#1e40af] to-[#1d4ed8] dark:from-slate-900 dark:via-blue-950 dark:to-indigo-950 border border-blue-700/30 dark:border-blue-800/50 text-white p-3.5 sm:p-5 lg:p-6 shadow-sm";

/**
 * Sky over the hero gradient. Light mode gets a few dim stars and a soft sun
 * disc bleeding over the card's top-right edge; dark mode gets a denser,
 * brighter field split across two layers that pulse against each other (a
 * pure-CSS shimmer — no per-star DOM, no JS timer). All layers sit behind
 * the content via the shell's `isolate` + `-z-10`; reduced-motion users get
 * a static sky. Each animated layer is also promoted to its own compositing
 * layer (`composite-layer`) so its infinite opacity pulse runs on the GPU
 * instead of repainting the backdrop beneath the sticky canopy (Windows
 * flicker guard).
 */
const DAY_STARS: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [7, 24, 1, 0.28],
  [15, 64, 1.1, 0.2],
  [24, 32, 0.9, 0.35],
  [33, 74, 1, 0.22],
  [42, 18, 1.1, 0.3],
  [52, 52, 0.9, 0.25],
  [61, 30, 1, 0.3],
  [69, 70, 0.9, 0.2],
  [76, 40, 1, 0.28],
  [84, 58, 0.9, 0.22],
  [92, 34, 1, 0.3],
  [20, 86, 0.9, 0.25],
  [3, 48, 0.9, 0.22],
  [28, 52, 1, 0.18],
  [38, 88, 0.9, 0.2],
  [47, 38, 0.9, 0.24],
  [58, 82, 1, 0.2],
  [88, 72, 0.9, 0.22],
];

const NIGHT_STARS_A: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [4, 18, 1.4, 0.95],
  [14, 40, 1.2, 1],
  [18, 12, 1, 0.8],
  [27, 26, 1.4, 0.9],
  [36, 8, 1.6, 0.85],
  [45, 66, 1.1, 0.9],
  [49, 22, 1.5, 0.95],
  [57, 36, 1.2, 1],
  [66, 14, 1.3, 0.9],
  [74, 44, 1.4, 0.95],
  [83, 68, 1.3, 0.85],
  [91, 82, 1.2, 0.9],
  [50, 94, 1.1, 0.8],
  [12, 90, 1.3, 0.85],
  [8, 52, 1.2, 0.85],
  [22, 74, 1.1, 0.8],
  [31, 44, 1.3, 0.9],
  [41, 30, 1, 0.75],
  [55, 82, 1.2, 0.85],
  [63, 52, 1.1, 0.8],
  [80, 52, 1.7, 0.95],
  [86, 8, 1.3, 0.85],
];

const NIGHT_STARS_B: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [9, 72, 1.6, 0.9],
  [23, 58, 1.3, 0.85],
  [31, 84, 1.2, 0.8],
  [40, 46, 1.4, 0.9],
  [53, 88, 1.2, 0.75],
  [62, 60, 1.5, 0.9],
  [70, 78, 1.2, 0.8],
  [79, 20, 1.3, 0.85],
  [87, 34, 1.4, 0.9],
  [95, 50, 1.5, 0.85],
  [33, 12, 1.1, 0.7],
  [58, 6, 1.2, 0.75],
  [5, 38, 1.4, 0.85],
  [17, 92, 1.2, 0.75],
  [37, 62, 1.3, 0.85],
  [44, 74, 1.7, 0.9],
  [47, 10, 1.1, 0.7],
  [59, 28, 1.4, 0.9],
  [75, 92, 1.2, 0.8],
  [93, 68, 1.3, 0.85],
];

const starsToGradients = (stars: typeof DAY_STARS, isNight = false): string =>
  stars
    .map(([x, y, size, opacity]) => {
      const coreSize = isNight ? Math.max(2.4, size * 1.9) : Math.max(1.6, size * 1.4);
      const bloomSize = isNight ? Math.max(7.0, size * 5.6) : Math.max(3.5, size * 2.8);
      const bloomOpacity = (opacity * 0.45).toFixed(2);
      const outerOpacity = (opacity * 0.18).toFixed(2);
      return [
        `radial-gradient(${coreSize}px ${coreSize}px at ${x}% ${y}%, rgba(255,255,255,${opacity}) 45%, transparent 62%)`,
        `radial-gradient(${bloomSize}px ${bloomSize}px at ${x}% ${y}%, rgba(224,231,255,${bloomOpacity}) 15%, rgba(129,140,248,${outerOpacity}) 50%, transparent 75%)`,
      ].join(", ");
    })
    .join(", ");

export const NextUpHeroStars: React.FC = () => (
  <>
    {/* Day sky: crisp crystalline stars */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 dark:hidden"
      style={{ backgroundImage: starsToGradients(DAY_STARS, false) }}
    />
    {/* Radiant glowing Sun in light themes */}
    <div
      aria-hidden="true"
      className="composite-layer pointer-events-none absolute inset-0 -z-10 animate-[heroSunGlow_5s_ease-in-out_infinite] dark:hidden motion-reduce:animate-none"
      style={{
        backgroundImage: [
          // Expansive warm golden atmospheric corona
          "radial-gradient(340px 340px at 90% 6%, rgba(251,191,36,0.48), rgba(245,158,11,0.22) 42%, rgba(252,211,77,0.08) 68%, transparent 84%)",
          // Brilliant golden mid-corona
          "radial-gradient(180px 180px at 90% 6%, rgba(254,240,138,0.85), rgba(245,158,11,0.52) 45%, transparent 74%)",
          // Incandescent blazing solar core
          "radial-gradient(72px 72px at 90% 6%, rgba(255,255,255,1) 0%, rgba(254,249,195,0.98) 35%, rgba(250,204,21,0.88) 62%, rgba(245,158,11,0.55) 76%, transparent 82%)",
        ].join(", "),
      }}
    />
    {/* Ambient solar dawn dispersion over the right quadrant */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 dark:hidden"
      style={{
        backgroundImage:
          "radial-gradient(480px 240px at 92% 0%, rgba(253,224,71,0.18), transparent 70%)",
      }}
    />
    {/* Night sky: two bright sparkling star layers pulsing against each other */}
    <div
      aria-hidden="true"
      className="composite-layer pointer-events-none absolute inset-0 -z-10 hidden animate-[heroTwinkleA_4.5s_ease-in-out_infinite] dark:block motion-reduce:animate-none"
      style={{ backgroundImage: starsToGradients(NIGHT_STARS_A, true) }}
    />
    <div
      aria-hidden="true"
      className="composite-layer pointer-events-none absolute inset-0 -z-10 hidden animate-[heroTwinkleB_5.6s_ease-in-out_0.9s_infinite] dark:block motion-reduce:animate-none"
      style={{ backgroundImage: starsToGradients(NIGHT_STARS_B, true) }}
    />
    {/* Sheen: one diagonal light band sweeps the card every few seconds, over
        both the day and the night sky. */}
    <div
      aria-hidden="true"
      className="hero-sheen composite-layer pointer-events-none absolute inset-0 -z-10 motion-reduce:animate-none"
    />
  </>
);

export const NextUpHero: React.FC<NextUpHeroProps> = ({
  assessment,
  testId = "dashboard-next-up-hero",
  onOpenDetail,
  onOpenCalendar,
  onConnect,
  onSync,
}) => {
  const courses = useAppStore((s) => s.data.schedule.courses);

  if (!assessment) {
    return (
      <section data-testid={testId} className={HERO_SHELL}>
        <NextUpHeroStars />
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
              <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <span>{copy.dashboard.heroEmptyTitle}</span>
            </h1>
            <p className="mt-0.5 text-xs text-blue-100">{copy.dashboard.heroEmptyBody}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onConnect}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1557b0] shadow-xs transition hover:bg-blue-50"
            >
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.heroConnectAccount}</span>
            </button>
            <button
              type="button"
              onClick={onSync}
              className="flex cursor-pointer items-center gap-1 rounded-xl bg-slate-950/35 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.heroSyncRadar}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  const days = assessment.daysUntil ?? null;
  const countdownLabel =
    days === 0
      ? copy.dashboard.heroToday
      : days === 1
        ? copy.dashboard.heroTomorrow
        : days !== null
          ? copy.dashboard.heroInDays(days)
          : "";
  const room = assessment.room?.trim();
  const when = assessment.displayTime || assessment.dayName || assessment.dateIso || "—";
  // The Focus pill carries the AI study plan, or the labeled inference note —
  // and only when one of them actually exists (never an empty "Focus:").
  const focusText = assessment.aiStudyPlan || assessment.aiInferenceNote || "";
  const googleCalUrl = safeExternalUrl(assessment.googleCalUrl);
  const heroCourseBadge = assessment.courseId
    ? `${courseDisplayName(assessment.courseId, courses)} · ${assessment.assessmentType}`
    : assessment.assessmentType;

  return (
    <section data-testid={testId} className={HERO_SHELL}>
      <NextUpHeroStars />
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {countdownLabel && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-950 shadow-2xs sm:text-xs">
                <Zap className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.heroUpNext(countdownLabel)}</span>
              </span>
            )}
            <span className="rounded-full bg-slate-950/35 px-2.5 py-0.5 text-[11px] font-semibold text-white sm:text-xs">
              {heroCourseBadge}
            </span>
            {room && (
              <span className="hidden items-center gap-1 rounded-full border border-emerald-300/30 bg-slate-950/35 px-2.5 py-0.5 text-xs font-medium text-emerald-100 sm:inline-flex">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.roomLabel(stripRoomPrefix(room))}</span>
              </span>
            )}
          </div>

          <h1 className="text-base font-bold leading-snug tracking-tight text-white line-clamp-2 sm:text-xl lg:text-2xl">
            {assessment.title}
            {assessment.courseName && (
              <span className="text-xs font-normal text-blue-100 sm:text-sm">
                {" "}
                ({assessment.courseName})
              </span>
            )}
          </h1>

          <div className="flex flex-wrap items-center gap-2.5 text-[11px] tabular-nums text-blue-100 sm:gap-4 sm:text-xs">
            <span className="flex items-center gap-1 font-medium">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{when}</span>
            </span>
            {assessment.instructor && (
              <span className="hidden items-center gap-1 sm:flex">
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{assessment.instructor}</span>
              </span>
            )}
            {room && (
              <span className="flex items-center gap-1 sm:hidden">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.roomLabel(stripRoomPrefix(room))}</span>
              </span>
            )}
          </div>

          {/* Compact Study Focus Pill */}
          {focusText && (
            <div className="flex max-w-3xl items-start gap-2 rounded-xl border border-white/15 bg-slate-950/45 p-2 text-[11px] text-blue-50 sm:p-2.5 sm:text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
              <div className="leading-relaxed line-clamp-2">
                <span className="font-semibold text-white">{copy.dashboard.heroFocusLabel}</span>{" "}
                {focusText}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons: Horizontal on mobile, neatly grouped on desktop */}
        <div className="flex shrink-0 items-center gap-2 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onOpenDetail}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1557b0] shadow-xs transition hover:bg-blue-50 active:scale-[0.98] md:flex-initial"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.heroStudyPlan}</span>
          </button>
          <button
            type="button"
            onClick={onOpenCalendar}
            aria-label={copy.dashboard.heroCalendar}
            title={copy.dashboard.heroCalendar}
            className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-slate-950/35 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50 active:scale-95"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{copy.dashboard.heroCalendar}</span>
          </button>
          {/* The Google-Cal link only renders when the pipeline established a
              real template URL — v4 linked to "#", which was dishonest. */}
          {googleCalUrl && (
            <a
              href={googleCalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.dashboard.heroGoogleCal}
              title={copy.dashboard.heroGoogleCal}
              className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-slate-950/35 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50 active:scale-95"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{copy.dashboard.heroGoogleCal}</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
};
