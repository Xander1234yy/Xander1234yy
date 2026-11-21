"use client";

import { useEffect, useRef } from "react";

/**
 * Speelt het live MPEG-TS-beeld (H.264) van de TP-Link-cloud af in de browser met mpegts.js (Media Source Extensions;
 * op iPhone/iPad via ManagedMediaSource, iOS 17.1+). Zonder geluid en zonder web worker (CSP: alleen eigen scripts).
 */
export function CloudLiveVideo({ src, label, onError }: { src: string; label: string; onError: (message: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let destroyed = false;
    let player: { destroy(): void; unload(): void; detachMediaElement(): void } | null = null;
    void import("mpegts.js").then(({ default: mpegts }) => {
      if (destroyed || !ref.current) return;
      if (!mpegts.isSupported()) {
        onError("Deze browser kan het live beeld niet afspelen (op iPhone/iPad is iOS 17.1 of nieuwer nodig).");
        return;
      }
      const p = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: src, hasAudio: false },
        { enableWorker: false, enableWorkerForMSE: false, liveBufferLatencyChasing: true, lazyLoad: false, autoCleanupSourceBuffer: true },
      );
      p.on(mpegts.Events.ERROR, () => onError("Live beeld gestopt of niet beschikbaar."));
      p.attachMediaElement(ref.current);
      p.load();
      void Promise.resolve(p.play()).catch(() => undefined);
      player = p;
    });
    return () => {
      destroyed = true;
      if (player) {
        player.unload();
        player.detachMediaElement();
        player.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen opnieuw bij een andere bron
  }, [src]);
  return <video ref={ref} className="h-full w-full object-contain" muted playsInline autoPlay aria-label={label} />;
}
