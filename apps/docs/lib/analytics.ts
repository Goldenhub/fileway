/**
 * Site analytics facade: self-hosted Umami (cookieless, no personal data).
 * Pageviews are automatic once the script loads (see app/layout.tsx); use
 * this for manual events (CTAs, copy clicks, docs feedback).
 *
 * Swapping providers later only means changing this file and the script tag.
 */

/** Umami's website ID, set at build time. Without it no script loads and nothing is tracked. */
export const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "";
export const UMAMI_SCRIPT_URL = "https://stats.usefileway.dev/script.js";

type Umami = { track: (event: string, data?: Record<string, string | number | boolean>) => void };

export function track(event: string, data?: Record<string, string | number | boolean>) {
  // Absent when the script is blocked, not loaded yet, or not configured.
  (globalThis as { umami?: Umami }).umami?.track(event, data);
}
