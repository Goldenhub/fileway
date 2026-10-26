import type { ReactNode } from "react";
import { Blocks, Feather, Globe, ListChecks, Waves } from "lucide-react";
import { Chip, Section, SectionHeading } from "./ui";

type Feature = {
  icon: ReactNode;
  title: string;
  desc: string;
  large?: boolean;
  content?: ReactNode;
};

const features: Feature[] = [
  {
    icon: <Feather />,
    title: "Zero Dependencies Core",
    desc: "Less than 2kB gzipped with zero external node modules. Pure Web Streams, fetch, and Web Crypto.",
    large: true,
    content: (
      <div className="flex gap-2">
        <Chip>deps: 0</Chip>
        <Chip>size: 1.8kB</Chip>
      </div>
    ),
  },
  {
    icon: <Waves />,
    title: "True Web Streams",
    desc: "Standard ReadableStream<Uint8Array> from upload to driver. No buffers, no memory spikes.",
  },
  {
    icon: <Globe />,
    title: "Universal Edge Ready",
    desc: "Deploy anywhere: Node.js 20+, Bun, Deno, Cloudflare Workers, Vercel Edge, Lagon.",
    content: (
      <div className="flex flex-wrap gap-2">
        {["Node.js", "Bun", "Deno", "CF Workers", "Vercel Edge"].map((r) => (
          <Chip key={r}>{r}</Chip>
        ))}
      </div>
    ),
  },
  {
    icon: <ListChecks />,
    title: "Strict Metadata Inference",
    desc: "Each driver exposes typed metadata. Autocomplete adapts to your backend, so there are no runtime surprises.",
    content: (
      <div className="rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs leading-relaxed text-ink-muted">
        result.meta.<span className="text-brand-ink">publicId</span> {"  // Cloudinary"}
        <br />
        result.meta.<span className="text-brand-ink">localPath</span> {"    // Local"}
      </div>
    ),
  },
  {
    icon: <Blocks />,
    title: "Composable Middleware",
    desc: "beforeUpload / afterUpload hooks for validation, compression, logging, and thumbnail generation.",
  },
];

export function BentoGrid() {
  return (
    <Section id="features">
      <SectionHeading eyebrow="Built for scale" title="Everything you need, nothing you don't" />

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
