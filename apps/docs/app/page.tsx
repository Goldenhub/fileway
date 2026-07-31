import type { Metadata } from "next";
import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { InteractiveDemo } from "../components/landing/interactive-demo";
import { BentoGrid } from "../components/landing/bento-grid";
import { DriversSection } from "../components/landing/drivers-section";
import { CodeComparison } from "../components/landing/code-comparison";
import { Footer } from "../components/landing/footer";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL, GITHUB_URL, NPM_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en-US",
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/icon.svg`,
    },
    sameAs: [GITHUB_URL, NPM_URL],
  },
};

export default function HomePage() {
  return (
    <div className="landing-page min-h-screen font-sans">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main>
        <Hero />
        <InteractiveDemo />
        <BentoGrid />
        <DriversSection />
        <CodeComparison />
      </main>
      <Footer />
    </div>
  );
}
