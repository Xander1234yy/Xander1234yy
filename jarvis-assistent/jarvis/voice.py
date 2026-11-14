"""Lokale spraakmodus: microfoon -> tekst -> JARVIS -> spraak.

Vereist de optionele pakketten uit requirements-voice.txt (SpeechRecognition, PyAudio, pyttsx3).
"""
from __future__ import annotations

import threading
import time

from .brain import Jarvis

WAKE_WORDS = ("jarvis", "jervis", "travis")
LOCALES = {"nl": "nl-NL", "en": "en-GB", "de": "de-DE", "fr": "fr-FR"}


class Voice:
    def __init__(self, jarvis: Jarvis, wake_word: bool = True):
        try:
            import pyttsx3
            import speech_recognition as sr
        except ImportError as exc:
            raise SystemExit(
                "Spraakmodus vereist extra pakketten: pip install -r requirements-voice.txt"
            ) from exc
        self.sr = sr
        self.jarvis = jarvis
        self.wake_word = wake_word
        self.recognizer = sr.Recognizer()
        self.recognizer.dynamic_energy_threshold = True
        self.engine = pyttsx3.init()
        self.engine.setProperty("rate", 175)
        self._select_voice()
        self._speak_lock = threading.Lock()

    def _select_voice(self) -> None:
        lang = self.jarvis.config.language
        for v in self.engine.getProperty("voices"):
            ident = (v.id + " " + " ".join(map(str, getattr(v, "languages", [])))).lower()
            if lang in ident or LOCALES.get(lang, "").lower() in ident:
                self.engine.setProperty("voice", v.id)
                return

    def say(self, text: str) -> None:
        print(f"Jarvis: {text}")
        with self._speak_lock:
            self.engine.say(text)
            self.engine.runAndWait()

    def listen(self, mic) -> str | None:
        try:
            audio = self.recognizer.listen(mic, timeout=None, phrase_time_limit=15)
            return self.recognizer.recognize_google(
                audio, language=LOCALES.get(self.jarvis.config.language, "nl-NL"))
        except (self.sr.UnknownValueError, self.sr.WaitTimeoutError):
            return None
        except self.sr.RequestError as exc:
            print(f"[spraakherkenning niet bereikbaar: {exc}]")
            time.sleep(2)
            return None

    def _reminder_loop(self) -> None:
        while True:
            for r in self.jarvis.due_reminders():
                self.say(f"Herinnering, {self.jarvis.config.user_title}: {r['text']}")
            time.sleep(15)

    def run(self) -> None:
        threading.Thread(target=self._reminder_loop, daemon=True).start()
        with self.sr.Microphone() as mic:
            self.recognizer.adjust_for_ambient_noise(mic, duration=1)
            self.say(f"Hoi {self.jarvis.config.user_title}, ik luister.")
            while True:
                heard = self.listen(mic)
                if not heard:
                    continue
                print(f"U: {heard}")
                lowered = heard.lower()
                if self.wake_word:
                    hit = next((w for w in WAKE_WORDS if w in lowered), None)
                    if not hit:
                        continue
                    heard = heard[lowered.index(hit) + len(hit):].strip(" ,.!?")
                    if not heard:
                        self.say("Ja?")
                        heard = self.listen(mic) or ""
                        if not heard:
                            continue
                if lowered.strip(" .!") in {"stop", "afsluiten", "jarvis afsluiten", "tot ziens"}:
                    self.say("Tot ziens.")
                    return
                self.say(self.jarvis.ask(heard, on_tool=lambda n, a: print(f"  [{n}]")))
