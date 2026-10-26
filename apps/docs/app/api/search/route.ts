import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// The site is a static export, so there is no server to query. The search
// index is built once at build time; the search dialog downloads it and
// searches in the browser (`type: "static"` in app/layout.tsx).
export const dynamic = "force-static";

export const { staticGET: GET } = createFromSource(source);
