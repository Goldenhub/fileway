"use client";

import { useState } from "react";
import { CodeBlock } from "../code-block";

const drivers = [
  {
    id: "local",
    label: "Local",
    description: "Local filesystem via Node.js streams",
    code: `import { FilewayClient } from "@fileway/core"
import { LocalDriver } from "@fileway/driver-local"

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
import { S3Driver } from "@fileway/driver-s3"

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
import { S3Driver } from "@fileway/driver-s3"

const client = new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    endpoint: "https://<account>.r2.cloudflarestorage.com",
    region: "auto",
  }),
})

// Identical interface — only driver config changes
const result = await client.upload(stream, {
  filename: "profile.jpg",
})`,
  },
  {
    id: "cloudinary",
    label: "Cloudinary",
    description: "Pure fetch + Web Crypto, zero Node deps",
    code: `import { FilewayClient } from "@fileway/core"
import { CloudinaryDriver } from "@fileway/driver-cloudinary"

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

  return (
    <section className="border-y py-20" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-surface)" }}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center">
          <p className="font-mono text-[12px] font-[500] uppercase tracking-[1px]" style={{ color: "var(--lp-accent)" }}>
            One Client. Any Driver.
          </p>
          <h2 className="mt-3 font-sans text-[32px] font-[700] tracking-[-0.8px] md:text-[40px] md:tracking-[-1px]" style={{ color: "var(--lp-text)" }}>
            Switch backends — not your code
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] font-sans text-[14px] leading-[1.6]" style={{ color: "var(--lp-muted)" }}>
            The <code className="font-mono text-[13px]" style={{ color: "var(--lp-text)" }}>FilewayClient</code> API never changes.
            Only the driver config. Full TypeScript inference adapts to each driver&apos;s metadata.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-[800px] overflow-hidden rounded-lg border" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)" }}>
          <div className="flex" style={{ borderBottom: "1px solid var(--lp-border)" }}>
            {drivers.map((d, i) => (
              <button
                key={d.id}
                onClick={() => setActive(i)}
                className="flex-1 px-4 py-3 font-mono text-[12px] font-[500] transition-colors"
                style={{
                  borderBottom: i === active ? "2px solid var(--lp-accent)" : "2px solid transparent",
                  backgroundColor: i === active ? "var(--lp-card-bg)" : "transparent",
                  color: i === active ? "var(--lp-text)" : "var(--lp-muted)",
                }}
                onMouseEnter={(e) => { if (i !== active) e.currentTarget.style.backgroundColor = "var(--lp-card-bg)"; }}
                onMouseLeave={(e) => { if (i !== active) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col md:flex-row">
            <div className="p-5 md:w-[240px]" style={{ borderRight: "1px solid var(--lp-border)", borderBottom: "1px solid var(--lp-border)" }}>
              <p className="font-mono text-[11px] font-[500] uppercase tracking-[0.5px]" style={{ color: "var(--lp-muted)" }}>
                Driver Info
              </p>
              <p className="mt-3 font-sans text-[14px] font-[500]" style={{ color: "var(--lp-text)" }}>
                {drivers[active]?.label}
              </p>
              <p className="mt-1 font-sans text-[13px] leading-[1.5]" style={{ color: "var(--lp-muted)" }}>
                {drivers[active]?.description}
              </p>
            </div>
            <div className="flex-1 p-5">
              <pre className="overflow-x-auto font-mono text-[13px] leading-[1.7]">
                <CodeBlock code={drivers[active]?.code ?? ""} />
              </pre>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="font-mono text-[12px]" style={{ color: "var(--lp-muted)" }}>
            <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: "var(--lp-accent)" }} />
            Full TypeScript inference — your IDE knows exactly what each driver returns
          </p>
        </div>
      </div>
    </section>
  );
}
