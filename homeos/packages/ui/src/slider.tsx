"use client";
import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "./cn";

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-6 w-full touch-none select-none items-center data-[disabled]:opacity-40", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/[0.08]">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-accent/70 to-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label="Waarde"
        className="block size-5 rounded-full border-2 border-accent bg-white shadow-[0_0_0_4px_rgba(79,140,255,0.15)] transition-transform outline-none hover:scale-110 focus-visible:ring-4 focus-visible:ring-accent/40"
      />
    </SliderPrimitive.Root>
  );
}
