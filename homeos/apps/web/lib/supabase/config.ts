/**
 * Supabase-configuratie (alleen server-side). De webapp praat uitsluitend server-side met Supabase,
 * zodat sessiecookies httpOnly kunnen zijn en er geen tokens in de browser terechtkomen.
 */
export interface SupabaseConfig {
  url: string;
  key: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

/** "cloud" = Supabase-accounts actief. "local" = fase 1-modus zonder accounts (alleen 127.0.0.1). */
export function authMode(): "cloud" | "local" {
  return getSupabaseConfig() ? "cloud" : "local";
}

/** In productie mag de lokale modus alleen expliciet aan. */
export function localModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.HOMEOS_ALLOW_LOCAL_MODE === "true";
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const HOUSEHOLD_COOKIE = "homeos_household";
