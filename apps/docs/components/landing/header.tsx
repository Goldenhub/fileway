import Link from "next/link";

export function Header() {
  return (
    <>
      {/* Mobile: floating horizontal bar at top */}
      <header className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 md:hidden backdrop-blur-xl" style={{ borderColor: "var(--lp-border)", backgroundColor: "var(--lp-glass)" }}>
        <div className="flex items-center gap-4">
          <Link href="/" className="font-sans text-[13px] font-semibold tracking-[-0.3px]" style={{ color: "var(--lp-text)" }}>
            F
          </Link>
          <div className="h-3 w-px" style={{ backgroundColor: "var(--lp-border)" }} />
          <Link href="/docs" className="font-sans text-[11px] font-medium transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }}>
            Docs
          </Link>
          <a href="https://github.com/Goldenhub/fileway" className="font-sans text-[11px] font-medium transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }} target="_blank" rel="noopener noreferrer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </header>

      {/* Desktop: floating vertical panel on left */}
      <header className="fixed left-6 top-1/2 z-50 hidden -translate-y-1/2 md:block">
        <div className="rounded-lg backdrop-blur-xl nav-snake-glow" style={{ position: "relative", backgroundColor: "var(--lp-glass)" }}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ filter: "drop-shadow(0 0 4px var(--lp-accent)) drop-shadow(0 0 12px var(--lp-accent))" }} xmlns="http://www.w3.org/2000/svg">
            <rect className="snake-rect-track" x="1" y="1" rx="8" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} />
            <rect className="snake-rect" x="1" y="1" rx="8" strokeWidth="1.5" strokeDasharray="80 920" pathLength={1000} style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} />
          </svg>
          <div className="flex flex-col items-center justify-between px-4 py-8 min-h-50">
            <Link href="/" className="font-sans text-[13px] font-semibold tracking-[-0.3px]" style={{ color: "var(--lp-text)" }}>
              F
            </Link>

            <div className="h-px w-4" style={{ backgroundColor: "var(--lp-border)" }} />

            <Link href="/docs" className="font-sans text-[11px] font-medium transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }} title="Documentation">
              Docs
            </Link>
            <a href="https://github.com/Goldenhub/fileway" className="font-sans text-[11px] font-medium transition-colors hover:text-white" style={{ color: "var(--lp-muted)" }} target="_blank" rel="noopener noreferrer" title="GitHub">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </header>
    </>
  );
}
