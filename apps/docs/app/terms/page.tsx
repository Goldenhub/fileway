import type { Metadata } from "next";
import { LegalPage, H2, P, Ul, A, Strong, LEGAL_EMAIL, LEGAL_OPERATOR } from "@/components/landing/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using Fileway Infrastructure, the hosted dashboard for apps built with Fileway, during its beta.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro={
        <p>
          These terms apply to <Strong>Fileway Infrastructure</Strong>: the hosted dashboard at app.usefileway.dev and
          its API at api.usefileway.dev (together, "the service"), operated by {LEGAL_OPERATOR} ("we", "us"). They are
          an agreement between you and us; by creating an account you agree to them. The open
          source Fileway packages are not covered here; they are licensed under the{" "}
          <A href="https://github.com/Goldenhub/fileway/blob/main/LICENSE">MIT License</A>.
        </p>
      }
    >
      <H2 id="beta">A beta service</H2>
      <P>
        The service is in beta and free of charge while it is. Features may change, and the service may be unavailable
        at times. There is no uptime commitment during the beta. We will give at least 30 days' notice by email before
        any paid plan applies to you, and you can stop using the service at any time.
      </P>

      <H2 id="account">Your account</H2>
      <Ul>
        <li>You need a GitHub or Google account to sign in, and you must be at least 16.</li>
        <li>You are responsible for what happens under your account and in the organizations you own, including who you invite and which roles they have.</li>
        <li>Keep your API keys secret. Revoke a key in the dashboard as soon as you think it has leaked.</li>
        <li>If you sign up on behalf of a company, you confirm you are allowed to accept these terms for it.</li>
      </Ul>

      <H2 id="your-data">Your data</H2>
      <P>
        You keep all rights to the data your apps send to the service and to your files, which stay in your own storage.
        You give us permission to store and process that data only to provide the service to you. If it includes personal
        information about your own users, you are responsible for having a lawful basis to send it; the plugin lets you
        hash or leave out file paths and file details. How we handle personal information is described in the{" "}
        <A href="/privacy">privacy policy</A>.
      </P>

      <H2 id="acceptable-use">Acceptable use</H2>
      <P>You agree not to use the service to:</P>
      <Ul>
        <li>break the law or infringe anyone's rights;</li>
        <li>store, manage or distribute illegal content, including child sexual abuse material or non-consensual intimate imagery (real or AI generated);</li>
        <li>distribute malware, or to phish, spam or defraud;</li>
        <li>probe, overload or attack the service or other people's systems, or get around its limits;</li>
        <li>access another customer's data, or resell the service without our written permission.</li>
      </Ul>
      <P>
        During the beta, accounts have usage limits (such as the number of projects and active API keys) to keep the
        service fair for everyone.
      </P>

      <H2 id="suspension">Suspension and termination</H2>
      <P>
        You can delete a project in its settings at any time, and ask us to delete your account by emailing{" "}
        <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A>. We may suspend or close an account that breaks these terms or puts the
        service or others at risk, with notice where we reasonably can. If we ever shut the service down, we will give at
        least 30 days' notice so you can export your data. Your apps keep working without the service: the plugin never
        blocks file operations.
      </P>

      <H2 id="warranty">No warranty</H2>
      <P>
        The service is provided "as is" and "as available", without warranties of any kind, express or implied,
        including fitness for a particular purpose and non-infringement, to the extent the law allows.
      </P>

      <H2 id="liability">Limitation of liability</H2>
      <P>
        To the extent the law allows, we are not liable for indirect, incidental or consequential damages, or for lost
        profits, revenue or data, arising from your use of the service. Nothing in these terms limits liability that
        cannot be limited by law.
      </P>

      <H2 id="changes">Changes</H2>
      <P>
        We may update these terms. We will post the new version here with a new date and, for material changes, email
        account holders at least 14 days before they take effect. Continuing to use the service after that means you
        accept the new terms.
      </P>

      <H2 id="law">Governing law</H2>
      <P>
        These terms are governed by the laws of the Federal Republic of Nigeria. If a provision is found unenforceable,
        the rest of the terms remain in effect. Nothing in these terms takes away rights you have under the consumer
        protection laws of the country where you live.
      </P>

      <H2 id="contact">Contact</H2>
      <P>
        Questions about these terms: <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A>.
      </P>
    </LegalPage>
  );
}
