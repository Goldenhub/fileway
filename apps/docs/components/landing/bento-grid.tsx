export function BentoGrid() {
  const items = [
    {
      title: "Zero Dependencies Core",
      desc: "Less than 2kB gzipped with zero external node modules. Pure Web Streams, fetch, and Web Crypto.",
      accent: "amber",
      large: true,
      content: (
        <div className="mt-4 flex items-center gap-4">
          <div className="rounded-md border px-3 py-2 font-mono text-[12px]" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)", color: "var(--lp-muted)" }}>
            deps: 0
          </div>
          <div className="rounded-md border px-3 py-2 font-mono text-[12px]" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)", color: "var(--lp-muted)" }}>
            size: 1.8kB
          </div>
        </div>
      ),
    },
    {
      title: "True Web Streams",
      desc: "Standard ReadableStream&lt;Uint8Array&gt; from upload to driver. No buffers, no memory spikes.",
      accent: "amber",
      content: null,
    },
    {
      title: "Universal Edge Ready",
      desc: "Deploy anywhere — Node.js 20+, Bun, Deno, Cloudflare Workers, Vercel Edge, Lagon.",
      accent: "amber",
      content: (
        <div className="mt-4 flex flex-wrap gap-2">
          {["Node.js", "Bun", "Deno", "CF Workers", "Vercel Edge"].map((r) => (
            <span key={r} className="rounded-md border px-2.5 py-1 font-mono text-[11px]" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)", color: "var(--lp-muted)" }}>
              {r}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: "Strict Metadata Inference",
      desc: "Each driver exposes typed metadata. Autocomplete adapts to your backend — no runtime surprises.",
      accent: "amber",
      content: (
        <div className="mt-4 rounded-md border p-3 font-mono text-[12px] leading-[1.6]" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)" }}>
          <span style={{ color: "var(--lp-muted)" }}>result.meta.</span>
          <span style={{ color: "var(--lp-accent)" }}>publicId</span>
          <span style={{ color: "var(--lp-muted)" }}>{`  // Cloudinary`}</span>
          <br />
          <span style={{ color: "var(--lp-muted)" }}>result.meta.</span>
          <span style={{ color: "var(--lp-accent)" }}>localPath</span>
          <span style={{ color: "var(--lp-muted)" }}>{`    // Local`}</span>
        </div>
      ),
    },
    {
      title: "Composable Middleware",
      desc: "beforeUpload / afterUpload hooks for validation, compression, logging, and thumbnail generation.",
      accent: "amber",
      content: null,
    },
  ];

  return (
    <section className="py-20" style={{ backgroundColor: "var(--lp-bg)" }}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center">
          <p className="font-mono text-[12px] font-[500] uppercase tracking-[1px]" style={{ color: "var(--lp-accent)" }}>
            Built for scale
          </p>
          <h2 className="mt-3 font-sans text-[32px] font-[700] tracking-[-0.8px] md:text-[40px] md:tracking-[-1px]" style={{ color: "var(--lp-text)" }}>
            Everything you need, nothing you don&apos;t
          </h2>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {items.map((item, i) => (
            <div
              key={i}
              className={`rounded-lg border p-6 transition-colors ${item.large ? "md:col-span-2 md:row-span-1" : ""}`}
              style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-card-bg)" }}
            >
              <div
                className="mb-3 inline-block rounded-md px-2.5 py-1 font-mono text-[10px] font-[600] uppercase tracking-[0.5px]"
                style={{ backgroundColor: "var(--lp-accent-dim)", color: "var(--lp-accent)" }}
              >
                core
              </div>
              <h3 className="font-sans text-[17px] font-[600] tracking-[-0.3px]" style={{ color: "var(--lp-text)" }}>
                {item.title}
              </h3>
              <p className="mt-2 font-sans text-[13px] leading-[1.6]" style={{ color: "var(--lp-muted)" }}>
                {item.desc}
              </p>
              {item.content}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
