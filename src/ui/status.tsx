import type { ReactNode } from "react";
import { VerdictStamp, type Verdict } from "./stamps";

// The round's status banner: a polite live region that speaks each step change and the verdict.

export function StatusBanner({ verdict, title, detail, aside, running }: { verdict?: Verdict; title: ReactNode; detail?: ReactNode; aside?: ReactNode; /** a step is in progress: moving stripe */ running?: boolean }) {
  return (
    <div role="status" aria-live="polite" tabIndex={-1} className={`relative flex flex-wrap items-center gap-x-8 gap-y-4 overflow-hidden border border-ink bg-sheet px-6 py-5 outline-none ${running ? "pt-6" : ""}`}>
      {running && <span aria-hidden className="running-stripe absolute inset-x-0 top-0 h-1.5" />}
      {verdict && <VerdictStamp verdict={verdict} />}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold text-ink">{title}</p>
        {detail && <p className="mt-1 text-[15px] text-ink-2">{detail}</p>}
      </div>
      {aside && <div className="text-sm text-ink-2">{aside}</div>}
    </div>
  );
}

export type StepState = "done" | "running" | "waiting" | "failed";
export type Step = { label: string; detail?: ReactNode; time?: string; state: StepState };

const MARK: Record<StepState, string> = {
  done: "bg-ink",
  running: "border-2 border-stamp step-pulse",
  waiting: "border border-rule-strong",
  failed: "bg-refund",
};

/** Vertical timeline with 14px square markers. */
export function Stepper({ steps, label = "Timeline" }: { steps: Step[]; label?: string }) {
  return (
    <ol aria-label={label} className="border-t-2 border-ink">
      {steps.map((s, i) => (
        <li key={i} aria-current={s.state === "running" ? "step" : undefined} className="flex gap-3 border-b border-rule py-3.5 last:border-b-2 last:border-ink">
          <span aria-hidden className={`mt-1 size-3.5 shrink-0 ${MARK[s.state]}`} />
          <div className="min-w-0 flex-1">
            <p className={`font-semibold ${s.state === "waiting" ? "text-ink-2" : "text-ink"}`}>
              {s.label}
              <span className="sr-only">: {s.state}</span>
            </p>
            {s.detail && <p className="mt-0.5 text-sm text-ink-2">{s.detail}</p>}
          </div>
          {s.time && <span className="font-mono text-sm text-ink-2">{s.time}</span>}
        </li>
      ))}
    </ol>
  );
}
