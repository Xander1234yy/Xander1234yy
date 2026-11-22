export type ShortcutButton = { id: string; label: string; shortcut: string };

/** Officiële Apple-link om een opdracht uit de Opdrachten-app (Shortcuts) te starten. */
export function shortcutUrl(name: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}
