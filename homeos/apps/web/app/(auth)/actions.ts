"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HouseholdNameSchema, friendlyDbError } from "@homeos/database";
import { createSupabaseServer } from "@/lib/supabase/server";
import { HOUSEHOLD_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/supabase/config";
import { rateLimit } from "@/lib/server/authz";
import { safeNext } from "@/lib/safe-redirect";
import { getSession } from "@/lib/session";

export type FormState = { error?: string; message?: string } | undefined;

const Email = z.email("Vul een geldig e-mailadres in").max(254);
const Password = z.string().min(10, "Wachtwoord moet minimaal 10 tekens hebben").max(128);

async function clientKey(prefix: string) {
  const h = await headers();
  return `${prefix}:${h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}

async function siteUrl(): Promise<string> {
  if (process.env.HOMEOS_SITE_URL) return process.env.HOMEOS_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(await clientKey("login"), 10)) return { error: "Te veel pogingen. Wacht een minuut." };
  const parsed = z.object({ email: Email, password: z.string().min(1, "Vul je wachtwoord in").max(128) }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Bewust algemene melding: verraadt niet of een account bestaat.
  if (error) return { error: error.code === "email_not_confirmed" ? "Bevestig eerst je e-mailadres via de link in je mailbox." : "Onjuist e-mailadres of wachtwoord." };
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(await clientKey("signup"), 5)) return { error: "Te veel pogingen. Wacht een minuut." };
  const parsed = z
    .object({ displayName: z.string().trim().min(1, "Vul je naam in").max(80), email: Email, password: Password })
    .safeParse({ displayName: form.get("displayName"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: parsed.data.displayName }, emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/welkom` },
  });
  if (error) {
    if (error.code === "weak_password") return { error: "Kies een sterker wachtwoord." };
    if (error.code === "over_email_send_rate_limit") return { error: "Te veel e-mails verstuurd. Probeer het later opnieuw." };
    return { error: "Registreren is niet gelukt. Probeer het opnieuw." };
  }
  if (data.session) redirect("/welkom");
  return { message: "Bijna klaar! Bevestig je account via de link in je e-mail." };
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(await clientKey("reset"), 3)) return { error: "Te veel pogingen. Wacht een minuut." };
  const parsed = Email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServer();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${await siteUrl()}/auth/confirm?next=/account` });
  return { message: "Als er een account bij dit adres hoort, ontvang je een e-mail met een herstellink." };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  (await cookies()).delete(HOUSEHOLD_COOKIE);
  redirect("/login");
}

export async function createHousehold(_: FormState, form: FormData): Promise<FormState> {
  const parsed = HouseholdNameSchema.safeParse(form.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("create_household", { p_name: parsed.data });
  if (error) return { error: friendlyDbError(error) };
  (await cookies()).set(HOUSEHOLD_COOKIE, String(data), { ...SESSION_COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function switchHousehold(householdId: string): Promise<void> {
  const s = await getSession();
  if (!s.households.some((h) => h.id === householdId)) return;
  (await cookies()).set(HOUSEHOLD_COOKIE, householdId, { ...SESSION_COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}
