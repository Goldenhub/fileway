import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { source } from "@/lib/source";
import { ChangelogSidebarFooter } from "@/components/changelog-sidebar-footer";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      nav={{ title: "Fileway" }}
      tree={source.pageTree}
      themeSwitch={{ enabled: false }}
      sidebar={{ footer: ChangelogSidebarFooter }}
    >
      {children}
    </DocsLayout>
  );
}
