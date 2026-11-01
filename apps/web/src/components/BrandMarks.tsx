/**
 * Brand marks — the exact artwork v4 used (v4-final:static/index.html).
 * These are the official Google/Microsoft logotypes: brand guidelines require
 * them to be reproduced in their original colours and proportions.
 */

/**
 * The QuizRadar app mark — the v4 radar squircle
 * (v4-final:static/icon.svg), inlined so the shell can tint/scale it without
 * an extra network request.
 */
export function RadarMark({
  className = "h-8 w-8",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg className={`${className} shrink-0`} viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient
          id="qrMarkBg"
          x1="0"
          y1="0"
          x2="256"
          y2="256"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#1e3a8a" />
          <stop offset="50%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient
          id="qrMarkSweep"
          x1="128"
          y1="36"
          x2="210"
          y2="128"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="12" y="12" width="232" height="232" rx="56" fill="url(#qrMarkBg)" />
      <rect
        x="14"
        y="14"
        width="228"
        height="228"
        rx="54"
        stroke="#ffffff"
        strokeOpacity="0.18"
        strokeWidth="3"
        fill="none"
      />
      <rect x="78" y="28" width="16" height="26" rx="8" fill="#ffffff" fillOpacity="0.9" />
      <rect x="162" y="28" width="16" height="26" rx="8" fill="#ffffff" fillOpacity="0.9" />
      <circle
        cx="128"
        cy="136"
        r="76"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="5"
        fill="none"
      />
      <circle
        cx="128"
        cy="136"
        r="50"
        stroke="#ffffff"
        strokeOpacity="0.32"
        strokeWidth="4"
        strokeDasharray="10 8"
        fill="none"
      />
      <circle
        cx="128"
        cy="136"
        r="24"
        stroke="#ffffff"
        strokeOpacity="0.45"
        strokeWidth="4"
        fill="none"
      />

      {/* Sweep cone + gold needle */}
      <g className={animated ? "radar-sweep-hand" : undefined}>
        <path d="M128 136 L128 60 A76 76 0 0 1 198 106 Z" fill="url(#qrMarkSweep)" />
        <line
          x1="128"
          y1="136"
          x2="184"
          y2="84"
          stroke="#facc15"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>

      {/* Center radar hub */}
      <circle cx="128" cy="136" r="10" fill="#ffffff" />
      <circle cx="128" cy="136" r="5" fill="#1d4ed8" />

      {/* Detected exam blips */}
      <circle cx="174" cy="93" r="9" fill="#facc15" />
      <circle
        cx="174"
        cy="93"
        r="15"
        stroke="#facc15"
        strokeOpacity="0.45"
        strokeWidth="3"
        fill="none"
        className={animated ? "radar-blip-pulse" : undefined}
      />
      <circle cx="92" cy="112" r="6.5" fill="#34d399" />
      <circle cx="156" cy="166" r="6.5" fill="#f87171" />
    </svg>
  );
}

export function GoogleMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function MicrosoftMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0`} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
