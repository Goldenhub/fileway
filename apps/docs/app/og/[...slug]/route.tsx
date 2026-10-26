import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { ogImageUrl, source } from "@/lib/source";
import { HOME_OG_IMAGE, OG_IMAGE_SIZE, SITE_URL } from "@/lib/site";

// Open Graph images, rendered once at build time (the site is a static export):
//   /og/home.png              landing page
//   /og/docs/<page path>.png  one per docs page (the docs index is index.png)
export const dynamic = "force-static";

const INK = "#0a0a0a";
const MUTED = "#6b7280";
const BRAND = "#ffb224";
const BRAND_INK = "#b45309";
const BRAND_SOFT = "#fff7e6";
const LINE = "#e5e7eb";

const asset = (path: string) => readFile(join(process.cwd(), "assets", path));

/** The amber line art used in the site hero, as an image. */
function linesDataUri(): string {
  const paths = Array.from({ length: 18 }, (_, i) => {
    const d = `M ${-100 + i * 8} ${640 - i * 6} C 400 ${600 - i * 14}, 700 ${140 + i * 10}, 1300 ${30 + i * 12}`;
    return `<path d="${d}" stroke="${BRAND}" stroke-width="1.5" stroke-opacity="${(0.18 + (i % 6) * 0.06).toFixed(2)}" fill="none"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${paths}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

type Card = { eyebrow?: string; title: string; highlight?: string; description?: string; badge?: string };

async function render(card: Card): Promise<Response> {
  const [inter500, inter700, logo] = await Promise.all([
    asset("fonts/Inter-500.ttf"),
    asset("fonts/Inter-700.ttf"),
    asset("og-logo.png"),
  ]);
  const logoUri = `data:image/png;base64,${logo.toString("base64")}`;
  const host = new URL(SITE_URL).host.replace(/^www\./, "");
  const titleSize = card.title.length > 42 ? 60 : 72;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#ffffff",
          fontFamily: "Inter",
          position: "relative",
        }}
      >
        <img src={linesDataUri()} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0 }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <img src={logoUri} width={60} height={52} />
            <span style={{ fontSize: 40, fontWeight: 700, color: INK, letterSpacing: "-0.04em" }}>Fileway</span>
          </div>
          {card.badge ? (
            <span
              style={{
                fontSize: 24,
                fontWeight: 500,
                color: MUTED,
                border: `2px solid ${LINE}`,
                borderRadius: 999,
                padding: "8px 22px",
                backgroundColor: "#ffffff",
              }}
            >
              {card.badge}
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 1000 }}>
          {card.eyebrow ? (
            <span style={{ fontSize: 30, fontWeight: 700, color: BRAND_INK, marginBottom: 18 }}>{card.eyebrow}</span>
          ) : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: titleSize,
              fontWeight: 700,
              color: INK,
              letterSpacing: "-0.035em",
              lineHeight: 1.08,
            }}
          >
            <span>{card.title}</span>
            {card.highlight ? <span style={{ color: BRAND_INK }}>{card.highlight}</span> : null}
          </div>
          {card.description ? (
            <span style={{ fontSize: 30, fontWeight: 500, color: MUTED, marginTop: 24, lineHeight: 1.35, maxWidth: 940 }}>
              {truncate(card.description, 130)}
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 26, fontWeight: 500, color: MUTED }}>{host}</span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 500,
              color: BRAND_INK,
              backgroundColor: BRAND_SOFT,
              borderRadius: 999,
              padding: "8px 22px",
            }}
          >
            npm i @fileway/core
          </span>
        </div>
      </div>
    ),
    {
      ...OG_IMAGE_SIZE,
      fonts: [
        { name: "Inter", data: inter500, weight: 500, style: "normal" },
        { name: "Inter", data: inter700, weight: 700, style: "normal" },
      ],
    },
  );
}

/** Maps route params back to a docs page: ["docs", "guide", "uploads.png"]. */
function docsPageFor(params: string[]) {
  if (params[0] !== "docs") return undefined;
  const parts = params.slice(1);
  const last = parts.pop()?.replace(/\.png$/, "");
  if (last === undefined) return undefined;
  const slugs = parts.length === 0 && last === "index" ? [] : [...parts, last];
  return source.getPage(slugs);
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;

  if (slug.join("/") === HOME_OG_IMAGE.replace(/^\/og\//, "")) {
    return render({
      title: "One standard API for all your file storage.",
      highlight: "Zero dependencies.",
      description: "Local disk, AWS S3, Cloudflare R2, MinIO and Cloudinary. Runs on Node.js, Bun, Deno and the edge.",
    });
  }

  const page = docsPageFor(slug);
  if (!page) notFound();
  const section = getBreadcrumbItems(page.url, source.pageTree)[0]?.name;
  return render({
    eyebrow: typeof section === "string" ? section : undefined,
    title: page.data.title,
    description: page.data.description,
    badge: "Docs",
  });
}

export function generateStaticParams() {
  const toParams = (url: string) => ({ slug: url.replace(/^\/og\//, "").split("/") });
  return [toParams(HOME_OG_IMAGE), ...source.getPages().map((page) => toParams(ogImageUrl(page.slugs)))];
}
