"use client";

import { Lightbulb } from "lucide-react";
import { SectionCard } from "@/components/section";

/** Tijdelijk: Hue via de Hue-cloud volgt (officiële Remote API). */
export function HueCloudCard() {
  return (
    <SectionCard title="Philips Hue (cloud)" description="Officiële Hue Remote API" icon={Lightbulb} testId="hue-cloud-card">
      <p className="text-sm text-muted">Wordt gebouwd.</p>
    </SectionCard>
  );
}
