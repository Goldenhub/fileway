import type { Metadata } from "next";
import { LegalPage, H2, H3, P, Ul, A, Strong, LEGAL_EMAIL, LEGAL_OPERATOR } from "@/components/landing/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Fileway collects on usefileway.dev and in Fileway Infrastructure, why, who processes it, how long it is kept and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <>
          <p>
            This policy explains what information Fileway collects, why, and what you can do about it. It covers this
            website (usefileway.dev, including the documentation) and <Strong>Fileway Infrastructure</Strong>, the hosted
            dashboard at app.usefileway.dev and its API at api.usefileway.dev.
          </p>
          <p className="mt-4">
            The open source Fileway framework (the <code>@fileway/*</code> packages on npm) runs entirely inside your own
            application. It sends nothing to us unless you add the <code>@fileway/infra</code> plugin and connect it to
            Fileway Infrastructure.
          </p>
        </>
      }
    >
      <H2 id="who">Who we are</H2>
      <P>
        Fileway is operated by {LEGAL_OPERATOR} ("we", "us"). We are the controller of the account information described
        below. For the file activity your apps send to Fileway Infrastructure, you are the controller and we process it on
        your behalf. Contact: <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A>.
      </P>

      <H2 id="summary">The short version</H2>
      <Ul>
        <li>We collect what we need to sign you in and run the dashboard, and nothing for advertising.</li>
        <li>
          Your files never pass through our servers. File contents go between your users, your app and your storage
          provider only.
        </li>
        <li>We do not sell personal information, and we do not use it to train AI models.</li>
        <li>
          You can ask us at any time for a copy of your data or to delete it: <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A>.
        </li>
      </Ul>

      <H2 id="collect">What we collect</H2>

      <H3>When you sign in to the dashboard</H3>
      <P>
        You sign in with GitHub or Google. We receive and store your <Strong>name, email address, profile picture URL</Strong>{" "}
        and your account ID at that provider. From Google we request only the basic <code>openid</code>,{" "}
        <code>email</code> and <code>profile</code> scopes. We never get your password and cannot read your email,
        repositories, contacts or files at GitHub or Google.
      </P>
      <P>
        The sign-in tokens the provider issues are stored with your account so the sign-in works; we do not use them to
        call GitHub or Google on your behalf.
      </P>
      <P>
        For each signed-in session we store the session expiry, your <Strong>IP address and browser user agent</Strong>{" "}
        (so you can recognise your sessions and so we can spot abuse), and a session cookie in your browser.
      </P>

      <H3>Organizations, projects and keys</H3>
      <P>
        What you create in the dashboard: organization and project names, who is a member and with which role, the URL
        of your app, and API keys. We store only a one way hash of each API key, never the key itself.
      </P>

      <H3>File activity from your app</H3>
      <P>
        When you connect an app with the <code>@fileway/infra</code> plugin, it sends us a record of each file
        operation so the dashboard can show your audit log and analytics:
      </P>
      <Ul>
        <li>the operation (upload, download, delete, and so on), whether it succeeded, the error if it failed, how long it took and which storage driver ran it;</li>
        <li>the file path, unless you configure the plugin to send a hash of it or nothing;</li>
        <li>the file size and type, unless you turn that off;</li>
        <li>the actor and tags your app attaches, if any (for example your own user ID for whoever uploaded the file);</li>
        <li>the plugin, framework and driver versions, and the app's settings for what it reports.</li>
      </Ul>
      <P>
        We never receive file contents or your storage credentials. When you browse files in the dashboard, your browser
        talks to your app directly; the file data does not go through our servers.
      </P>
      <P>
        If you put personal information about your own users into paths, actors or tags, you are the controller of that
        information and we process it on your behalf, only to provide the dashboard to you.
      </P>

      <H3>On this website</H3>
      <P>
        We measure visits with Umami, an open source analytics tool we run on our own server. It counts page views,
        referrers, country, browser and device type, and a few clicks (such as copying the install command), without
        cookies and without identifying you; it also skips browsers that send Do Not Track. The site sets no advertising
        or tracking cookies.
      </P>

      <H3>Server logs and error reports</H3>
      <P>
        Like any web service, our servers and Cloudflare record technical request data (IP address, time, URL, status)
        for security and troubleshooting. These logs are kept for a short time and are not used to build profiles.
      </P>
      <P>
        When the dashboard or the API hits an unexpected error, we send an error report to Sentry so we can fix it: the
        error message, where in our code it happened, the route (for example <code>/projects/[projectId]/files</code>),
        the browser or runtime version and the release. Before a report leaves our servers or your browser we remove
        names, email addresses, IP addresses, cookies, request bodies, query strings, API keys and file paths. Reports are
        stored in Sentry's EU region and deleted within 90 days.
      </P>

      <H2 id="use">How we use it</H2>
      <Ul>
        <li>to sign you in, keep your account secure and show you your organizations and projects;</li>
        <li>to provide the audit log, analytics and file browser for the apps you connect;</li>
        <li>to prevent abuse and keep the service running;</li>
        <li>to email you about your account or important changes to the service (no marketing email unless you opt in).</li>
      </Ul>
      <P>
        Where data protection law such as the GDPR applies, our legal basis is the contract with you (providing the
        service you signed up for) and our legitimate interest in keeping it secure.
      </P>

      <H2 id="google">Google user data</H2>
      <P>
        If you choose "Sign in with Google", Fileway uses Google's OAuth sign-in. This section describes exactly how we
        handle the data we receive from Google.
      </P>
      <H3>Data we access</H3>
      <P>
        Only the basic scopes <code>openid</code>, <code>email</code> and <code>profile</code>. From these we receive your
        Google account ID, your name, your email address, whether Google has verified that email address, and the URL of
        your profile picture. Google also issues sign-in tokens (an ID token and an access token). We do not request
        access to Gmail, Google Drive, Calendar, Contacts or any other Google service, and we cannot see your Google
        password.
      </P>
      <H3>How we use it</H3>
      <P>
        Only to create your Fileway account, sign you in, show your name and picture in the dashboard, show your name to
        other members of organizations you join, and email you about your account. We do not use Google user data for
        advertising, to build profiles, or to develop, improve or train AI or machine learning models, and we do not use
        it to create, generate or alter images of anyone.
      </P>
      <H3>How we share it</H3>
      <P>
        We do not sell or transfer Google user data to anyone. Your name, email address and picture are visible only to
        members of organizations you belong to. The data is stored by our hosting provider (Hetzner, in the EU) on our
        behalf, and we disclose it otherwise only when the law requires it.
      </P>
      <H3>How we store and protect it</H3>
      <P>
        Your Google profile data and tokens are stored in our database on servers in Finland (EU). The database is not
        reachable from the internet, all connections use HTTPS, and only the Fileway operators can access it. We do not
        use the Google tokens to call Google APIs on your behalf.
      </P>
      <H3>How long we keep it, and how to delete it</H3>
      <P>
        We keep it while your Fileway account exists. Email <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A> to delete
        your account: we delete your Google profile data and tokens within 30 days, and they leave our backups within 30
        days after that. You can also remove Fileway's access at any time in your{" "}
        <A href="https://myaccount.google.com/connections">Google account settings</A>.
      </P>
      <H3>Limited Use</H3>
      <P>
        Fileway's use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>,
        including the Limited Use requirements.
      </P>

      <H2 id="processors">Who processes it</H2>
      <P>We use a small number of providers to run the service:</P>
      <Ul>
        <li><Strong>Hetzner Online</Strong> (servers and database, including this website and its analytics, in Finland, EU);</li>
        <li><Strong>Cloudflare</Strong> (DNS, network protection and, for database backups, R2 storage in the EU);</li>
        <li><Strong>Sentry</Strong> (error reports with personal data removed, stored in the EU);</li>
        <li><Strong>GitHub</Strong> and <Strong>Google</Strong> (only for signing in, when you choose them).</li>
      </Ul>
      <P>
        We share information otherwise only if the law requires it, or with a successor if the project changes hands,
        in which case this policy continues to apply.
      </P>

      <H2 id="retention">How long we keep it</H2>
      <Ul>
        <li>Account and organization data: until you ask us to delete your account (see below).</li>
        <li>File activity: until the project or your account is deleted. During the beta there is no automatic expiry; we will add one, and update this policy, before paid plans launch.</li>
        <li>Sessions: until they expire or you sign out.</li>
        <li>Backups: deleted after 30 days.</li>
        <li>Error reports: deleted within 90 days.</li>
      </Ul>

      <H2 id="rights">Your choices and rights</H2>
      <P>
        You can see, correct, export or delete your information, and object to how we use it. Email{" "}
        <A href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</A> from the address on your account and we will respond within 30
        days. Deleting your account removes your profile, sessions and memberships; organizations you alone own are deleted
        with their projects and activity. You may also complain to your local data protection authority.
      </P>
      <P>
        You can also revoke Fileway's access at any time in your{" "}
        <A href="https://github.com/settings/applications">GitHub settings</A> or{" "}
        <A href="https://myaccount.google.com/connections">Google account</A>.
      </P>

      <H2 id="security">Security</H2>
      <P>
        All traffic is encrypted with HTTPS. API keys are stored hashed, the database is not reachable from the
        internet, and requests the dashboard sends to your app are signed and expire within a minute. No system is
        perfectly secure; if a breach affects your data we will tell you without undue delay.
      </P>

      <H2 id="children">Children</H2>
      <P>Fileway is a tool for software developers and is not meant for anyone under 16.</P>

      <H2 id="changes">Changes</H2>
      <P>
        We will post any change here and update the date at the top. For significant changes we will also email account
        holders before they take effect.
      </P>
    </LegalPage>
  );
}
