import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { Package } from "lucide-react";
import { source } from "@/lib/source";
import { GITHUB_URL, NPM_URL } from "@/lib/site";
import { Logo } from "@/components/brand";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: <Logo label="Docs" />, mode: "top" }}
      githubUrl={GITHUB_URL}
      links={[
        {
          type: "icon",
          label: "npm",
          text: "npm",
          url: NPM_URL,
          icon: <Package />,
          external: true,
        },
      ]}
      themeSwitch={{ enabled: true }}
    >
      {children}
    </DocsLayout>
  );
}
