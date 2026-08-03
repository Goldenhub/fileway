import { track as vercelTrack } from "@vercel/analytics";

/**
 * Site analytics facade. Pageviews are automatic (Vercel Analytics);
 * use this for manual events (CTAs, driver picks, copy clicks).
 *
 * Swapping providers later only means changing this one file.
 */
export function track(event: string, data?: Record<string, string | number | boolean>) {
  vercelTrack(event, data);
}
