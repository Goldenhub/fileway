import Link from "next/link";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

export function Hero() {
  return (
    <section className="relative grid-bg pt-32 pb-20 md:pt-40 md:pb-28" style={{ backgroundColor: "var(--lp-bg)" }}>
      {/* Soft gradient glows on left and right */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-[400px] w-[300px] opacity-20 blur-[120px] rounded-full" style={{ background: "var(--lp-accent)" }} />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-[400px] w-[300px] opacity-20 blur-[120px] rounded-full" style={{ background: "var(--lp-accent)" }} />
      </div>
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        <div
          className="mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-[12px] font-[500] glow-accent"
          style={{ borderColor: "var(--lp-accent)", backgroundColor: "var(--lp-accent-dim)", color: "var(--lp-accent)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--lp-accent)" }} />
          v0.1.0 Released — Runtime Agnostic File Storage Engine
        </div>

        <h1 className="mx-auto max-w-[800px] font-sans text-[44px] font-[700] leading-[1.1] tracking-[-1.2px] md:text-[64px] md:tracking-[-1.8px]" style={{ color: "var(--lp-text)" }}>
          One standard API for all your file storage.{" "}
          <span className="text-[#ffb224]">
            Zero dependencies.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-[600px] font-sans text-[15px] leading-[1.6] tracking-[-0.2px]" style={{ color: "var(--lp-muted)" }}>
          Stream files effortlessly across Node.js, Cloudflare Workers, Bun, and Deno.
          Swap between Local, S3, and Cloudinary drivers with a single line of code.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/docs"
            className="inline-flex items-center rounded-md px-6 py-3 font-sans text-[14px] font-[600] text-black transition-opacity hover:opacity-90 glow-accent" style={{ backgroundColor: "var(--lp-accent)" }}
          >
            Get Started
          </Link>
          <a
            href="https://github.com/anomalyco/fileway"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border px-6 py-3 font-sans text-[14px] font-[500] transition-colors hover:text-white" style={{ borderColor: "var(--lp-border)", color: "var(--lp-muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>

        <div className="mx-auto mt-16 max-w-[560px]">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-surface)" }}>
            <div className="flex items-center gap-[6px] px-4 py-2.5" style={{ borderBottom: "1px solid var(--lp-border)" }}>
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--lp-muted)" }} />
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--lp-muted)" }} />
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--lp-muted)" }} />
              <span className="ml-3 font-mono text-[11px] opacity-60" style={{ color: "var(--lp-muted)" }}>install.sh</span>
            </div>
            <div className="p-4 text-left [&_[role=tablist]]:mb-3 [&_[role=tablist]>button]:text-[12px] [&_[role=tablist]>button]:font-mono">
              <Tabs id="hero-install" items={["npm", "pnpm", "yarn", "bun"]}>
                <Tab value="npm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] opacity-50" style={{ color: "var(--lp-muted)" }}>$</span>
                    <code className="font-mono text-[14px]" style={{ color: "var(--lp-text)" }}>
                      npm install @fileway/core @fileway/driver-s3
                    </code>
                  </div>
                </Tab>
                <Tab value="pnpm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] opacity-50" style={{ color: "var(--lp-muted)" }}>$</span>
                    <code className="font-mono text-[14px]" style={{ color: "var(--lp-text)" }}>
                      pnpm add @fileway/core @fileway/driver-s3
                    </code>
                  </div>
                </Tab>
                <Tab value="yarn">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] opacity-50" style={{ color: "var(--lp-muted)" }}>$</span>
                    <code className="font-mono text-[14px]" style={{ color: "var(--lp-text)" }}>
                      yarn add @fileway/core @fileway/driver-s3
                    </code>
                  </div>
                </Tab>
                <Tab value="bun">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] opacity-50" style={{ color: "var(--lp-muted)" }}>$</span>
                    <code className="font-mono text-[14px]" style={{ color: "var(--lp-text)" }}>
                      bun add @fileway/core @fileway/driver-s3
                    </code>
                  </div>
                </Tab>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
