import { TrackedLink } from "./tracked-link";

const drivers = [
  {
    name: "@fileway/driver-local",
    status: "Stable",
    link: "/docs/drivers/driver-local",
    desc: "Local filesystem via Node.js streams",
    supports: "Node.js, Bun",
  },
  {
    name: "@fileway/driver-s3",
    status: "Stable",
    link: "/docs/drivers/driver-s3",
    desc: "AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces",
    supports: "Universal",
  },
  {
    name: "@fileway/driver-cloudinary",
    status: "Stable",
    link: "/docs/drivers/driver-cloudinary",
    desc: "Pure fetch + Web Crypto, zero Node dependencies",
    supports: "Universal",
  },
  {
    name: "@fileway/driver-gcs",
    status: "Coming Soon",
    link: "/docs",
    desc: "Google Cloud Storage adapter",
    supports: "Universal",
  },
];

export function DriversSection() {
  return (
    <section className="border-y py-20" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-surface)" }}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center">
          <h2 className="font-sans text-[32px] font-[700] tracking-[-0.8px] md:text-[40px] md:tracking-[-1px]" style={{ color: "var(--lp-text)" }}>
            Plug-and-play drivers
          </h2>
          <p className="mx-auto mt-4 max-w-[500px] font-sans text-[14px] leading-[1.6]" style={{ color: "var(--lp-muted)" }}>
            Each driver implements the <code className="font-mono text-[13px]" style={{ color: "var(--lp-text)" }}>BaseDriver</code> contract.
            Install what you need, nothing more.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-[800px] gap-3">
          {drivers.map((d) => (
            <TrackedLink
              key={d.name}
              href={d.link}
              event="driver_click"
              data={{ driver: d.name }}
              className="group flex items-center justify-between rounded-lg border px-5 py-4 transition-colors"
              style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-card-bg)" }}
            >
              <div className="flex items-center gap-4">
                <div>
                  <p
                    className="font-mono text-[14px] font-[500] transition-colors group-hover:text-[#ffb224]"
                    style={{ color: "var(--lp-text)" }}
                  >
                    {d.name}
                  </p>
                  <p className="mt-0.5 font-sans text-[12px]" style={{ color: "var(--lp-muted)" }}>
                    {d.desc}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="hidden font-mono text-[11px] md:inline" style={{ color: "var(--lp-muted)" }}>
                  {d.supports}
                </span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-[500]"
                  style={{
                    backgroundColor: d.status === "Stable" ? "var(--lp-accent-dim)" : "var(--lp-border)",
                    color: d.status === "Stable" ? "var(--lp-accent)" : "var(--lp-muted)",
                  }}
                >
                  {d.status === "Stable" && (
                    <span className="mr-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--lp-accent)" }} />
                  )}
                  {d.status}
                </span>
              </div>
            </TrackedLink>
          ))}
        </div>
      </div>
    </section>
  );
}
