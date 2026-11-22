import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig, SESSION_COOKIE_OPTIONS } from "./config";

/** Supabase-client voor Server Components, Server Actions en Route Handlers (sessie van de gebruiker, RLS actief). */
export async function createSupabaseServer() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is niet geconfigureerd");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
        } catch {
          // In Server Components kunnen geen cookies gezet worden; proxy.ts ververst de sessie.
        }
      },
    },
  });
}
