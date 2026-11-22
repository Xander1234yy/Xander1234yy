import WebSocket from "ws";
import { connectorWsUrl, getConnectorToken } from "@/lib/server/connector-client";
import { assertConnectorLinked, authorize } from "@/lib/server/authz";
import { syncRoomsToConnector } from "@/lib/server/rooms-sync";
import { mirrorEvent, mirrorNotification, mirrorRun, mirrorSnapshot } from "@/lib/server/registry-mirror";
import { connectorFetch } from "@/lib/server/connector-client";
import { cloudRuntimeEnabled } from "@/lib/cloud/runtime";
import { can, type DeviceEvent, type Snapshot } from "@homeos/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: relayt realtime snapshots en gebeurtenissen van de connector-WebSocket
 * naar de browser. De browser praat nooit rechtstreeks met de connector.
 */
export async function GET(req: Request) {
  const auth = await authorize("view");
  if (!auth.ok) return auth.response;
  const notLinked = await assertConnectorLinked(auth.ctx);
  if (notLinked) {
    // Stuur de reden als SSE-gebeurtenis zodat de UI het kan tonen (en geen eindeloze reconnect-lus).
    const reason = ((await notLinked.json()) as { error: { code: string } }).error.code.toLowerCase();
    return new Response(`retry: 30000\n\nevent: connector\ndata: ${JSON.stringify({ online: false, reason })}\n\n`, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (auth.ctx.mode === "cloud") await syncRoomsToConnector(auth.ctx.householdId!);
  if (cloudRuntimeEnabled()) {
    // Cloudmodus: geen blijvende verbinding (serverless). Eén momentopname, daarna vraagt de browser na 15 s opnieuw.
    let body = "retry: 15000\n\n";
    try {
      const res = await connectorFetch("/v1/snapshot");
      body += `event: connector\ndata: ${JSON.stringify({ online: res.ok })}\n\n`;
      if (res.ok) body += `event: snapshot\ndata: ${await res.text()}\n\n`;
    } catch {
      body += `event: connector\ndata: ${JSON.stringify({ online: false, reason: "unreachable" })}\n\n`;
    }
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  }
  const token = await getConnectorToken();
  // Beheerders spiegelen de registry naar Supabase (RLS staat schrijven alleen voor beheerders toe).
  const mirrorTo = auth.ctx.mode === "cloud" && can(auth.ctx.role, "manage_devices") ? auth.ctx.householdId : null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        ws?.terminate();
        try {
          controller.close();
        } catch {
          /* al gesloten */
        }
      };

      controller.enqueue(encoder.encode("retry: 4000\n\n"));
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      let ws: WebSocket | null = null;
      if (!token) {
        send("connector", { online: false, reason: "no_token" });
        setTimeout(close, 50);
      } else {
        ws = new WebSocket(connectorWsUrl(), { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 5_000 });
        ws.on("open", () => send("connector", { online: true }));
        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(String(raw)) as { type: string; data: unknown };
            if (msg.type === "snapshot" || msg.type === "event" || msg.type === "notification" || msg.type === "automation_run") send(msg.type, msg.data);
            if (mirrorTo && msg.type === "notification") void mirrorNotification(mirrorTo, msg.data as { category: string; title: string; body: string });
            if (mirrorTo && msg.type === "automation_run") {
              const run = msg.data as Parameters<typeof mirrorRun>[1];
              void connectorFetch("/v1/automations")
                .then((r) => r.json() as Promise<{ automations: { id: string; name: string; enabled: boolean }[] }>)
                .then((l) => mirrorRun(mirrorTo, run, l.automations.find((a) => a.id === run.automationId)))
                .catch(() => mirrorRun(mirrorTo, run));
            }
            if (mirrorTo && msg.type === "snapshot") void mirrorSnapshot(mirrorTo, msg.data as Snapshot);
            if (mirrorTo && msg.type === "event") void mirrorEvent(mirrorTo, msg.data as DeviceEvent);
          } catch {
            /* ongeldig bericht negeren */
          }
        });
        const down = (reason: string) => {
          send("connector", { online: false, reason });
          setTimeout(close, 50);
        };
        ws.on("error", () => down("unreachable"));
        ws.on("close", () => down("closed"));
      }
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
