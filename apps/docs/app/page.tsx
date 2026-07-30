import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { InteractiveDemo } from "../components/landing/interactive-demo";
import { BentoGrid } from "../components/landing/bento-grid";
import { DriversSection } from "../components/landing/drivers-section";
import { CodeComparison } from "../components/landing/code-comparison";
import { Footer } from "../components/landing/footer";

export default function HomePage() {
  return (
    <div className="landing-page min-h-screen font-sans">
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
