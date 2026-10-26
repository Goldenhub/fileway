import { notFound } from "next/navigation";
import { markdownUrl, slugsFromMarkdownParams, source } from "@/lib/source";

// Pre-rendered at build time so it works with `output: "export"`.
export const dynamic = "force-static";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slugsFromMarkdownParams(slug));
  if (!page) notFound();

  const body = (await page.data.getText("processed"))
    // Drop heading-anchor markers (`## Title [#title]`) and extra blank lines.
    .replace(/^(#{1,6} .*?) \[#[^\]]+\]$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return new Response(`# ${page.data.title}\n\n${body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: markdownUrl(page.slugs).replace(/^\/md\//, "").split("/"),
  }));
}
