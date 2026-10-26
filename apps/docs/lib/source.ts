import { loader } from "fumadocs-core/source";
import { docs } from "../.source/server";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/**
 * URL of a page's processed Markdown (served by `app/md/[...slug]/route.ts`),
 * used by the "Copy page" action. The docs index is `index.md`.
 */
export function markdownUrl(slugs: string[]): string {
  return `/md/${slugs.length > 0 ? slugs.join("/") : "index"}.md`;
}

/** Inverse of `markdownUrl`: route params back to page slugs. */
export function slugsFromMarkdownParams(params: string[]): string[] {
  const parts = [...params];
  const last = parts.pop()?.replace(/\.md$/, "");
  if (last === undefined) return [];
  if (parts.length === 0 && last === "index") return [];
  return [...parts, last];
}
