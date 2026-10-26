import { ArrowUpRight, Cloud, HardDrive, Image as ImageIcon, Server } from "lucide-react";
import type { ReactNode } from "react";
import { TrackedLink } from "./tracked-link";
import { Badge, Section, SectionHeading } from "./ui";

const drivers: { name: string; status: "Stable" | "Coming Soon"; link: string; desc: string; supports: string; icon: ReactNode }[] = [
  {
    name: "@fileway/local",
    status: "Stable",
    link: "/docs/drivers/local",
    desc: "Local filesystem via Node.js streams",
    supports: "Node.js, Bun",
    icon: <HardDrive />,
  },
  {
    name: "@fileway/s3",
    status: "Stable",
    link: "/docs/drivers/s3",
    desc: "AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces",
    supports: "Universal",
    icon: <Server />,
  },
  {
    name: "@fileway/cloudinary",
    status: "Stable",
    link: "/docs/drivers/cloudinary",
    desc: "Pure fetch + Web Crypto, zero Node dependencies",
    supports: "Universal",
    icon: <ImageIcon />,
  },
  {
    name: "@fileway/driver-gcs",
    status: "Coming Soon",
    link: "/docs",
    desc: "Google Cloud Storage adapter",
    supports: "Universal",
    icon: <Cloud />,
  },
];

export function DriversSection() {
  return (
    <Section id="drivers">
      <SectionHeading eyebrow="Drivers" title="Plug-and-play drivers">
        Each driver implements the <code className="font-mono text-sm text-ink">BaseDriver</code> contract. Install
        what you need, nothing more.
      </SectionHeading>

      <div className="mt-12 grid gap-3 md:grid-cols-2">
        {drivers.map((d) => (
          <TrackedLink
            key={d.name}
            href={d.link}
            event="driver_click"
            data={{ driver: d.name }}
            className="group flex items-start gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand/60"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-muted transition-colors group-hover:text-brand-ink [&_svg]:size-5">
              {d.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium text-ink">{d.name}</span>
                <Badge tone={d.status === "Stable" ? "brand" : "neutral"}>{d.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{d.desc}</p>
              <p className="mt-2 text-xs text-ink-muted">Runs on: {d.supports}</p>
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink" />
          </TrackedLink>
        ))}
      </div>
    </Section>
  );
}
