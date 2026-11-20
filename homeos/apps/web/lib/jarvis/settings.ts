"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Jarvis-voorkeuren van deze browser. Bevat geen geheimen, alleen weergave-instellingen.
 * localStorage kan ontbreken (privévenster); dan gelden de standaardwaarden.
 */
export interface JarvisSettings {
  speak: boolean;
  voiceURI: string | null;
  rate: number;
  /** Bewaar het gesprek in deze browser (alleen lokale modus; in cloudmodus bewaart Supabase het). */
  keepHistory: boolean;
}

const KEY = "homeos.jarvis.settings";
const DEFAULTS: JarvisSettings = { speak: false, voiceURI: null, rate: 1, keepHistory: true };
const EVENT = "homeos:jarvis-settings";

function read(): JarvisSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<JarvisSettings>;
    return {
      speak: typeof v.speak === "boolean" ? v.speak : DEFAULTS.speak,
      voiceURI: typeof v.voiceURI === "string" ? v.voiceURI.slice(0, 200) : null,
      rate: typeof v.rate === "number" && v.rate >= 0.5 && v.rate <= 2 ? v.rate : 1,
      keepHistory: typeof v.keepHistory === "boolean" ? v.keepHistory : DEFAULTS.keepHistory,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useJarvisSettings() {
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULTS);
  useEffect(() => {
    setSettings(read());
    const sync = () => setSettings(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((patch: Partial<JarvisSettings>) => {
    const next = { ...read(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* niet beschikbaar */
    }
    setSettings(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { settings, update };
}

export function dutchVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === "undefined") return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("nl"));
}

export function speakText(text: string, s: JarvisSettings) {
  if (typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "nl-NL";
  u.rate = s.rate;
  const voice = s.voiceURI ? speechSynthesis.getVoices().find((v) => v.voiceURI === s.voiceURI) : undefined;
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

const HISTORY_KEY = "homeos.jarvis.history";
export const HISTORY_EVENT = "homeos:jarvis-history-cleared";

export function loadLocalHistory<T>(): T[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v.slice(-100) as T[]) : [];
  } catch {
    return [];
  }
}
export function saveLocalHistory<T>(messages: T[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-100)));
  } catch {
    /* niet beschikbaar of vol */
  }
}
export function clearLocalHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* niet beschikbaar */
  }
}
