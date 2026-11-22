"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Share, Smartphone } from "lucide-react";
import { Badge, Button } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";

type Support = "checking" | "ok" | "insecure" | "unsupported" | "ios-install";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const deviceLabel = () => (isIos() ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? "iPad" : "iPhone") : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : "Browser");

/** Pushmeldingen op dit apparaat en uitleg om HomeOS als app te installeren. */
export function PushCard() {
  const live = useLive();
  const allowed = useCan("control");
  const toast = useToast();
  const [support, setSupport] = useState<Support>("checking");
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  const refresh = useCallback(async () => {
    if (!window.isSecureContext) return setSupport("insecure");
    if (isIos() && !isStandalone()) return setSupport("ios-install");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setSupport("unsupported");
    setSupport("ok");
    setPermission(Notification.permission);
    const reg = await navigator.serviceWorker.getRegistration("/");
    setSub((await reg?.pushManager.getSubscription()) ?? null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Meldingen zijn niet toegestaan. Zet ze aan in de instellingen van je apparaat.");
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>(connectorPath("v1/push"));
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api(connectorPath("v1/push/subscriptions"), { method: "POST", body: JSON.stringify({ subscription: s.toJSON(), label: deviceLabel() }) });
      setSub(s);
      toast.push({ title: "Pushmeldingen aan", description: "Je krijgt meldingen van HomeOS op dit apparaat.", tone: "success" });
    } catch (e) {
      toast.push({ title: "Pushmeldingen aanzetten mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await api(connectorPath("v1/push/unsubscribe"), { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
      await sub.unsubscribe();
      setSub(null);
      toast.push({ title: "Pushmeldingen uit", tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!sub) return;
    try {
      await api(connectorPath("v1/push/test"), { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
      toast.push({ title: "Testmelding verstuurd", tone: "success" });
    } catch (e) {
      toast.push({ title: "Testmelding mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="App en pushmeldingen" description="HomeOS op je beginscherm, met meldingen" icon={BellRing} testId="push-card">
      {support === "ios-install" && (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Smartphone className="size-4" /> Installeer HomeOS eerst als app
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>
              Tik in Safari op <Share className="inline size-4" /> <strong>Deel</strong>.
            </li>
            <li>
              Kies <strong>Zet op beginscherm</strong> en tik op <strong>Voeg toe</strong>.
            </li>
            <li>Open HomeOS vanaf je beginscherm en kom hier terug om pushmeldingen aan te zetten.</li>
          </ol>
          <p className="text-xs text-muted">Apple staat pushmeldingen alleen toe voor geïnstalleerde web-apps (iOS/iPadOS 16.4 of nieuwer).</p>
        </div>
      )}
      {support === "insecure" && (
        <p className="text-sm text-muted">
          Pushmeldingen en installeren werken alleen via een beveiligde verbinding (https). Gebruik de veilige toegang via Tailscale (zie de handleiding
          &quot;Toegang vanaf je telefoon&quot;).
        </p>
      )}
      {support === "unsupported" && <p className="text-sm text-muted">Deze browser ondersteunt geen pushmeldingen.</p>}
      {support === "ok" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>Pushmeldingen op dit apparaat</span>
            <Badge tone={sub ? "success" : "neutral"}>{sub ? "aan" : "uit"}</Badge>
            {permission === "denied" && <Badge tone="danger">geblokkeerd</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {sub ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => void test()} disabled={!live}>
                  Testmelding
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void disable()} disabled={busy}>
                  Uitzetten
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void enable()} disabled={!live || busy || !allowed || permission === "denied"}>
                {busy ? "Bezig…" : "Pushmeldingen aanzetten"}
              </Button>
            )}
          </div>
          {!allowed && <p className="text-xs text-muted">Gasten kunnen geen pushmeldingen aanzetten.</p>}
          <p className="text-xs text-muted">
            Welke soorten meldingen je krijgt stel je hieronder in bij Meldingen. Meldingen gaan van je laptop rechtstreeks naar de pushdienst van Apple of
            Google; HomeOS gebruikt geen eigen cloud.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
