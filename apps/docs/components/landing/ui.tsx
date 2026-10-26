import type { ComponentProps, ReactNode } from "react";
import { TrackedLink } from "./tracked-link";

const buttonStyles = {
  primary:
    "bg-ink text-surface hover:bg-ink/85",
  secondary:
    "border border-line bg-surface text-ink hover:bg-surface-muted",
};

/** Pill button that records an analytics event on click. */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof TrackedLink> & { variant?: keyof typeof buttonStyles }) {
  return (
    <TrackedLink
      {...props}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors ${buttonStyles[variant]} ${className}`}
    />
  );
}

export function Section({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-20 py-20 md:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <p className="text-sm font-semibold text-brand-ink">{eyebrow}</p> : null}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink md:text-4xl">{title}</h2>
      {children ? <p className="mt-4 text-base leading-relaxed text-ink-muted">{children}</p> : null}
    </div>
  );
}

/** Card with a window title bar, for code and terminal previews. */
export function WindowFrame({
  title,
  highlight = false,
  className = "",
  children,
}: {
  title: string;
  highlight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-surface ${highlight ? "border-brand ring-4 ring-brand-soft" : "border-line"} ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className={`size-2.5 rounded-full ${highlight ? "bg-brand" : "bg-line"}`} />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className={`ml-2 font-mono text-xs ${highlight ? "text-brand-ink" : "text-ink-muted"}`}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function Badge({ tone = "brand", children }: { tone?: "brand" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        tone === "brand" ? "bg-brand-soft text-brand-ink" : "bg-surface-muted text-ink-muted ring-1 ring-line ring-inset"
      }`}
    >
      {children}
    </span>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-line bg-surface-muted px-2.5 py-1 font-mono text-xs text-ink-muted">
      {children}
    </span>
  );
}
