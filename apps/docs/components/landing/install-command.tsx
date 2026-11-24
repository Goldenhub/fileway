"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { track } from "@/lib/analytics";

export const INSTALL_COMMAND = "npm install @fileway/core @fileway/s3";

/**
 * Copies a command. Copying the install command is the landing page's main
 * conversion, so every copy is tracked as `install_copy` with where it happened.
 */
export function CopyButton({ text, location, className = "" }: { text: string; location: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the command stays selectable.
    }
    track("install_copy", { location });
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy install command"}
      className={`ml-auto flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink ${className}`}
    >
      {copied ? <Check className="size-4 text-brand-ink" /> : <Copy className="size-4" />}
    </button>
  );
}

/** The install command in a pill, with a copy button. */
export function InstallCommand({ location, className = "" }: { location: string; className?: string }) {
  return (
    <div
      className={`flex h-10 min-w-0 items-center gap-3 rounded-full border border-line bg-surface pl-4 pr-1.5 font-mono text-[13px] ${className}`}
    >
      <span className="select-none text-ink-muted">$</span>
      <code className="min-w-0 truncate text-ink">{INSTALL_COMMAND}</code>
      <CopyButton text={INSTALL_COMMAND} location={location} />
    </div>
  );
}
