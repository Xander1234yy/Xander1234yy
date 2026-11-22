"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@homeos/ui";
import { PcmPlayer, TsAudioDemuxer, decodeG711, type G711 } from "@/lib/g711-audio";

type Tap = { onChunk: ((c: Uint8Array) => void) | null; onAudio: ((codec: G711, rate: number) => void) | null };

/**
 * Speelt het live MPEG-TS-beeld (H.264) van de TP-Link-cloud af met mpegts.js (Media Source Extensions; op iPhone/iPad
 * via ManagedMediaSource, iOS 17.1+). De stroom wordt één keer opgehaald (eigen loader): video naar mpegts.js, het
 * G.711-geluid naar een eigen decoder (Web Audio) — standaard uit, aan met de knop (iPhone vereist een tik).
 */
export function CloudLiveVideo({ src, label, onError }: { src: string; label: string; onError: (message: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tap = useRef<Tap>({ onChunk: null, onAudio: null });
  const [audio, setAudio] = useState<{ codec: G711; rate: number } | null>(null);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const t = tap.current;
    let destroyed = false;
    let player: { destroy(): void; unload(): void; detachMediaElement(): void } | null = null;
    void import("mpegts.js").then(({ default: mpegts }) => {
      if (destroyed || !ref.current) return;
      if (!mpegts.isSupported()) {
        onError("Deze browser kan het live beeld niet afspelen (op iPhone/iPad is iOS 17.1 of nieuwer nodig).");
        return;
      }
      const Base = mpegts.BaseLoader as unknown as new (name: string) => {
        _status: number;
        _needStash: boolean;
        _onDataArrival: ((chunk: ArrayBuffer, byteStart: number, received: number) => void) | null;
        _onComplete: ((from: number, to: number) => void) | null;
        _onError: ((type: string, info: { code: number; msg: string }) => void) | null;
      };
      class TapLoader extends Base {
        private ctl: AbortController | null = null;
        private received = 0;
        constructor() {
          super("homeos-tap-loader");
          this._needStash = true;
        }
        open(ds: { url: string }) {
          this._status = 1;
          this.ctl = new AbortController();
          void fetch(ds.url, { signal: this.ctl.signal, cache: "no-store", credentials: "same-origin" })
            .then(async (res) => {
              if (!res.ok || !res.body) {
                let msg = `HTTP ${res.status}`;
                try {
                  msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
                } catch {
                  /* geen JSON */
                }
                this._status = 3;
                this._onError?.("HttpStatusCodeInvalid", { code: res.status, msg });
                return;
              }
              const codec = res.headers.get("x-audio-codec");
              const rate = Number(res.headers.get("x-audio-rate") ?? 8000);
              if (codec === "alaw" || codec === "mulaw") t.onAudio?.(codec, rate || 8000);
              this._status = 2;
              const reader = res.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                const start = this.received;
                this.received += value.byteLength;
                t.onChunk?.(value);
                this._onDataArrival?.(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer, start, this.received);
              }
              this._status = 4;
              this._onComplete?.(0, this.received - 1);
            })
            .catch((e: Error) => {
              if (e.name === "AbortError") return;
              this._status = 3;
              this._onError?.("Exception", { code: -1, msg: e.message });
            });
        }
        abort() {
          this.ctl?.abort();
          this._status = 4;
        }
      }
      const p = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: src, hasAudio: false },
        { enableWorker: false, enableWorkerForMSE: false, liveBufferLatencyChasing: true, lazyLoad: false, autoCleanupSourceBuffer: true, customLoader: TapLoader as never },
      );
      t.onAudio = (codec, rate) => !destroyed && setAudio({ codec, rate });
      p.on(mpegts.Events.ERROR, (_type: string, _detail: string, info?: { msg?: string }) => onError(info?.msg && !/^HTTP/.test(info.msg) ? info.msg : "Live beeld gestopt of niet beschikbaar."));
      p.attachMediaElement(ref.current);
      p.load();
      void Promise.resolve(p.play()).catch(() => undefined);
      player = p;
    });
    return () => {
      destroyed = true;
      t.onChunk = null;
      t.onAudio = null;
      if (player) {
        player.unload();
        player.detachMediaElement();
        player.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen opnieuw bij een andere bron
  }, [src]);

  // Geluid: alleen als de gebruiker het aanzet (en de camera G.711 meldt).
  useEffect(() => {
    if (!sound || !audio) return;
    const t = tap.current;
    const ctx = new AudioContext();
    void ctx.resume();
    const out = new PcmPlayer(ctx, audio.rate);
    const demux = new TsAudioDemuxer((payload) => out.play(decodeG711(payload, audio.codec)));
    t.onChunk = (c) => demux.push(c);
    return () => {
      t.onChunk = null;
      void ctx.close();
    };
  }, [sound, audio]);

  return (
    <div className="relative h-full w-full">
      <video ref={ref} className="h-full w-full object-contain" muted playsInline autoPlay aria-label={label} />
      {audio && (
        <Button size="sm" variant="secondary" className="absolute bottom-3 right-3" onClick={() => setSound((s) => !s)} aria-pressed={sound} aria-label={sound ? "Geluid uit" : "Geluid aan"}>
          {sound ? <Volume2 /> : <VolumeX />} {sound ? "Geluid aan" : "Geluid uit"}
        </Button>
      )}
    </div>
  );
}
