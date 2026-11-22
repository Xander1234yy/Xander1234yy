"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Mic, MicOff, RotateCcw, Send, Volume2, VolumeX, X } from "lucide-react";
import { Button, Input, cn } from "@homeos/ui";
import { api, connectorPath } from "@/lib/api";
import { addShoppingItem, addTask } from "@/lib/actions/family";
import { useHome } from "@/lib/home-context";
import type { JarvisAction, JarvisMemory, JarvisReply } from "@homeos/jarvis";
import { HISTORY_EVENT, clearLocalHistory, loadLocalHistory, saveLocalHistory, speakText, useJarvisSettings } from "@/lib/jarvis/settings";

interface Msg {
  id: number;
  role: "user" | "jarvis";
  text: string;
  actions?: JarvisAction[];
  /** "expired": voorstel uit een eerder gesprek; uit veiligheid niet meer te bevestigen. */
  state?: "proposed" | "confirmed" | "cancelled" | "failed" | "expired";
}

interface HistoryResponse {
  mode: "cloud" | "local";
  conversationId: string | null;
  messages: { role: "user" | "jarvis"; text: string; actions: JarvisAction[] }[];
}

const expire = (m: Msg): Msg => (m.state === "proposed" ? { ...m, state: "expired" } : m);

type Recognition = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

let msgId = 1;
const SUGGESTIONS = ["Welke lampen staan nog aan?", "Wat is de huidige opbrengst van onze zonnepanelen?", "Weekoverzicht energie", "Zijn er apparaten offline?"];

export function JarvisChat({ compact = false }: { compact?: boolean }) {
  const { snapshot, sendCommand, activateScene } = useHome();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const { settings, update } = useJarvisSettings();
  const [speechSupported, setSpeechSupported] = useState(false);
  const [mode, setMode] = useState<"cloud" | "local" | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const busyRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<JarvisMemory | null>(null);
  const conversationRef = useRef<string | null>(null);

  // Geschiedenis laden: cloudmodus uit Supabase (eigen gesprekken, RLS), lokale modus uit deze browser.
  const loadHistory = useCallback(() => {
    api<HistoryResponse>("/api/jarvis")
      .then((h) => {
        setMode(h.mode);
        const restored: Msg[] =
          h.mode === "cloud"
            ? h.messages.map((m) => ({ id: msgId++, role: m.role, text: m.text, ...(m.actions.length ? { actions: m.actions, state: "expired" as const } : {}) }))
            : loadLocalHistory<Msg>().map((m) => expire({ ...m, id: msgId++ }));
        conversationRef.current = h.conversationId;
        setMessages(restored);
      })
      .catch(() => setMode("local"));
  }, []);
  useEffect(() => {
    loadHistory();
    window.addEventListener(HISTORY_EVENT, loadHistory);
    return () => window.removeEventListener(HISTORY_EVENT, loadHistory);
  }, [loadHistory]);
  useEffect(() => {
    if (mode === "local" && settings.keepHistory) saveLocalHistory(messages.map(expire));
  }, [messages, mode, settings.keepHistory]);

  const newConversation = () => {
    setMessages([]);
    memoryRef.current = null;
    conversationRef.current = null;
    if (mode === "local") clearLocalHistory();
  };

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSpeechSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const say = (text: string) => {
    if (settings.speak) speakText(text, settings);
  };

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || busyRef.current) return;
    busyRef.current = true;
    setInput("");
    setMessages((m) => [...m, { id: msgId++, role: "user", text: t }]);
    setBusy(true);
    try {
      const r = await api<JarvisReply & { conversationId: string | null }>("/api/jarvis", {
        method: "POST",
        body: JSON.stringify({ message: t, memory: memoryRef.current, conversationId: conversationRef.current }),
      });
      if (r.memory) memoryRef.current = r.memory;
      conversationRef.current = r.conversationId;
      setMessages((m) => [...m, { id: msgId++, role: "jarvis", text: r.text, actions: r.actions, ...(r.actions.length ? { state: "proposed" as const } : {}) }]);
      say(r.text);
    } catch (e) {
      setMessages((m) => [...m, { id: msgId++, role: "jarvis", text: `Ik kan nu niet antwoorden: ${(e as Error).message}` }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirm = async (msg: Msg) => {
    let ok = true;
    for (const a of msg.actions ?? []) {
      if (a.kind === "scene") ok = (await activateScene(a.sceneId, "jarvis")) && ok;
      else if (a.kind === "shopping_add") ok = (await addShoppingItem({ name: a.name })).ok && ok;
      else if (a.kind === "task_add") ok = (await addTask({ title: a.title })).ok && ok;
      else if (a.kind === "automation_run" || a.kind === "automation_toggle") {
        try {
          const path = `v1/automations/${encodeURIComponent(a.automationId)}`;
          if (a.kind === "automation_run") await api(connectorPath(`${path}/run`), { method: "POST" });
          else await api(connectorPath(path), { method: "PATCH", body: JSON.stringify({ enabled: a.enabled }) });
        } catch {
          ok = false;
        }
      }
      else if (a.kind === "create_automation") {
        try {
          const t = await api<Record<string, unknown>>(connectorPath("v1/automations/templates"));
          await api(connectorPath("v1/automations"), { method: "POST", body: JSON.stringify(t[a.template]) });
        } catch {
          ok = false;
        }
      }
      else {
        const device = snapshot?.devices.find((d) => d.id === a.deviceId);
        ok = (device ? await sendCommand(device, a.command, "jarvis") : false) && ok;
      }
    }
    setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, state: ok ? "confirmed" : "failed" } : x)));
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "nl-NL";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) void ask(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex-1 space-y-3 overflow-y-auto", compact ? "max-h-64 min-h-32" : "min-h-[50dvh]")} data-testid="jarvis-messages">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Stel een vraag of geef een opdracht. Ik vraag altijd om bevestiging voordat er iets gebeurt.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.slice(0, compact ? 2 : 4).map((s) => (
                <button key={s} onClick={() => void ask(s)} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-left text-xs text-muted transition hover:border-accent/40 hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-2", m.role === "user" && "justify-end")}>
            {m.role === "jarvis" && (
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Bot className="size-4" />
              </div>
            )}
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-accent text-white" : "border border-white/[0.06] bg-white/[0.04] text-fg")}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.actions && m.actions.length > 0 && (
                <div className="mt-2 space-y-2">
                  <ul className="space-y-1 text-xs text-muted">
                    {m.actions.map((a, i) => (
                      <li key={i}>• {a.label}</li>
                    ))}
                  </ul>
                  {m.state === "proposed" ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => void confirm(m)}>
                        <Check /> Bevestigen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, state: "cancelled" } : x)))}>
                        <X /> Annuleren
                      </Button>
                    </div>
                  ) : (
                    <p className={cn("text-xs", m.state === "confirmed" ? "text-success" : m.state === "failed" ? "text-danger" : "text-muted")}>
                      {m.state === "confirmed" ? "Uitgevoerd" : m.state === "failed" ? "Niet (volledig) uitgevoerd" : m.state === "expired" ? "Verlopen voorstel (vraag het opnieuw)" : "Geannuleerd"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="animate-pulse-soft pl-9 text-xs text-muted">Jarvis denkt na…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Vraag het Jarvis…" maxLength={500} aria-label="Bericht aan Jarvis" />
        {speechSupported && (
          <Button type="button" size="icon" variant={listening ? "danger" : "secondary"} onClick={toggleMic} aria-label={listening ? "Stoppen met luisteren" : "Spreek een opdracht in"}>
            {listening ? <MicOff /> : <Mic />}
          </Button>
        )}
        {!compact && (
          <Button type="button" size="icon" variant="secondary" onClick={() => update({ speak: !settings.speak })} aria-label={settings.speak ? "Voorlezen uit" : "Antwoorden voorlezen"} aria-pressed={settings.speak}>
            {settings.speak ? <Volume2 /> : <VolumeX />}
          </Button>
        )}
        {!compact && messages.length > 0 && (
          <Button type="button" size="icon" variant="secondary" onClick={newConversation} aria-label="Nieuw gesprek">
            <RotateCcw />
          </Button>
        )}
        <Button type="submit" size="icon" variant="primary" disabled={!input.trim() || busy} aria-label="Versturen">
          <Send />
        </Button>
      </form>
    </div>
  );
}
