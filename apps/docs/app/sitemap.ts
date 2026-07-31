import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const docPages = source.getPages().map(
    (page): MetadataRoute.Sitemap[number] => {
      seen.add(page.url);
      return {
        url: `${SITE_URL}${page.url}`,
        changeFrequency: "weekly",
        priority: 0.8,
      };
    },
  );

  const landing: MetadataRoute.Sitemap[number] = {
    url: `${SITE_URL}/`,
    changeFrequency: "monthly",
    priority: 1,
  };

  if (!seen.has("/docs")) {
    docPages.unshift({
      url: `${SITE_URL}/docs`,
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  return [landing, ...docPages];
}
