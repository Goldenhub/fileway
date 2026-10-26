import Link from "next/link";
import { Menu } from "lucide-react";
import { Logo, GitHubIcon } from "../brand";
import { GITHUB_URL } from "@/lib/site";
import { Button } from "./ui";

const links = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/drivers/local", label: "Drivers" },
  { href: "/docs/reference/changelog", label: "Changelog" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="Fileway home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-ink-muted transition-colors hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="hidden size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:inline-flex"
          >
            <GitHubIcon />
          </a>
          <Button href="/docs" event="cta_click" data={{ target: "header-get-started" }} className="h-9 px-4">
            Get started
          </Button>

          {/* Mobile menu: native <details>, no client JS. */}
          <details className="group relative md:hidden">
            <summary
              aria-label="Menu"
              className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
            >
              <Menu className="size-5" />
            </summary>
            <nav className="absolute right-0 mt-2 w-48 rounded-xl border border-line bg-surface p-2 shadow-lg">
              {[...links, { href: GITHUB_URL, label: "GitHub" }].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
