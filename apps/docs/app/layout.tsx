import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL, GITHUB_URL, NPM_URL, HOME_OG_IMAGE, OG_IMAGE_SIZE, FEED_ALTERNATE } from "@/lib/site";
import "./global.css";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}: Runtime-agnostic file storage for JavaScript & TypeScript`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: `${SITE_NAME} Contributors`, url: GITHUB_URL }],
  creator: `${SITE_NAME} Contributors`,
  publisher: SITE_NAME,
  keywords: [
    "file storage",
    "file upload",
    "storage engine",
    "S3",
    "AWS S3",
    "Cloudflare R2",
    "MinIO",
    "Cloudinary",
    "ReadableStream",
    "TypeScript",
    "JavaScript",
    "runtime-agnostic",
    "edge runtime",
    "Bun",
    "Deno",
    "Node.js",
  ],
  alternates: {
    canonical: "/",
    types: FEED_ALTERNATE,
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [{ url: HOME_OG_IMAGE, ...OG_IMAGE_SIZE, alt: `${SITE_NAME}: one standard API for all your file storage` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
    images: [HOME_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  category: "technology",
  other: {
    "github-repo": GITHUB_URL,
    "npm-package": NPM_URL,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <RootProvider theme={{ defaultTheme: "light" }} search={{ options: { type: "static" } }}>{children}</RootProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
