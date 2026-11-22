"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@homeos/ui";

type Tone = "success" | "danger" | "accent";
interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}
interface ToastApi {
  push(t: Omit<Toast, "id" | "tone"> & { tone?: Tone }): void;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<ToastApi["push"]>(
    (t) => {
      const id = nextId++;
      setToasts((cur) => [...cur.slice(-3), { tone: "accent", ...t, id }]);
      setTimeout(() => dismiss(id), 5_000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "danger" ? TriangleAlert : Info;
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-2xl border border-white/10 bg-navy-850/95 p-4 shadow-2xl backdrop-blur-xl"
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", t.tone === "success" && "text-success", t.tone === "danger" && "text-danger", t.tone === "accent" && "text-accent")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-muted">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Sluiten">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast buiten ToastProvider");
  return v;
}
