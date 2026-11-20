import WebSocket from "ws";
import { connectorWsUrl, getConnectorToken } from "@/lib/server/connector-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: relayt realtime snapshots en gebeurtenissen van de connector-WebSocket
 * naar de browser. De browser praat nooit rechtstreeks met de connector.
 */
export async function GET(req: Request) {
  const token = await getConnectorToken();
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
            if (msg.type === "snapshot" || msg.type === "event") send(msg.type, msg.data);
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
