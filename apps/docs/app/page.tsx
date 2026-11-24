import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { ProofStrip } from "../components/landing/proof-strip";
import { InteractiveDemo } from "../components/landing/interactive-demo";
import { WhoItsFor } from "../components/landing/who-its-for";
import { CodeComparison } from "../components/landing/code-comparison";
import { BentoGrid } from "../components/landing/bento-grid";
import { DriversSection } from "../components/landing/drivers-section";
import { FaqSection, faqs } from "../components/landing/faq";
import { FinalCta, InfraTeaser } from "../components/landing/final-cta";
import { Footer } from "../components/landing/footer";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL, GITHUB_URL, NPM_URL } from "@/lib/site";

const jsonLd = [
  {
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
        url: `${SITE_URL}/icon.png`,
      },
      sameAs: [GITHUB_URL, NPM_URL],
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
];

// The page follows the visitor's questions in order: what is it (hero), can I
// trust it (proof), how does it work (demo), is it for me (who), why switch
// (comparison), what else (features, drivers), doubts (FAQ), then the ask.
export default function HomePage() {
  return (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main>
        <Hero />
        <ProofStrip />
        <InteractiveDemo />
        <WhoItsFor />
        <CodeComparison />
        <BentoGrid />
        <DriversSection />
        <FaqSection />
        <InfraTeaser />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
