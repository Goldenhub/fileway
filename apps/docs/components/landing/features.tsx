import Link from "next/link";

const drivers = [
  {
    name: "Local",
    desc: "Native Node.js streams for local filesystem storage. Perfect for development and single-server deployments.",
    href: "/docs/drivers/driver-local",
    meta: "node:bun",
  },
  {
    name: "S3",
    desc: "AWS S3 and Cloudflare R2 via FetchHttpHandler. Multipart uploads, edge-compatible, no native modules.",
    href: "/docs/drivers/driver-s3",
    meta: "universal",
  },
  {
    name: "Cloudinary",
    desc: "Pure fetch + Web Crypto signatures. Zero Node dependencies — works on any runtime with zero polyfills.",
    href: "/docs/drivers/driver-cloudinary",
    meta: "universal",
  },
];

export function Features() {
  return (
    <section className="bg-[#d9dad3] py-24">
      <div className="mx-auto max-w-[1200px] px-6">
        <h2 className="text-[36px] leading-[1.2] font-[400] text-[#000000] tracking-[-0.36px]">
          One interface, any backend
        </h2>
        <p className="mt-4 text-[16px] leading-[1.5] text-[#5c5c5c] tracking-[-0.16px] max-w-[480px]">
          Every driver implements the same <code>BaseDriver</code> contract.
          Swap backends without changing your application code.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {drivers.map((d) => (
            <Link
              key={d.name}
              href={d.href}
              className="group rounded-[6px] bg-[#ffffff] p-6 transition-colors hover:bg-[#edede8]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[22px] font-[700] text-[#000000] tracking-[-0.22px]">
                  {d.name}
                </span>
                <span className="rounded-[6px] border border-[#d9dad3] px-2 py-1 text-[12px] text-[#5c5c5c]">
                  {d.meta}
                </span>
              </div>
              <p className="mt-4 text-[14px] leading-[1.5] text-[#303030]">
                {d.desc}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
