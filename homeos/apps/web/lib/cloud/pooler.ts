/** Andere Supabase-pooler (aws-0 ↔ aws-1) voor dezelfde regio; null als het geen Supabase-pooler is. */
export function alternatePoolerUrl(url: string): string | null {
  const u = new URL(url);
  const m = /^aws-(\d)-(.+\.pooler\.supabase\.com)$/.exec(u.hostname);
  if (!m) return null;
  u.hostname = `aws-${m[1] === "0" ? "1" : "0"}-${m[2]}`;
  return u.toString();
}
