import { CodeBlock } from "../code-block";

export function CodeComparison() {
  return (
    <section className="py-20" style={{ backgroundColor: "var(--lp-bg)" }}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center">
          <p className="font-mono text-[12px] font-[500] uppercase tracking-[1px]" style={{ color: "var(--lp-muted)" }}>
            Developer Experience
          </p>
          <h2 className="mt-3 font-sans text-[32px] font-[700] tracking-[-0.8px] md:text-[40px] md:tracking-[-1px]" style={{ color: "var(--lp-text)" }}>
            From 50 lines to 5
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] font-sans text-[14px] leading-[1.6]" style={{ color: "var(--lp-muted)" }}>
            No more vendor-specific SDKs, stream conversions, or fragile error handling.
            One API. End-to-end type safety.
          </p>
        </div>

        <div className="mx-auto mt-14 grid gap-6 md:grid-cols-2 md:gap-8 max-w-[960px]">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-card-bg)" }}>
            <div className="flex items-center gap-[6px] px-4 py-2.5" style={{ borderBottom: "1px solid var(--lp-border)", backgroundColor: "var(--lp-surface)" }}>
              <div className="h-2.5 w-2.5 rounded-full opacity-30" style={{ backgroundColor: "var(--lp-muted)" }} />
              <div className="h-2.5 w-2.5 rounded-full opacity-30" style={{ backgroundColor: "var(--lp-muted)" }} />
              <div className="h-2.5 w-2.5 rounded-full opacity-30" style={{ backgroundColor: "var(--lp-muted)" }} />
              <span className="ml-3 font-mono text-[11px] font-[500] opacity-60" style={{ color: "var(--lp-muted)" }}>
                The Old Way
              </span>
            </div>
            <div className="p-5">
              <pre className="overflow-x-auto font-mono text-[13px] leading-[1.7]">
                <CodeBlock dimmed code={`// AWS SDK v3 — 50+ lines per provider
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { Readable } from "node:stream"

const s3 = new S3Client({ region: "us-east-1" })

async function uploadToS3(
  buffer: Buffer,
  key: string
): Promise<string> {
  // Manual stream → buffer conversion
  const command = new PutObjectCommand({
    Bucket: "my-bucket",
    Key: key,
    Body: buffer,
  })
  
  try {
    await s3.send(command)
    return \`https://s3.amazonaws.com/my-bucket/$\{key}\`
  } catch (err) {
    // Per-provider error handling
    console.error("S3 upload failed:", err)
    throw err
  }
}`} />
              </pre>
            </div>
          </div>

          <div
            className="overflow-hidden rounded-lg border glow-accent gradient-border"
            style={{ borderColor: "var(--lp-accent)", backgroundColor: "var(--lp-card-bg)" }}
          >
            <div className="flex items-center gap-[6px] px-4 py-2.5" style={{ borderBottom: "1px solid var(--lp-border)", backgroundColor: "var(--lp-surface)" }}>
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--lp-accent)" }} />
              <div className="h-2.5 w-2.5 rounded-full opacity-30" style={{ backgroundColor: "var(--lp-muted)" }} />
              <div className="h-2.5 w-2.5 rounded-full opacity-30" style={{ backgroundColor: "var(--lp-muted)" }} />
              <span className="ml-3 font-mono text-[11px] font-[500]" style={{ color: "var(--lp-accent)" }}>
                The Fileway Way
              </span>
            </div>
            <div className="p-5">
              <pre className="overflow-x-auto font-mono text-[13px] leading-[1.7]">
                <CodeBlock code={`import { FilewayClient } from "@fileway/core"
import { S3Driver } from "@fileway/driver-s3"

const client = new FilewayClient({
  driver: new S3Driver({
    bucket: "my-bucket",
    region: "us-east-1",
  }),
})

// Accepts ReadableStream<Uint8Array> directly
const result = await client.upload(stream, {
  filename: "report.pdf",
})

console.log(result.url)  // Fully typed`} />
              </pre>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-[600px] rounded-lg border p-5 text-center" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-card-bg)" }}>
          <p className="font-sans text-[14px]" style={{ color: "var(--lp-muted)" }}>
            <span className="font-[600]" style={{ color: "var(--lp-text)" }}>Same client</span> works with Local, S3, Cloudinary, and more.
            Just swap the driver.
          </p>
        </div>
      </div>
    </section>
  );
}
