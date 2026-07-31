import { FilewayClient } from "@fileway/core";
import { CloudinaryDriver } from "@fileway/driver-cloudinary";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME) throw new Error("Missing CLOUDINARY_CLOUD_NAME env var");
if (!CLOUDINARY_API_KEY) throw new Error("Missing CLOUDINARY_API_KEY env var");
if (!CLOUDINARY_API_SECRET) throw new Error("Missing CLOUDINARY_API_SECRET env var");

const imagePath = process.argv[2];
if (!imagePath) throw new Error("Usage: node test-upload.mjs <path-to-image>");

const driver = new CloudinaryDriver({
  cloudName: CLOUDINARY_CLOUD_NAME,
  apiKey: CLOUDINARY_API_KEY,
  apiSecret: CLOUDINARY_API_SECRET,
});

const client = new FilewayClient({ driver });

const buf = readFileSync(resolve(imagePath));
const filename = imagePath.split("/").pop() ?? "image";
const ext = filename.split(".").pop()?.toLowerCase() ?? "";
const mimeTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
}
const mimeType = mimeTypes[ext] ?? "application/octet-stream";

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(buf));
    controller.close();
  },
});

console.log(`Uploading ${filename} (${(buf.length / 1024).toFixed(1)} KB, ${mimeType})...\n`);

const result = await client.upload(stream, {
  filename,
  path: "test-uploads",
  mimeType,
});

console.log("Upload result:");
console.log("  id:", result.id);
console.log("  url:", result.url);
console.log("  path:", result.path);
console.log("  size:", result.size, "bytes");
console.log("  meta:");
console.log("    publicId:   ", result.meta.publicId);
console.log("    version:   ", result.meta.version);
console.log("    format:    ", result.meta.format);
console.log("    resourceType:", result.meta.resourceType);
console.log("    bytes:     ", result.meta.bytes);
console.log("    secureUrl: ", result.meta.secureUrl);
if (result.meta.width) console.log("    width:     ", result.meta.width);
if (result.meta.height) console.log("    height:    ", result.meta.height);

const url = await driver.getUrl(result.path);
console.log("\nGenerated URL:", url);

const deleted = await client.delete(result.path);
console.log("Deleted:", deleted);
