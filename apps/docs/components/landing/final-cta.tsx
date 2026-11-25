import { ArrowRight, BarChart3, FolderOpen, ShieldCheck, Users } from "lucide-react";
import { DASHBOARD_URL, GITHUB_URL } from "@/lib/site";
import { GitHubIcon } from "../brand";
import { InstallCommand } from "./install-command";
import { Button, Section } from "./ui";

const infra = [
  { icon: <BarChart3 />, label: "Analytics and audit log" },
  { icon: <FolderOpen />, label: "Browse and share files" },
  { icon: <ShieldCheck />, label: "Upload protection", soon: true },
  { icon: <Users />, label: "Teams and roles", soon: true },
];

/** The hosted dashboard (Fileway Infrastructure): what it does, and where to sign in. */
export function InfraTeaser() {
  return (
    <Section id="infrastructure" className="pt-0 md:pt-0">
      <div className="rounded-2xl border border-line bg-surface-muted p-8 md:p-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-brand-ink">Now in beta</span>
          <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-surface">Fileway Infrastructure</span>
        </div>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          A dashboard for every file your app stores.
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          Fileway Infrastructure is an optional hosted dashboard for apps built with Fileway. Add the{" "}
          <code className="font-mono text-sm text-ink">@fileway/infra</code> plugin to see every upload, download and
          delete in an audit log with analytics, and to browse and share your app's files from the browser. Your storage
          keys stay in your app, and files never pass through us.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          Sign in with GitHub or Google to create your account. Free during the beta.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {infra.map((i) => (
            <li
              key={i.label}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-ink [&_svg]:size-4 [&_svg]:text-brand-ink"
            >
              {i.icon}
              {i.label}
              {i.soon ? <span className="ml-auto text-xs font-normal text-ink-muted">Soon</span> : null}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button href={DASHBOARD_URL} event="cta_click" data={{ target: "infra-dashboard" }}>
            Open the dashboard <ArrowRight className="size-4" />
          </Button>
          <Button
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            event="cta_click"
            data={{ target: "infra-follow" }}
            variant="secondary"
          >
            <GitHubIcon /> Follow on GitHub
          </Button>
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          By signing in you agree to the <a href="/terms" className="underline underline-offset-2 hover:text-ink">terms</a>.
          See how we handle your data in the{" "}
          <a href="/privacy" className="underline underline-offset-2 hover:text-ink">privacy policy</a>.
        </p>
      </div>
    </Section>
  );
}

/** Last call to action, repeating the main conversion: install. */
export function FinalCta() {
  return (
    // Fixed dark colors, so the band stays dark in both themes.
    <section className="relative isolate overflow-hidden border-t border-white/10 bg-neutral-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 md:py-28">
        <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
          Ship your first upload <span className="text-brand">in five minutes.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/70 md:text-lg">
          Install two packages, pick a driver, call upload. Switch providers whenever you want.
        </p>
        <div className="mx-auto mt-8 flex max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
          <InstallCommand location="final-cta" className="sm:shrink-0" />
          <Button
            href="/docs/getting-started/quickstart"
            event="cta_click"
            data={{ target: "final-get-started" }}
            variant="brand"
            className="shrink-0 whitespace-nowrap"
          >
            Read the quickstart <ArrowRight className="size-4" />
          </Button>
        </div>
        <p className="mt-6 text-sm text-white/60">MIT licensed. Free forever.</p>
      </div>
    </section>
  );
}
