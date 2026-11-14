"""Smart home: bedient Google Home-apparaten via drie koppelingen.

1. Google Assistant  – stuurt gesproken/getypte opdrachten naar je Google-account, dus werkt met
                       álles wat in de Google Home-app staat (lampen, stekkers, thermostaat, tv's...).
2. Home Assistant    – optioneel; geeft een volledige apparatenlijst met status en precieze bediening.
3. Google Cast       – Nest-speakers, Nest Hubs, Chromecasts en tv's op je lokale netwerk
                       (volume, afspelen, pauzeren, stoppen).
"""
from __future__ import annotations

import logging
from typing import Any

from ..config import Config
from .assistant import GoogleAssistant
from .cast import CastBackend
from .homeassistant import HomeAssistant

log = logging.getLogger("jarvis.home")

ACTIONS = ["turn_on", "turn_off", "toggle", "set_brightness", "set_temperature", "set_volume",
           "play", "pause", "stop", "next", "previous", "open", "close", "lock", "unlock", "activate"]

DUTCH_ACTION = {
    "turn_on": "zet {name} aan", "turn_off": "zet {name} uit", "toggle": "schakel {name}",
    "set_brightness": "zet {name} op {value} procent", "set_temperature": "zet {name} op {value} graden",
    "set_volume": "zet het volume van {name} op {value} procent", "play": "speel af op {name}",
    "pause": "pauzeer {name}", "stop": "stop {name}", "next": "volgende nummer op {name}",
    "previous": "vorige nummer op {name}", "open": "open {name}", "close": "sluit {name}",
    "lock": "doe {name} op slot", "unlock": "doe {name} van het slot", "activate": "activeer {name}",
}


class SmartHome:
    def __init__(self, config: Config):
        self.config = config
        self.assistant = GoogleAssistant(config)
        self.ha = HomeAssistant(config)
        self.cast = CastBackend(config)

    @property
    def backends(self) -> dict[str, bool]:
        return {"google_assistant": self.assistant.available, "home_assistant": self.ha.available,
                "cast": self.cast.available}

    @property
    def configured(self) -> bool:
        return any(self.backends.values())

    # --- apparaten -----------------------------------------------------------
    def devices(self) -> list[dict]:
        found: list[dict] = []
        for backend in (self.ha, self.cast):
            if not backend.available:
                continue
            try:
                found.extend(backend.devices())
            except Exception as exc:  # één kapotte koppeling mag de rest niet blokkeren
                log.warning("%s: %s", type(backend).__name__, exc)
        # Cast-apparaten die Home Assistant al kent niet dubbel tonen
        names = {d["name"].lower() for d in found if d["backend"] == "home_assistant"}
        return [d for d in found if d["backend"] != "cast" or d["name"].lower() not in names]

    def find(self, query: str) -> dict | None:
        q = query.strip().lower()
        devices = self.devices()
        for d in devices:
            if q in (d["id"].lower(), d["name"].lower()):
                return d
        matches = [d for d in devices if q in d["name"].lower() or q in f"{d['room']} {d['name']}".lower()]
        return matches[0] if len(matches) == 1 else None

    def control(self, device: str, action: str, value: Any = None) -> dict:
        if action not in ACTIONS:
            raise ValueError(f"Onbekende actie '{action}'. Kies uit: {', '.join(ACTIONS)}")
        target = self.find(device)
        if target and target["backend"] == "home_assistant":
            return self.ha.control(target["id"], action, value)
        if target and target["backend"] == "cast":
            return self.cast.control(target["id"], action, value)
        # Niet lokaal gevonden: laat Google Assistant het apparaat op naam bedienen
        if self.assistant.available:
            name = target["name"] if target else device
            return self.command(DUTCH_ACTION[action].format(name=name, value=value))
        known = ", ".join(d["name"] for d in self.devices()) or "geen"
        raise LookupError(f"Apparaat '{device}' niet gevonden. Bekende apparaten: {known}")

    def command(self, text: str) -> dict:
        if not self.assistant.available:
            raise RuntimeError("Google Assistant is nog niet gekoppeld. Draai: python -m jarvis koppel-google")
        return {"command": text, "google_assistant": self.assistant.send(text)}

    def summary(self) -> dict:
        return {"backends": self.backends, "devices": self.devices()}
