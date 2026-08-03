"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof Link> & {
  event: string;
  data?: Record<string, string | number | boolean>;
};

export function TrackedLink({ event, data, onClick, ...props }: Props) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track(event, data);
        onClick?.(e);
      }}
    />
  );
}
