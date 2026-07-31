import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "content", "docs");
const publicDir = join(root, "public");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fileway.dev";
const SITE_NAME = "Fileway";
const SITE_DESCRIPTION =
  "Runtime-agnostic file storage for JavaScript & TypeScript. Zero-dependency drivers for local disk, AWS S3, Cloudflare R2, MinIO, and Cloudinary with full type inference.";

function parseFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { front: {}, body: md };
  const front = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    front[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return { front, body: md.slice(match[0].length) };
}

// Strip MDX JSX component lines (Tabs/Tab/callouts/etc.), keep markdown.
function stripMdx(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => !/^<[^>]*>[\s]*$/.test(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function orderFor(dir, metaJson) {
  if (!metaJson?.pages) return null;
  return new Map(metaJson.pages.map((p, i) => [p.replace(/\.mdx?$/, ""), i]));
}

async function walk(dir, base = contentDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let metaJson = null;
  try {
    metaJson = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  } catch {}

  const order = orderFor(dir, metaJson);
  const files = entries
    .filter((e) => e.name.endsWith(".mdx"))
    .sort((a, b) => {
      const an = a.name.replace(/\.mdx$/, "");
      const bn = b.name.replace(/\.mdx$/, "");
      const ai = order?.get(an) ?? Number.MAX_SAFE_INTEGER;
      const bi = order?.get(bn) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi || an.localeCompare(bn);
    });

  const pages = [];
  for (const file of files) {
    const full = join(dir, file.name);
    const raw = await readFile(full, "utf8");
    const { front, body } = parseFrontmatter(raw);
    const relPath = file.name === "index.mdx" ? relative(base, dir) : join(relative(base, dir), file.name.replace(/\.mdx$/, ""));
    let url = `/docs/${relPath.split("/").map(encodeURIComponent).join("/")}`;
    if (relPath === "") url = "/docs";
    const mtime = (await stat(full)).mtime;
    pages.push({
      url,
      title: front.title ?? file.name.replace(/\.mdx$/, ""),
      description: front.description ?? "",
      body: stripMdx(body),
      updated: mtime.toISOString(),
    });
  }

  const subdirs = entries.filter((e) => e.isDirectory() && e.name !== "node_modules");
  for (const d of subdirs) {
    pages.push(...(await walk(join(dir, d.name), base)));
  }
  return pages;
}

async function main() {
  const pages = (await walk(contentDir)).filter((p) => p.url !== "/docs");

  await mkdir(publicDir, { recursive: true });

  // --- llms.txt (index) ---
  const indexLines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `## Docs`,
    "",
    ...pages.map((p) => `- [${p.title}](${SITE}${p.url}): ${p.description || "Fileway documentation."}`),
    "",
    `> Full documentation: ${SITE}/llms-full.txt`,
    "",
  ];
  await writeFile(join(publicDir, "llms.txt"), indexLines.join("\n"), "utf8");

  // --- llms-full.txt (all content) ---
  const fullLines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    ...pages.map((p) => {
      const heading = p.url === "/docs" ? "" : `# ${p.title}\n\n`;
      const desc = p.description ? `> ${p.description}\n\n` : "";
      return `${heading}${desc}${p.body}\n\n---\n`;
    }),
  ];
  await writeFile(join(publicDir, "llms-full.txt"), fullLines.join("\n"), "utf8");

  // --- atom.xml ---
  const entries = pages
    .map(
      (p) => `<entry>
  <title>${escapeXml(p.title)}</title>
  <link href="${SITE}${p.url}"/>
  <id>${SITE}${p.url}</id>
  <updated>${p.updated}</updated>
  <summary>${escapeXml(p.description)}</summary>
</entry>`,
    )
    .join("\n");
  const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${SITE_NAME}</title>
  <subtitle>${escapeXml(SITE_DESCRIPTION)}</subtitle>
  <link href="${SITE}/"/>
  <link rel="self" href="${SITE}/atom.xml"/>
  <updated>${new Date().toISOString()}</updated>
  <id>${SITE}/</id>
${entries}
</feed>
`;
  await writeFile(join(publicDir, "atom.xml"), feed, "utf8");

  console.log(`Generated llms.txt, llms-full.txt, atom.xml for ${pages.length} pages → public/`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
