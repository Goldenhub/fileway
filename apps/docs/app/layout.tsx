import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL, GITHUB_URL, NPM_URL } from "@/lib/site";
import "./global.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
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
    default: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
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
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Runtime-agnostic file storage for JavaScript & TypeScript`,
    description: SITE_DESCRIPTION,
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
  icons: {
    icon: "/icon.svg",
  },
  category: "technology",
  other: {
    "github-repo": GITHUB_URL,
    "npm-package": NPM_URL,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} dark`} suppressHydrationWarning>
      <body>
        <RootProvider theme={{ defaultTheme: "dark" }}>{children}</RootProvider>
      </body>
    </html>
  );
}
