import type { ReactNode } from "react";
import Link from "next/link";
import { Header } from "./header";
import { Footer } from "./footer";

/** Contact address for privacy and legal questions. */
export const LEGAL_EMAIL = "privacy@usefileway.dev";
/** Who runs Fileway: named in the privacy policy (controller) and the terms. */
export const LEGAL_OPERATOR = "Golden Azubuike, an individual in Nigeria";
/** Date the current versions of the privacy policy and terms took effect. */
export const LEGAL_UPDATED = "November 26, 2026";

/** Page shell for the privacy policy and terms: landing header and footer, readable column. */
export function LegalPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-20">
        <p className="text-sm font-semibold text-brand-ink">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-ink-muted">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-8 text-base leading-relaxed text-ink-muted">{intro}</div>
        <div className="mt-4">{children}</div>
        <p className="mt-12 border-t border-line pt-6 text-sm text-ink-muted">
          See also the <Link href="/privacy" className={linkClass}>privacy policy</Link> and the{" "}
          <Link href="/terms" className={linkClass}>terms of service</Link>. Questions:{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className={linkClass}>{LEGAL_EMAIL}</a>.
        </p>
      </main>
      <Footer />
    </div>
  );
}

const linkClass = "font-medium text-brand-ink underline underline-offset-2";

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-20 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-ink">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-base leading-relaxed text-ink-muted">{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-6 text-base leading-relaxed text-ink-muted marker:text-line">{children}</ul>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  return external ? (
    <a href={href} className={linkClass} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ) : (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}
