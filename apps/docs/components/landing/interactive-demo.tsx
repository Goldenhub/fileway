"use client";

import { useState } from "react";
import { CodeBlock } from "../code-block";
import { Section, SectionHeading, WindowFrame } from "./ui";

const drivers = [
  {
    id: "local",
    label: "Local",
    description: "Local filesystem via Node.js streams",
    code: `import { FilewayClient } from "@fileway/core"
import { LocalDriver } from "@fileway/local"

const client = new FilewayClient({
  driver: new LocalDriver({
    directory: "./uploads",
    baseUrl: "/files",
  }),
})

// TypeScript infers result.meta.localPath
const result = await client.upload(stream, {
  filename: "profile.jpg",
  metadata: { userId: "usr_123" },
})`,
  },
  {
    id: "s3",
    label: "Amazon S3",
    description: "AWS S3, Cloudflare R2, MinIO, DigitalOcean",
    code: `import { FilewayClient } from "@fileway/core"
import { S3Driver } from "@fileway/s3"

const client = new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    region: "us-east-1",
    endpoint: "https://my-custom-endpoint.com",
  }),
})

// TypeScript infers result.meta.bucket
const result = await client.upload(stream, {
  filename: "profile.jpg",
  metadata: { userId: "usr_123" },
})`,
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    description: "S3-compatible, zero egress fees",
    code: `import { FilewayClient } from "@fileway/core"
import { S3Driver } from "@fileway/s3"

const client = new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    endpoint: "https://<account>.r2.cloudflarestorage.com",
    region: "auto",
  }),
})

// Identical interface; only the driver config changes
const result = await client.upload(stream, {
  filename: "profile.jpg",
})`,
  },
  {
    id: "cloudinary",
    label: "Cloudinary",
    description: "Pure fetch + Web Crypto, zero Node deps",
    code: `import { FilewayClient } from "@fileway/core"
import { CloudinaryDriver } from "@fileway/cloudinary"

const client = new FilewayClient({
  driver: new CloudinaryDriver({
    cloudName: "my-cloud",
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  }),
})

// TypeScript infers result.meta.publicId
const result = await client.upload(stream, {
  filename: "profile.jpg",
  metadata: { userId: "usr_123" },
})`,
  },
];

export function InteractiveDemo() {
  const [active, setActive] = useState(0);
  const driver = drivers[active] ?? drivers[0]!;

  return (
    <Section id="drivers-demo" className="border-y border-line bg-surface-muted">
      <SectionHeading eyebrow="One client. Any driver." title="Switch backends, not your code">
        The <code className="font-mono text-sm text-ink">FilewayClient</code>{" "}API never changes. Only the driver
        config. Full TypeScript inference adapts to each driver&apos;s metadata.
      </SectionHeading>

      <div className="mt-12 grid gap-6 lg:grid-cols-[260px_1fr]">
        <div role="tablist" aria-label="Drivers" className="flex gap-2 overflow-x-auto lg:flex-col">
          {drivers.map((d, i) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className="shrink-0 rounded-xl border border-transparent px-4 py-3 text-left transition-colors hover:bg-surface aria-selected:border-line aria-selected:bg-surface lg:shrink"
            >
              <span className={`block text-sm font-medium ${i === active ? "text-brand-ink" : "text-ink"}`}>
                {d.label}
              </span>
              <span className="mt-0.5 hidden text-xs leading-relaxed text-ink-muted lg:block">{d.description}</span>
            </button>
          ))}
        </div>

        <WindowFrame title={`${driver.id}.ts`} className="min-w-0">
          <pre role="tabpanel" className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
            <CodeBlock code={driver.code} />
          </pre>
        </WindowFrame>
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
        <span className="size-1.5 rounded-full bg-brand" />
        Full TypeScript inference: your IDE knows exactly what each driver returns
      </p>
    </Section>
  );
}
