import "server-only";
import type { JarvisAction } from "@homeos/jarvis";
import type { AuthzContext } from "@/lib/server/authz";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Gespreksgeschiedenis in Supabase (alleen cloudmodus). RLS: iedere gebruiker ziet alleen zijn eigen gesprekken. */
export interface StoredMessage {
  role: "user" | "jarvis";
  text: string;
  actions: JarvisAction[];
  at: string;
}

const MAX_MESSAGES = 100;

export async function loadLatestConversation(ctx: AuthzContext): Promise<{ conversationId: string | null; messages: StoredMessage[] }> {
  if (ctx.mode !== "cloud" || !ctx.householdId) return { conversationId: null, messages: [] };
  const supabase = await createSupabaseServer();
  const { data: conv } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("household_id", ctx.householdId)
    .eq("user_id", ctx.userId!)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return { conversationId: null, messages: [] };
  const { data } = await supabase
    .from("ai_messages")
    .select("role, content, actions, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  const messages = (data ?? []).reverse().map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("jarvis" as const),
    text: m.content,
    actions: Array.isArray(m.actions) ? (m.actions as unknown as JarvisAction[]) : [],
    at: m.created_at,
  }));
  return { conversationId: conv.id, messages };
}

/** Bewaart een vraag en antwoord. Maakt een gesprek aan als er nog geen (geldig) gesprek is. Fouten zijn niet fataal. */
export async function appendExchange(
  ctx: AuthzContext,
  conversationId: string | null,
  question: string,
  answer: { text: string; actions: JarvisAction[]; provider: string },
): Promise<string | null> {
  if (ctx.mode !== "cloud" || !ctx.householdId) return null;
  try {
    const supabase = await createSupabaseServer();
    let id = conversationId;
    if (id) {
      // RLS laat alleen eigen gesprekken zien; een onbekend id levert niets op en dan beginnen we een nieuw gesprek.
      const { data } = await supabase.from("ai_conversations").update({ title: question.slice(0, 120) }).eq("id", id).select("id").maybeSingle();
      if (!data) id = null;
    }
    if (!id) {
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({ household_id: ctx.householdId, title: question.slice(0, 120) })
        .select("id")
        .single();
      if (error || !data) return null;
      id = data.id;
    }
    // Bij een bulk-insert vult PostgREST ontbrekende kolommen met NULL (niet de default), dus alle kolommen expliciet.
    const { error } = await supabase.from("ai_messages").insert([
      { conversation_id: id, household_id: ctx.householdId, role: "user", content: question, actions: [], provider: answer.provider },
      { conversation_id: id, household_id: ctx.householdId, role: "assistant", content: answer.text.slice(0, 8000), actions: answer.actions as never, provider: answer.provider },
    ]);
    if (error) console.error("[jarvis] gesprek opslaan mislukt:", error.message);
    return id;
  } catch {
    return conversationId;
  }
}

export async function clearConversations(ctx: AuthzContext): Promise<boolean> {
  if (ctx.mode !== "cloud" || !ctx.householdId) return true;
  const supabase = await createSupabaseServer();
  const { error } = await supabase.from("ai_conversations").delete().eq("household_id", ctx.householdId).eq("user_id", ctx.userId!);
  return !error;
}
