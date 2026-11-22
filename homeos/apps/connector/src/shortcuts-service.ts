import { createHash } from "node:crypto";
import type { IntegrationsStore } from "./integrations-store";
import { SetupError } from "./cloud-service";

/** Letters, cijfers, spaties en gewone leestekens; geen stuurtekens (de naam komt in een shortcuts://-link). */
const TEXT = /^[^\p{Cc}\p{Cf}<>]{1,}$/u;

/**
 * Knoppen voor Apple-opdrachten (Shortcuts-app). HomeOS slaat alleen een label en de naam van de opdracht op; de knop
 * opent `shortcuts://run-shortcut?name=…` op het apparaat van de gebruiker. Apple voert de opdracht uit (bijv. Apple
 * Woning: tv aan). HomeOS kan de uitkomst niet zien en stuurt zelf niets naar Apple.
 */
export function createShortcutsService(o: { store: IntegrationsStore }) {
  return {
    list() {
      return o.store.state.shortcuts;
    },
    async save(items: { label: string; shortcut: string }[]) {
      const clean = items.map((i) => ({ label: i.label.trim().replace(/\s+/g, " "), shortcut: i.shortcut.trim().replace(/\s+/g, " ") })).filter((i) => i.label || i.shortcut);
      for (const i of clean) {
        if (!i.label || i.label.length > 40 || !TEXT.test(i.label)) throw new SetupError(400, "INVALID", `Ongeldige knopnaam: "${i.label.slice(0, 40)}" (max. 40 tekens)`);
        if (!i.shortcut || i.shortcut.length > 100 || !TEXT.test(i.shortcut)) throw new SetupError(400, "INVALID", `Ongeldige opdrachtnaam bij "${i.label}" (max. 100 tekens)`);
      }
      o.store.state.shortcuts = clean.map((i, n) => ({ id: createHash("sha256").update(`${n}:${i.label}:${i.shortcut}`).digest("hex").slice(0, 12), ...i }));
      await o.store.save();
      return { ok: true, shortcuts: o.store.state.shortcuts };
    },
  };
}

export type ShortcutsService = ReturnType<typeof createShortcutsService>;
