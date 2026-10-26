import { CodeBlock } from "../code-block";
import { Section, SectionHeading, WindowFrame } from "./ui";

const oldWay = `// AWS SDK v3: 50+ lines per provider
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
}`;

const filewayWay = `import { FilewayClient } from "@fileway/core"
import { S3Driver } from "@fileway/s3"

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

console.log(result.url)  // Fully typed`;

export function CodeComparison() {
  return (
    <Section id="comparison" className="border-t border-line bg-surface-muted">
      <SectionHeading eyebrow="Developer experience" title="From 50 lines to 5">
        No more vendor-specific SDKs, stream conversions, or fragile error handling. One API. End-to-end type safety.
      </SectionHeading>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <WindowFrame title="The old way" className="min-w-0">
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
            <CodeBlock dimmed code={oldWay} />
          </pre>
        </WindowFrame>
        <WindowFrame title="The Fileway" highlight className="min-w-0">
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
            <CodeBlock code={filewayWay} />
          </pre>
        </WindowFrame>
      </div>

      <p className="mt-8 text-center text-sm text-ink-muted">
        <span className="font-semibold text-ink">Same client</span> works with Local, S3, Cloudinary, and more. Just
        swap the driver.
      </p>
    </Section>
  );
}
