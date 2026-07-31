import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// AI crawlers that fetch content for indexing/answering.
// All are explicitly allowed so models can index the docs.
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Bytespider",
  "CCBot",
  "Amazonbot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "cohere-ai",
  "EmbeddigBot",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      ...AI_AGENTS.map((agent) => ({
        userAgent: agent,
        allow: "/",
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
