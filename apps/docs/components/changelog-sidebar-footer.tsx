"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollText } from "lucide-react";
import type { ComponentProps } from "react";

export function ChangelogSidebarFooter({ children }: ComponentProps<"div">) {
  const pathname = usePathname();
  const active = pathname === "/docs/changelog";

  return (
    <div className="flex flex-col gap-1 border-t p-3">
      <Link
        href="/docs/changelog"
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-widest text-fd-muted-foreground/70 transition-colors hover:bg-fd-accent/40 hover:text-fd-accent-foreground${
          active ? " text-fd-primary" : ""
        }`}
      >
        <ScrollText className="size-3.5 shrink-0" />
        Changelog
      </Link>
      {children}
    </div>
  );
}
