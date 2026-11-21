/**
 * Opslag met één leesronde per aanvraag: alle documenten van het huishouden in één query, daarna uit het geheugen.
 * Schrijven alleen als de inhoud echt veranderd is (de connector slaat bij iedere aanvraag zijn status op).
 * Puur (zonder database-afhankelijkheid), zodat het los te testen is.
 */
export interface DocBackend {
  loadAll(): Promise<{ key: string; data: string }[]>;
  write(key: string, data: string): Promise<void>;
}

export function cachedDocs(backend: DocBackend) {
  let cache: Promise<Map<string, string>> | null = null;
  const docs = () => (cache ??= backend.loadAll().then((rows) => new Map(rows.map((r) => [r.key, r.data]))));
  return {
    async read(key: string): Promise<string | null> {
      return (await docs()).get(key) ?? null;
    },
    async write(key: string, data: string): Promise<void> {
      const m = await docs();
      if (m.get(key) === data) return;
      await backend.write(key, data);
      m.set(key, data);
    },
  };
}
