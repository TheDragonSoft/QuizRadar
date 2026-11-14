/**
 * Phone frame for the `Phone/*` stories: a device bezel around a live
 * iframe. The iframe is a real nested viewport, so the story inside renders
 * with genuine phone media queries — something a CSS width limit cannot do
 * (Tailwind breakpoints read the window, not a container).
 */
export function PhoneFrame({ story, theme = "obsidian" }: { story: string; theme?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-300 p-8 dark:bg-slate-950">
      <div
        className="overflow-hidden rounded-[2.75rem] border-[10px] border-slate-800 bg-black shadow-2xl"
        style={{ width: 410, height: 864 }}
      >
        <iframe
          title={`Phone preview: ${story}`}
          src={`/?story=${story}&theme=${theme}&mode=preview`}
          className="border-0 bg-black"
          style={{ width: 390, height: 844 }}
        />
      </div>
    </div>
  );
}
