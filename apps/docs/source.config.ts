import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import lastModified from "fumadocs-mdx/plugins/last-modified";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

// `lastModified` reads each page's last commit date from git (used by the
// sitemap and article metadata). On Vercel, set VERCEL_DEEP_CLONE=true so the
// build has full history; with a shallow clone every page gets the same date.
export default defineConfig({ plugins: [lastModified()] });
