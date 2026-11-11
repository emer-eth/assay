import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

// Controls from the Design system board: 48 tall (56 in the hero and the pay step), radius 2, focus is a 2px stamp outline.

type Variant = "pay" | "primary" | "secondary";
const VARIANT: Record<Variant, string> = {
  // Stamp blue marks the one action that moves money. Ink is every other primary action.
  pay: "bg-stamp text-on-stamp hover:bg-[color-mix(in_srgb,var(--stamp)_88%,var(--ink))]",
  primary: "bg-ink text-on-ink hover:bg-[color-mix(in_srgb,var(--ink)_86%,var(--paper))]",
  secondary: "border border-ink text-ink hover:bg-tint",
};
export const buttonClass = (variant: Variant = "primary", size: "md" | "lg" = "md") =>
  `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[2px] px-5 font-plex text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${size === "lg" ? "min-h-14 px-7 text-base" : "min-h-12"} ${VARIANT[variant]}`;

export function Button({ variant = "primary", size = "md", busy, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "lg"; /** the step in progress, shown as the label */ busy?: string }) {
  return (
    <button type="button" data-wallet={variant === "pay" ? "" : undefined} {...rest} disabled={rest.disabled || !!busy} aria-busy={!!busy || undefined} className={`${buttonClass(variant, size)} ${className}`}>
      {busy ?? children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", className = "", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: "md" | "lg" }) {
  return <a {...rest} className={`${buttonClass(variant, size)} ${className}`} />;
}

/** Mono 12 caps in a 1px box: a check type, Beta, Testnet. */
export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "refund" | "stamp" }) {
  const color = tone === "refund" ? "border-refund text-refund" : tone === "stamp" ? "border-stamp text-stamp" : "border-ink text-ink";
  return <span className={`inline-flex items-center border px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-[0.08em] ${color}`}>{children}</span>;
}

/** Section label: mono 12, caps, tracked, in ink-2. */
export function Label({ children, as: As = "p", className = "" }: { children: ReactNode; as?: "p" | "h2" | "h3" | "span"; className?: string }) {
  return <As className={`font-mono text-xs font-medium uppercase tracking-[0.08em] text-ink-2 ${className}`}>{children}</As>;
}
