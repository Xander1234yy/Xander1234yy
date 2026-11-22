"use client";

import { useEffect, useState } from "react";
import { Cpu, Settings2 } from "lucide-react";
import { Badge, Button, Switch } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { api } from "@/lib/api";
import { HISTORY_EVENT, clearLocalHistory, dutchVoices, speakText, useJarvisSettings } from "@/lib/jarvis/settings";

/** Jarvis-instellingen: voorlezen, stem, spreeksnelheid, geschiedenis en de (lokale) provider. */
export function JarvisSettingsCard({ mode }: { mode: "cloud" | "local" | null }) {
  const { settings, update } = useJarvisSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cleared, setCleared] = useState<string | null>(null);
  const [ttsSupported, setTtsSupported] = useState(true);

  useEffect(() => {
    if (typeof speechSynthesis === "undefined") {
      setTtsSupported(false);
      return;
    }
    const load = () => setVoices(dutchVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const clearHistory = async () => {
    try {
      clearLocalHistory();
      if (mode === "cloud") await api("/api/jarvis", { method: "DELETE" });
      setCleared("Gespreksgeschiedenis gewist.");
      window.dispatchEvent(new Event(HISTORY_EVENT));
    } catch (e) {
      setCleared(`Wissen mislukt: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <SectionCard title="Jarvis-instellingen" icon={Settings2}>
        <div className="space-y-4 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span>
              Antwoorden voorlezen
              {!ttsSupported && <span className="block text-xs text-muted">Niet beschikbaar in deze browser.</span>}
            </span>
            <Switch checked={settings.speak} disabled={!ttsSupported} onCheckedChange={(speak) => update({ speak })} aria-label="Antwoorden voorlezen" />
          </label>
          {ttsSupported && (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Stem</span>
                <select
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm"
                  value={settings.voiceURI ?? ""}
                  onChange={(e) => update({ voiceURI: e.target.value || null })}
                  aria-label="Stem"
                >
                  <option value="">Standaard Nederlandse stem</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang}){v.localService ? "" : " · online"}
                    </option>
                  ))}
                </select>
                {voices.length === 0 && <span className="text-xs text-muted">Geen Nederlandse stem gevonden op dit apparaat; de browser kiest zelf.</span>}
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Spreeksnelheid: {settings.rate.toFixed(1)}×</span>
                <input type="range" min={0.5} max={2} step={0.1} value={settings.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" aria-label="Spreeksnelheid" />
              </label>
              <Button size="sm" variant="secondary" onClick={() => speakText("Hallo, ik ben Jarvis. Zo klink ik.", settings)}>
                Stem testen
              </Button>
            </>
          )}
          <div className="border-t border-white/[0.06] pt-4">
            {mode === "cloud" ? (
              <p className="text-xs text-muted">Je gesprekken worden bewaard in je HomeOS-account. Alleen jij kunt ze zien.</p>
            ) : (
              <label className="flex items-center justify-between gap-3">
                <span>
                  Gesprek bewaren in deze browser
                  <span className="block text-xs text-muted">Alleen op dit apparaat, zonder account.</span>
                </span>
                <Switch
                  checked={settings.keepHistory}
                  onCheckedChange={(keepHistory) => {
                    update({ keepHistory });
                    if (!keepHistory) clearLocalHistory();
                  }}
                  aria-label="Gesprek bewaren"
                />
              </label>
            )}
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => void clearHistory()}>
              Gespreksgeschiedenis wissen
            </Button>
            {cleared && <p className="mt-1 text-xs text-muted" role="status">{cleared}</p>}
          </div>
        </div>
      </SectionCard>
      <SectionCard title="AI-configuratie" icon={Cpu}>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Lokale Jarvis</span>
            <Badge tone="success">Actief</Badge>
          </div>
          <p className="text-xs text-muted">
            Draait volledig binnen HomeOS: geen internet, geen AI-dienst, geen kosten. Je vragen verlaten je eigen omgeving niet. Spraakherkenning gebruikt
            de functie van je browser; sommige browsers (zoals Chrome) sturen spraak daarvoor naar hun eigen dienst.
          </p>
          <div className="flex items-center justify-between opacity-60">
            <span>Externe AI-provider</span>
            <Badge>Niet ingesteld</Badge>
          </div>
          <p className="text-xs text-muted">
            Er is bewust geen betaalde AI-dienst gekoppeld. De aansluiting hiervoor bestaat al; een provider zou dezelfde regels volgen: alleen voorstellen, jij bevestigt.
          </p>
        </div>
      </SectionCard>
    </>
  );
}
