"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { track } from "@/lib/analytics";

/** "Was this page helpful?" row. Votes are recorded as analytics events. */
export function PageFeedback({ page }: { page: string }) {
  const [vote, setVote] = useState<"yes" | "no" | null>(null);

  const send = (value: "yes" | "no") => {
    if (vote) return;
    setVote(value);
    track("docs_feedback", { page, helpful: value === "yes" });
  };

  const button =
    "inline-flex items-center gap-1.5 rounded-full border border-fd-border px-3 py-1 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground disabled:cursor-default data-[selected=true]:bg-fd-accent data-[selected=true]:text-fd-accent-foreground";

  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-fd-border pt-6">
      <p className="text-sm text-fd-muted-foreground">
        {vote ? "Thanks for the feedback!" : "Was this page helpful?"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={button}
          disabled={vote !== null}
          data-selected={vote === "yes"}
          onClick={() => send("yes")}
        >
          <ThumbsUp className="size-3.5" /> Yes
        </button>
        <button
          type="button"
          className={button}
          disabled={vote !== null}
          data-selected={vote === "no"}
          onClick={() => send("no")}
        >
          <ThumbsDown className="size-3.5" /> No
        </button>
      </div>
    </div>
  );
}
