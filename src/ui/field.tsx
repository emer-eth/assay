"use client";

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";

const FIELD = "w-full rounded-[2px] border border-ink bg-sheet px-4 font-mono text-base text-ink placeholder:text-ink-2 placeholder:italic disabled:opacity-50 aria-[invalid=true]:border-refund";

/** Label above, 48 tall, 16px text so phones don't zoom, error message below. */
export function Field({ label, error, hint, multiline, suffix, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; error?: string; hint?: ReactNode; multiline?: boolean; suffix?: ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const common = { id, "aria-invalid": !!error || undefined, "aria-describedby": describedBy };
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm text-ink-2">{label}</label>
      <div className="relative">
        {multiline ? (
          <textarea {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} {...common} className={`${FIELD} min-h-24 py-3 font-plex`} />
        ) : (
          <input {...(rest as InputHTMLAttributes<HTMLInputElement>)} {...common} className={`${FIELD} h-12 ${suffix ? "pr-16" : ""}`} />
        )}
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-mono text-sm text-ink-2">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-2 text-sm text-refund">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-2 text-sm text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

