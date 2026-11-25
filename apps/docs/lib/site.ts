import pkg from "../package.json";

export const SITE_NAME = "Fileway";
/** Released version; the site is versioned together with the packages. */
export const SITE_VERSION = pkg.version;
/** Meta description: kept under ~160 characters so search results show it whole. */
export const SITE_DESCRIPTION =
  "Write file uploads once and run them on any cloud. One free, open-source TypeScript API for S3, R2, Google Cloud, Azure, Supabase, Cloudinary and local disk.";
/** Title for link previews (Open Graph, X), matching the landing page headline. */
export const SHARE_TITLE = `${SITE_NAME}: Write your file uploads once. Run them on any cloud.`;
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.usefileway.dev";
export const GITHUB_URL = "https://github.com/Goldenhub/fileway";
/** Fileway Infrastructure, the hosted dashboard. */
export const DASHBOARD_URL = "https://app.usefileway.dev";
export const NPM_URL ="https://www.npmjs.com/org/fileway";

/** Shared Open Graph / Twitter image for the landing page (app/og/[...slug]/route.tsx). */
export const HOME_OG_IMAGE = "/og/home.png";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

/** `<link rel="alternate">` for the docs Atom feed (public/atom.xml). Pages that set
 * their own `alternates` must include this too, since Next replaces the object. */
export const FEED_ALTERNATE = {
  "application/atom+xml": [{ url: "/atom.xml", title: `${SITE_NAME} docs updates` }],
};

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}
