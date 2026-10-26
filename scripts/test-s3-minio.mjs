// Start MinIO locally (MinIO no longer publishes community images, so this uses
// Chainguard's build; it runs as a non-root user, hence the writable tmpfs):
//   docker run -p 9000:9000 -p 9001:9001 --tmpfs /data:rw,mode=1777 \
//     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
//     cgr.dev/chainguard/minio:latest server /data --console-address ":9001"
//
// Create a bucket (a fresh container does not keep the alias, so set it and
// create the bucket in one run):
//   docker run --rm --network host --entrypoint sh cgr.dev/chainguard/minio-client:latest-dev -c \
//     "mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/my-bucket"
//
// Run:
//   S3_BUCKET=my-bucket S3_ENDPOINT=http://localhost:9000 MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin npx tsx scripts/test-s3-minio.mjs

import { FilewayClient } from "@fileway/core";
import { S3Driver } from "@fileway/s3";

const { S3_BUCKET, S3_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY } = process.env;

if (!S3_BUCKET) throw new Error("Missing S3_BUCKET env var");
if (!S3_ENDPOINT) throw new Error("Missing S3_ENDPOINT env var");
if (!MINIO_ACCESS_KEY) throw new Error("Missing MINIO_ACCESS_KEY env var");
if (!MINIO_SECRET_KEY) throw new Error("Missing MINIO_SECRET_KEY env var");

const driver = new S3Driver({
  bucket: S3_BUCKET,
  region: "us-east-1",
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: MINIO_ACCESS_KEY, secretAccessKey: MINIO_SECRET_KEY },
});

const client = new FilewayClient({ driver });

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("Hello, MinIO!"));
    controller.close();
  },
});

const result = await client.upload(stream, {
  filename: "hello-minio.txt",
  path: "test-uploads",
  mimeType: "text/plain",
});

console.log("Upload result:");
console.log("  id:", result.id);
console.log("  url:", result.url);
console.log("  path:", result.path);
console.log("  size:", result.size, "bytes");
console.log("  meta:", JSON.stringify(result.meta));

const url = await client.getUrl(result.path);
console.log("\nGenerated URL:", url);

const deleted = await client.delete(result.path);
console.log("Deleted:", deleted);
