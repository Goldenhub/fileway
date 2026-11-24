"use client";

import { useState } from "react";
import { Section, SectionHeading } from "./ui";

type Row = { situation: string; answer: string };

type Audience = {
  id: string;
  label: string;
  pitch: string;
  rows: Row[];
};

const audiences: Audience[] = [
  {
    id: "solo",
    label: "Solo developers",
    pitch: "Ship file uploads in an afternoon, and never rewrite them when your app grows.",
    rows: [
      {
        situation: "I just need users to upload a profile picture, without learning a cloud SDK.",
        answer: "One upload call works with S3, R2, Supabase, Cloudinary and the rest. Swap providers by changing the driver.",
      },
      {
        situation: "My app runs on Vercel Edge or Cloudflare Workers, and the AWS SDK won't load there.",
        answer: "Every cloud driver is pure fetch and Web Crypto, so it runs on Node, Bun, Deno and edge runtimes.",
      },
      {
        situation: "I store files on my server's disk for now, but I'll need the cloud later.",
        answer: "Start with the local driver. Moving to S3 or R2 is a one-line driver change, not a rewrite.",
      },
      {
        situation: "I need to show a private file to one user without making the bucket public.",
        answer: "Generate a link that expires. Providers without presigning get app-signed links, built in.",
      },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    pitch: "One storage layer every service shares, with the hooks your team needs to run it.",
    rows: [
      {
        situation: "Every service talks to storage differently, and each one has its own bugs.",
        answer: "One typed API and one error model across all your services, whatever provider they use.",
      },
      {
        situation: "We're moving from one provider to another, and it touches every upload path.",
        answer: "A migration is a driver swap. list, copy and move help you move existing files across.",
      },
      {
        situation: "Someone deleted a file in production, and nobody knows who.",
        answer: "Every operation emits an event with the actor and tags, so plugins can write your audit trail.",
      },
      {
        situation: "Browsers need to upload large files, but we can't expose storage keys.",
        answer: "Hand out signed upload links with a size limit. Bodies stream straight through, never buffered.",
      },
    ],
  },
];

export function WhoItsFor() {
  const [active, setActive] = useState(0);
  const audience = audiences[active] ?? audiences[0];
  if (!audience) return null;

  return (
    <Section id="who-its-for">
      <SectionHeading eyebrow="Who it's for" title="Built for how you work">
        Whether you're shipping a side project alone or running storage for a team, here is where Fileway fits.
      </SectionHeading>

      <div className="mt-10">
        <div role="tablist" aria-label="Audience" className="flex w-fit gap-1 rounded-full border border-line bg-surface-muted p-1">
          {audiences.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              id={`who-tab-${a.id}`}
              aria-selected={i === active}
              aria-controls={`who-panel-${a.id}`}
              onClick={() => setActive(i)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                i === active ? "bg-surface text-brand-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`who-panel-${audience.id}`} aria-labelledby={`who-tab-${audience.id}`} className="mt-8">
          <p className="max-w-2xl text-base font-medium text-ink">{audience.pitch}</p>

          <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="hidden grid-cols-2 gap-6 border-b border-line bg-surface-muted px-6 py-3 text-xs font-medium uppercase tracking-wide text-ink-muted md:grid">
              <span>You're in this situation</span>
              <span>What Fileway does</span>
            </div>
            <ul className="divide-y divide-line">
              {audience.rows.map((row) => (
                <li key={row.situation} className="grid gap-2 px-6 py-5 md:grid-cols-2 md:gap-6">
                  <p className="text-sm leading-relaxed text-ink">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted md:hidden">
                      You're in this situation
                    </span>
                    “{row.situation}”
                  </p>
                  <p className="text-sm leading-relaxed text-ink-muted">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-brand-ink md:hidden">
                      What Fileway does
                    </span>
                    {row.answer}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
