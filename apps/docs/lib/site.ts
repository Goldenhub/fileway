export const SITE_NAME = "Fileway";
export const SITE_DESCRIPTION =
  "Runtime-agnostic file storage for JavaScript & TypeScript. Zero-dependency drivers for local disk, AWS S3, Cloudflare R2, MinIO, and Cloudinary with full type inference.";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fileway.dev";
export const GITHUB_URL = "https://github.com/Goldenhub/fileway";
export const NPM_URL = "https://www.npmjs.com/org/fileway";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}
