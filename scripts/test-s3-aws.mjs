import { BetterPushClient } from "@betterpush/core";
import { S3Driver } from "@betterpush/driver-s3";

const { S3_BUCKET, S3_REGION = "us-east-1", AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;

if (!S3_BUCKET) throw new Error("Missing S3_BUCKET env var");
if (!AWS_ACCESS_KEY_ID) throw new Error("Missing AWS_ACCESS_KEY_ID env var");
if (!AWS_SECRET_ACCESS_KEY) throw new Error("Missing AWS_SECRET_ACCESS_KEY env var");

const driver = new S3Driver({
  bucket: S3_BUCKET,
  region: S3_REGION,
  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
});

const client = new BetterPushClient({ driver });

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("Hello, AWS S3!"));
    controller.close();
  },
});

const result = await client.upload(stream, {
  filename: "hello-aws.txt",
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
