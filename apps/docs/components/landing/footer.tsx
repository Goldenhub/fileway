import Link from "next/link";
import { GITHUB_URL, NPM_URL } from "@/lib/site";
import { GitHubIcon, Logo } from "../brand";

const columns = [
  {
    title: "Docs",
    links: [
      { label: "Introduction", href: "/docs" },
      { label: "Uploads", href: "/docs/guide/uploads" },
      { label: "Middleware", href: "/docs/guide/middleware" },
      { label: "Changelog", href: "/docs/reference/changelog" },
    ],
  },
  {
    title: "Drivers",
    links: [
      { label: "Local", href: "/docs/drivers/local" },
      { label: "S3, R2 & MinIO", href: "/docs/drivers/s3" },
      { label: "Cloudinary", href: "/docs/drivers/cloudinary" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "Discussions", href: `${GITHUB_URL}/discussions` },
      { label: "npm", href: NPM_URL },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
            Runtime-agnostic file storage for JavaScript & TypeScript.
          </p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold text-ink">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-ink-muted transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-6 text-sm text-ink-muted sm:px-6">
          <p>Open source under the MIT License</p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="transition-colors hover:text-ink"
          >
            <GitHubIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
