import type { FC } from "react";

/**
 * Placeholder view shell. Honest copy only — no data is simulated; real
 * behavior per `docs/rebuild/01-product-spec.md` §4.3–§4.5 ships in phase 09
 * (`prompts/p09-web-ui-views.md`).
 */

export const Dashboard: FC = () => (
  <section data-testid="view-dashboard">
    <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      Not wired yet — the radar (KPIs, What Should I Study?, timeline) lands in phase 09. No data is
      simulated.
    </p>
  </section>
);

export const Tasks: FC = () => (
  <section data-testid="view-tasks">
    <h1 className="text-xl font-bold tracking-tight">Tasks</h1>
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      Not wired yet — the readiness grid and daily study roadmap land in phase 09. No data is
      simulated.
    </p>
  </section>
);

export const CalendarView: FC = () => (
  <section data-testid="view-calendar">
    <h1 className="text-xl font-bold tracking-tight">Calendar</h1>
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      Not wired yet — the week grid lands in phase 09. No data is simulated.
    </p>
  </section>
);
