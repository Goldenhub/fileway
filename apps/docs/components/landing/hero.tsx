import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { ArrowRight } from "lucide-react";
import { GITHUB_URL, SITE_VERSION } from "@/lib/site";
import { GitHubIcon } from "../brand";
import { CodeBlock } from "../code-block";
import { Button, WindowFrame } from "./ui";

const managers = [
  { id: "npm", cmd: "npm install @fileway/core @fileway/s3" },
  { id: "pnpm", cmd: "pnpm add @fileway/core @fileway/s3" },
  { id: "yarn", cmd: "yarn add @fileway/core @fileway/s3" },
  { id: "bun", cmd: "bun add @fileway/core @fileway/s3" },
];

const snippet = `const client = new FilewayClient({
  driver: new S3Driver({ bucket: "uploads" }),
})

const result = await client.upload(stream, {
  filename: "report.pdf",
})`;

/** Decorative amber line-art behind the hero. */
function HeroLines() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full w-full text-brand opacity-40 dark:opacity-25"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {Array.from({ length: 18 }, (_, i) => (
        <path
          key={i}
          d={`M ${-100 + i * 8} ${560 - i * 6} C 300 ${520 - i * 14}, 600 ${120 + i * 10}, 1300 ${40 + i * 12}`}
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity={0.15 + (i % 6) * 0.06}
        />
      ))}
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <HeroLines />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 md:pt-24 md:pb-28 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <a
            href="/docs/reference/changelog"
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <span className="rounded-full bg-brand-soft px-1.5 py-0.5 font-mono text-[11px] text-brand-ink">
              v{SITE_VERSION}
            </span>
            Runtime-agnostic file storage
            <ArrowRight className="size-3" />
          </a>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-[3.5rem] lg:leading-[1.08]">
            One standard API for all your file storage.{" "}
            <span className="text-brand-ink">Zero dependencies.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
            Stream files effortlessly across Node.js, Cloudflare Workers, Bun, and Deno. Swap between Local, S3, and
            Cloudinary drivers with a single line of code.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button href="/docs" event="cta_click" data={{ target: "get-started" }}>
              Get started <ArrowRight className="size-4" />
            </Button>
            <Button
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              event="cta_click"
              data={{ target: "github" }}
              variant="secondary"
            >
              <GitHubIcon /> GitHub
            </Button>
          </div>
        </div>

        <WindowFrame title="upload.ts" className="min-w-0 shadow-xl shadow-black/5">
          <div className="border-b border-line px-4 pt-3 [&_[role=tablist]]:gap-1 [&_[role=tablist]]:border-0 [&_[role=tablist]]:bg-transparent [&_[role=tablist]]:p-0 [&_[role=tabpanel]]:bg-transparent [&_[role=tabpanel]]:p-0 [&>div]:my-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
            <Tabs id="hero-install" items={managers.map((m) => m.id)}>
              {managers.map((m) => (
                <Tab key={m.id} value={m.id}>
                  <div className="flex items-center gap-2 overflow-x-auto py-3 font-mono text-sm">
                    <span className="select-none text-ink-muted">$</span>
                    <code className="whitespace-nowrap text-ink">{m.cmd}</code>
                  </div>
                </Tab>
              ))}
            </Tabs>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
            <CodeBlock code={snippet} />
          </pre>
        </WindowFrame>
      </div>
    </section>
  );
}
