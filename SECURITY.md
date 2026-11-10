# Security Policy

Fileway handles storage credentials, signs requests and download links, and reads and writes files on disk, so we take security reports seriously. Thank you for helping keep Fileway and its users safe.

## Supported versions

| Version | Supported |
| --- | :-: |
| 0.7.x | ✅ |
| Earlier than 0.7 | ❌ |

Before 1.0, security fixes ship as a patch release of the latest minor version. If you're on an older version, upgrade to get the fix. This policy will be reviewed when Fileway reaches 1.0.

## Reporting a vulnerability

**Please don't report security problems in public issues, Discussions, pull requests or social media.**

Report privately through either:

- **GitHub (preferred):** [report a vulnerability](https://github.com/Goldenhub/fileway/security/advisories/new) using GitHub's private vulnerability reporting.
- **Email:** security@usefileway.dev, if you can't use GitHub.

Helpful details to include:

- the affected package(s) and version, for example `@fileway/s3@0.7.0`;
- the runtime (Node.js, Bun, Deno, Cloudflare Workers...) and driver;
- steps to reproduce, or a proof of concept;
- the impact: what an attacker could do;
- whether you'd like to be credited, and how.

## What happens next

- **Within 3 business days:** we acknowledge your report.
- **Within 7 days:** we share a first assessment (whether we can reproduce it, how severe it is, and the next steps).
- **While we work on it:** we keep you updated, and may ask you to help confirm the fix.
- **The fix:** released as a patch version, published to npm with provenance, with a [GitHub Security Advisory](https://github.com/Goldenhub/fileway/security/advisories) (and a CVE when the issue qualifies) and an entry in the [changelog](CHANGELOG.md).
- **Disclosure:** we aim to publish within 90 days of your report, sooner once a fix is out. We'll agree the timing with you.
- **Credit:** we credit reporters in the advisory and changelog unless you'd rather stay anonymous.

## Scope

**In scope:** every `@fileway/*` package in this repository (`core`, `local`, `s3`, `gcs`, `azure`, `supabase`, `cloudinary`) and the documentation site at usefileway.dev. Areas where we especially want to hear about problems:

- request signing: AWS SigV4, Azure Shared Key and SAS, Google Cloud service account tokens and signed URLs;
- app-signed links: signature checks, expiry, which files open in the browser, and the response headers;
- `LocalDriver` path handling: escaping the storage directory, symbolic links;
- `client.handler` routing and plugin routes;
- upload size limits and signed upload links;
- anything that could leak credentials, for example in error messages, logs or events.

**Out of scope:**

- misconfiguration in your own cloud account, such as public buckets or overly broad keys;
- vulnerabilities in third-party services (AWS, Google Cloud, Azure, Supabase, Cloudinary); please report those to the provider;
- attacks that need an already compromised machine or leaked secrets;
- missing security headers or best practices with no demonstrated impact;
- denial of service through unlimited settings you configured yourself;
- social engineering and physical attacks.

Fileway Infrastructure is developed in a separate private repository. Report issues with it through the same channels above.

## Safe harbor

We welcome good-faith security research that follows this policy, and won't pursue legal action over it. Please:

- only test against your own accounts, buckets and data;
- don't access, change or delete other people's data;
- don't degrade services for others;
- don't keep any data you come across longer than needed to report it;
- give us reasonable time to fix the issue before sharing it publicly.
