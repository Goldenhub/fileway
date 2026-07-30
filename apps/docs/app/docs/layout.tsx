import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      nav={{ title: "BetterPush" }}
      tree={source.pageTree}
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  );
}
