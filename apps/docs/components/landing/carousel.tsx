"use client";

import { useRef } from "react";

const drivers = [
  {
    name: "Local",
    desc: "Native Node.js streams for local filesystem storage. Perfect for development and single-server deployments.",
    href: "/docs/drivers/driver-local",
    code: `new BetterPushClient({
  driver: new LocalDriver({
    directory: "./storage"
  })
})`,
    meta: "node:bun",
  },
  {
    name: "S3",
    desc: "AWS S3 and Cloudflare R2 via FetchHttpHandler. Multipart uploads, edge-compatible, no native modules.",
    href: "/docs/drivers/driver-s3",
    code: `new BetterPushClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    region: "us-east-1"
  })
})`,
    meta: "universal",
  },
  {
    name: "Cloudinary",
    desc: "Pure fetch + Web Crypto signatures. Zero Node deps — works on any runtime with zero polyfills.",
    href: "/docs/drivers/driver-cloudinary",
    code: `new BetterPushClient({
  driver: new CloudinaryDriver({
    cloudName: "my-cloud"
  })
})`,
    meta: "universal",
  },
  {
    name: "Middleware",
    desc: "Stream transformations and post-processing hooks. Log, compress, validate — all before your driver.",
    href: "/docs",
    code: `client.use({
  beforeUpload: async (stream, opts) => {
    const compressed = await compress(stream)
    return { stream: compressed }
  }
})`,
    meta: "pipeline",
  },
];

export function Carousel() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 360;
    scrollRef.current.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <section className="bg-paper-white py-24 pb-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-booton text-heading font-[700] text-ink-black">
              One interface, any backend
            </h2>
            <p className="mt-4 max-w-[480px] font-booton text-body text-charcoal">
              Every driver implements the same <code className="font-[600]">BaseDriver</code> contract.
              Swap backends without changing your application code.
            </p>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <button
              onClick={() => scroll("left")}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-stone bg-paper-white text-ink-black hover:bg-bone transition-colors"
              aria-label="Scroll left"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={() => scroll("right")}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-stone bg-paper-white text-ink-black hover:bg-bone transition-colors"
              aria-label="Scroll right"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-12 flex gap-6 overflow-x-auto px-6 pb-4"
        style={{ scrollbarWidth: "none" }}
      >
        {drivers.map((d, i) => (
          <div key={i} className="flex w-[340px] shrink-0 flex-col">
            <div className="overflow-hidden rounded-md">
              <pre className="m-0 overflow-x-auto bg-obsidian p-5 text-left font-booton text-caption leading-[1.6] text-stone">
                <code>{d.code}</code>
              </pre>
            </div>
            <div className="px-1 pt-4">
              <p className="font-booton text-body font-[700] text-ink-black">
                {d.name}
              </p>
              <p className="mt-1 font-booton text-body text-charcoal leading-[1.5]">
                {d.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
