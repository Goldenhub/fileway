// Facts that are true today and easy to check: no vanity numbers.
const stats = [
  { value: "7", label: "storage providers" },
  { value: "0", label: "core dependencies" },
  { value: "5", label: "runtimes" },
  { value: "350+", label: "tests on every release" },
];

const providers = [
  "AWS S3",
  "Cloudflare R2",
  "Google Cloud Storage",
  "Azure Blob",
  "Supabase",
  "Cloudinary",
  "MinIO",
  "Local disk",
];

export function ProofStrip() {
  return (
    <section aria-label="Fileway at a glance" className="border-y border-line bg-surface-muted">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">{s.value}</dd>
              <dd className="mt-1 text-sm text-ink-muted">{s.label}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-sm">
          <span className="font-medium text-ink">Works with</span>
          {providers.map((p) => (
            <span key={p} className="text-ink-muted">
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
