import type { Metadata } from "next";
import { markdownUrl, ogImageUrl, source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { PageFeedback } from "@/components/page-feedback";
import { SITE_NAME, GITHUB_URL, OG_IMAGE_SIZE, FEED_ALTERNATE, absoluteUrl } from "@/lib/site";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  const isChangelog =
    page.slugs.length === 2 && page.slugs[0] === "reference" && page.slugs[1] === "changelog";

  const MDX = page.data.body;
  // Section name (e.g. "Guide") shown as an eyebrow above the title.
  const section = getBreadcrumbItems(page.url, source.pageTree)[0]?.name;
  const mdUrl = markdownUrl(page.slugs);
  const sourceUrl = `${GITHUB_URL}/blob/main/apps/docs/content/docs/${page.path}`;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.data.title,
    description: page.data.description,
    url: absoluteUrl(page.url),
    image: absoluteUrl(ogImageUrl(page.slugs)),
    ...(page.data.lastModified ? { dateModified: new Date(page.data.lastModified).toISOString() } : {}),
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Docs",
        item: absoluteUrl("/docs"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: page.data.title,
        item: absoluteUrl(page.url),
      },
    ],
  };

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      footer={isChangelog ? { enabled: false } : undefined}
      // The section eyebrow below replaces the built-in breadcrumb.
      breadcrumb={{ enabled: false }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {section ? <p className="mb-2 text-sm font-semibold text-brand-ink">{section}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <DocsTitle>{page.data.title}</DocsTitle>
        <div className="flex shrink-0 items-center gap-2">
          <MarkdownCopyButton markdownUrl={mdUrl} />
          <ViewOptionsPopover markdownUrl={mdUrl} githubUrl={sourceUrl} />
        </div>
      </div>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, Tab, Tabs, Step, Steps }} />
      </DocsBody>
      <PageFeedback page={page.url} />
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const title = page.data.title;
  const description = page.data.description;
  // Share previews have no tab title around them, so name the site explicitly.
  const socialTitle = `${title} · ${SITE_NAME}`;
  const image = ogImageUrl(page.slugs);

  return {
    title,
    description,
    alternates: {
      canonical: page.url,
      types: FEED_ALTERNATE,
    },
    openGraph: {
      type: "article",
      title: socialTitle,
      description,
      url: absoluteUrl(page.url),
      siteName: SITE_NAME,
      locale: "en_US",
      images: [{ url: image, ...OG_IMAGE_SIZE, alt: socialTitle }],
      ...(page.data.lastModified ? { modifiedTime: new Date(page.data.lastModified).toISOString() } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [image],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
