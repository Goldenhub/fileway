import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t py-12" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-bg)" }}>
      <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-8 px-6 md:flex-row">
        <div className="flex items-center gap-4">
          <span className="font-sans text-[14px] font-[600] tracking-[-0.3px]" style={{ color: "var(--lp-text)" }}>
Fileway
          </span>
          <span className="font-sans text-[12px]" style={{ color: "var(--lp-muted)" }}>
            MIT License — Open source
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/docs" className="font-sans text-[13px] transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }}>
            Documentation
          </Link>
          <a
            href="https://github.com/anomalyco/fileway"
            className="font-sans text-[13px] transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/org/fileway"
            className="font-sans text-[13px] transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }}
            target="_blank"
            rel="noopener noreferrer"
          >
            npm
          </a>
        </div>
        <p className="font-sans text-[12px]" style={{ color: "var(--lp-muted)" }}>
          Built with open-source love
        </p>
      </div>
    </footer>
  );
}
