import type { ReactNode } from "react";
import { Activity, Feather, FolderTree, Globe, Link2, ListChecks, ShieldCheck, Waves } from "lucide-react";
import { Chip, Section, SectionHeading } from "./ui";

type Feature = {
  icon: ReactNode;
  title: string;
  desc: string;
  large?: boolean;
  content?: ReactNode;
};

// Eight features: one wide card plus seven fills three rows of a 3-column grid.
const features: Feature[] = [
  {
    icon: <Feather />,
    title: "No SDKs, zero core dependencies",
    desc: "Every driver is built on fetch, Web Streams and Web Crypto. Your install stays clean, and your bundle carries only the drivers you use.",
    large: true,
    content: (
      <div className="flex flex-wrap gap-2">
        <Chip>dependencies: 0</Chip>
        <Chip>cloud SDKs: 0</Chip>
        <Chip>node:* imports in cloud drivers: 0</Chip>
      </div>
    ),
  },
  {
    icon: <Globe />,
    title: "Runs everywhere",
    desc: "The same code on servers and at the edge.",
    content: (
      <div className="flex flex-wrap gap-2">
        {["Node.js", "Bun", "Deno", "Cloudflare Workers", "Vercel Edge"].map((r) => (
          <Chip key={r}>{r}</Chip>
        ))}
      </div>
    ),
  },
  {
    icon: <Waves />,
    title: "True streaming",
    desc: "Files move as ReadableStream from request to provider. No buffering, no memory spikes, even for gigabyte uploads.",
  },
  {
    icon: <Link2 />,
    title: "Signed links, both ways",
    desc: "Share private files with links that expire, and let browsers upload straight to storage with signed upload links. Works even on local disk.",
  },
  {
    icon: <FolderTree />,
    title: "Manage files",
    desc: "list, stat, copy, move and delete with the same calls on every provider, with paging handled for you.",
  },
  {
    icon: <Activity />,
    title: "Plugins and events",
    desc: "Every operation emits one event with who did it. Build audit trails, usage metering and webhooks with a small plugin.",
  },
  {
    icon: <ShieldCheck />,
    title: "Typed errors and retries",
    desc: "One StorageError with a clear code on every provider. Network blips, timeouts and rate limits retry with backoff.",
  },
  {
    icon: <ListChecks />,
    title: "Types that follow your driver",
    desc: "Each driver's metadata is typed, so autocomplete adapts to your provider and mistakes show up before runtime.",
    content: (
      <div className="rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs leading-relaxed text-ink-muted">
        result.meta.<span className="text-brand-ink">publicId</span> {"  // Cloudinary"}
        <br />
        result.meta.<span className="text-brand-ink">etag</span> {"      // S3"}
      </div>
    ),
  },
];

export function BentoGrid() {
  return (
    <Section id="features">
      <SectionHeading eyebrow="Features" title="Everything file storage needs, in one small library">
        The parts every app ends up writing by hand, built in and working the same on every provider.
      </SectionHeading>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className={`flex flex-col rounded-xl border border-line bg-surface p-6 transition-colors hover:border-brand/60 ${f.large ? "md:col-span-2" : ""}`}
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-ink [&_svg]:size-[18px]">
              {f.icon}
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{f.desc}</p>
            {f.content ? <div className="mt-5">{f.content}</div> : null}
          </div>
        ))}
      </div>
    </Section>
  );
}
