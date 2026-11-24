import { Plus } from "lucide-react";
import { GITHUB_URL } from "@/lib/site";
import { Section, SectionHeading } from "./ui";

export type Faq = { q: string; a: string };

/** Also rendered as FAQPage structured data on the landing page. */
export const faqs: Faq[] = [
  {
    q: "Is Fileway ready for production?",
    a: "Fileway is before 1.0, so a minor release can include breaking changes, and every one is listed in the changelog with how to upgrade. Each release runs 350+ unit tests plus integration tests against real S3 (MinIO) and Azure (Azurite) emulators, and packages are published to npm with provenance.",
  },
  {
    q: "Do my files go through Fileway's servers?",
    a: "No. Fileway is a library that runs inside your app. Files go straight from your app to your own storage provider, using your own credentials. Nothing is sent anywhere else.",
  },
  {
    q: "How is this different from using the AWS SDK directly?",
    a: "An SDK ties your code to one provider, and often to Node.js. Fileway gives you one small API across seven providers, runs on the edge, streams instead of buffering, and adds what SDKs leave to you: typed errors, retries, signed links, upload links, events and plugins.",
  },
  {
    q: "Can users upload from the browser without exposing my keys?",
    a: "Yes. Your server creates a signed upload link that fixes the file name, type and size limit and expires in minutes. The browser uploads with a plain fetch, and the size limit is enforced while the file streams.",
  },
  {
    q: "My provider isn't listed. Can I still use Fileway?",
    a: "Any S3-compatible service works with the S3 driver, including Cloudflare R2, MinIO, DigitalOcean Spaces and Backblaze B2. For anything else, open an issue, or write a driver: the contract is small and documented.",
  },
  {
    q: "Is it free?",
    a: "Yes. Fileway is MIT licensed and free to use in any project, commercial or not. Fileway Infrastructure, an optional hosted dashboard, is coming later as a paid product. The framework stays free.",
  },
];

export function FaqSection() {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading eyebrow="FAQ" title="Questions developers ask">
          Something else on your mind? Ask in{" "}
          <a href={`${GITHUB_URL}/discussions`} className="font-medium text-ink underline underline-offset-4">
            GitHub Discussions
          </a>
          .
        </SectionHeading>

        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-base font-medium text-ink">
                {f.q}
                <Plus className="mt-0.5 size-5 shrink-0 text-ink-muted transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
