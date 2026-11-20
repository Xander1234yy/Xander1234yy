import * as React from "react";
import { cn } from "./cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-fg placeholder:text-muted/70 outline-none transition focus:border-accent/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
}
