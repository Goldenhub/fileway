import { FilewayClient } from "@fileway/core";
import { S3Driver } from "@fileway/driver-s3";

const { S3_BUCKET, S3_ENDPOINT, S3_PUBLIC_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;

if (!S3_BUCKET) throw new Error("Missing S3_BUCKET env var");
if (!S3_ENDPOINT) throw new Error("Missing S3_ENDPOINT env var (e.g. https://<accountid>.r2.cloudflarestorage.com)");
if (!R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID env var");
if (!R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY env var");

const driver = new S3Driver({
  bucket: S3_BUCKET,
  region: "auto",
  endpoint: S3_ENDPOINT,
  ...(S3_PUBLIC_URL ? { baseUrl: S3_PUBLIC_URL } : {}),
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const client = new FilewayClient({ driver });

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("Hello, R2!"));
    controller.close();
  },
});

const result = await client.upload(stream, {
  filename: "hello-r2.txt",
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
