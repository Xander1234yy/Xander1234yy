"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

type Result = { ok: true } | { ok: false; error: string };

/** Roept een server action aan, toont fouten en ververst de pagina. */
export function useServerAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, success?: string) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.push({ title: "Niet gelukt", description: r.error, tone: "danger" });
          resolve(false);
          return;
        }
        if (success) toast.push({ title: success, tone: "success" });
        router.refresh();
        resolve(true);
      }),
    );
  return { pending, run };
}
