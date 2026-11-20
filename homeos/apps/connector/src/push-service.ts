import webpush from "web-push";
import { z } from "zod";
import type { Logger } from "@homeos/integrations";
import type { HomeNotification } from "@homeos/automation";
import type { SecretStore } from "./secret-store";
import { SetupError } from "./cloud-service";

/**
 * Web Push (VAPID) vanaf de connector. Meldingen gaan van de laptop rechtstreeks naar de pushdienst van Apple/Google/
 * Mozilla; er is geen eigen cloud tussen. Sleutels en abonnementen staan versleuteld in de SecretStore.
 * Alleen bekende pushdiensten zijn toegestaan als adres (geen verzoeken naar willekeurige servers).
 */

const PUSH_HOST_SUFFIXES = ["push.apple.com", "fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];
const MAX_SUBSCRIPTIONS = 20;

export const PushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .refine((u) => {
      try {
        const url = new URL(u);
        return url.protocol === "https:" && PUSH_HOST_SUFFIXES.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
      } catch {
        return false;
      }
    }, "Onbekende pushdienst"),
  keys: z.object({ p256dh: z.string().min(20).max(200).regex(/^[\w-]+=*$/), auth: z.string().min(8).max(100).regex(/^[\w-]+=*$/) }),
});
type Sub = z.infer<typeof PushSubscriptionSchema> & { label: string; createdAt: string };

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: { vapid: { subject: string; publicKey: string; privateKey: string }; urgency: "normal" | "high" }) => Promise<{ statusCode: number }>;

export const webPushSender: PushSender = (sub, payload, opts) =>
  webpush.sendNotification(sub, payload, { vapidDetails: opts.vapid, TTL: 3600, urgency: opts.urgency, timeout: 10_000 }).then((r) => ({ statusCode: r.statusCode }));

const URL_FOR: Record<string, string> = { security: "/beveiliging", energy: "/energie", automation: "/automatiseringen", maintenance: "/onderhoud", connection: "/apparaten" };

export function createPushService(o: { secrets: SecretStore; logger: Logger; sender?: PushSender; subject?: string }) {
  const scope = o.secrets.scoped("push");
  const sender = o.sender ?? webPushSender;
  const subject = o.subject ?? process.env.HOMEOS_PUSH_SUBJECT ?? "mailto:homeos-push@example.com";
  let cache: Sub[] | null = null;

  const keys = async () => {
    let pub = await scope.get("vapidPublic");
    let priv = await scope.get("vapidPrivate");
    if (!pub || !priv) {
      const k = webpush.generateVAPIDKeys();
      pub = k.publicKey;
      priv = k.privateKey;
      await scope.set("vapidPublic", pub);
      await scope.set("vapidPrivate", priv);
    }
    return { publicKey: pub, privateKey: priv };
  };
  const load = async (): Promise<Sub[]> => {
    if (cache) return cache;
    try {
      cache = JSON.parse((await scope.get("subscriptions")) ?? "[]") as Sub[];
    } catch {
      cache = [];
    }
    return cache;
  };
  const save = async (subs: Sub[]) => {
    cache = subs;
    await scope.set("subscriptions", JSON.stringify(subs));
  };

  const sendTo = async (subs: Sub[], payload: object, urgency: "normal" | "high") => {
    const k = await keys();
    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await sender({ endpoint: s.endpoint, keys: s.keys }, body, { vapid: { subject, ...k }, urgency });
          delivered++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint); // abonnement bestaat niet meer
          else o.logger.warn("Pushmelding versturen mislukt", { status: code ?? null, host: new URL(s.endpoint).hostname });
        }
      }),
    );
    if (gone.length) await save((await load()).filter((s) => !gone.includes(s.endpoint)));
    return { delivered, removed: gone.length };
  };

  return {
    async info() {
      return { publicKey: (await keys()).publicKey, subscriptions: (await load()).length };
    },

    async subscribe(input: unknown, label: string) {
      const p = PushSubscriptionSchema.safeParse(input);
      if (!p.success) throw new SetupError(400, "INVALID", p.error.issues[0]?.message ?? "Ongeldig abonnement");
      const subs = (await load()).filter((s) => s.endpoint !== p.data.endpoint);
      if (subs.length >= MAX_SUBSCRIPTIONS) throw new SetupError(409, "TOO_MANY", `Maximaal ${MAX_SUBSCRIPTIONS} apparaten met pushmeldingen`);
      subs.push({ ...p.data, label: label.slice(0, 80), createdAt: new Date().toISOString() });
      await save(subs);
      return { ok: true, subscriptions: subs.length };
    },

    async unsubscribe(endpoint: string) {
      const subs = await load();
      await save(subs.filter((s) => s.endpoint !== endpoint));
      return { ok: true };
    },

    async test(endpoint: string | null) {
      const subs = (await load()).filter((s) => !endpoint || s.endpoint === endpoint);
      if (!subs.length) throw new SetupError(404, "NOT_FOUND", "Dit apparaat heeft geen pushmeldingen aangezet");
      return sendTo(subs, { title: "HomeOS", body: "Pushmeldingen werken op dit apparaat.", url: "/", tag: "test" }, "normal");
    },

    /** Een melding uit HomeOS naar alle apparaten met pushmeldingen. */
    async notify(n: HomeNotification) {
      const subs = await load();
      if (!subs.length) return { delivered: 0, removed: 0 };
      return sendTo(subs, { title: n.title, body: n.body, url: URL_FOR[n.category] ?? "/", tag: n.category }, n.category === "security" ? "high" : "normal");
    },
  };
}

export type PushService = ReturnType<typeof createPushService>;
