"""Home Assistant REST API (alleen standaardbibliotheek)."""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

from ..config import Config

CONTROLLABLE = {"light", "switch", "fan", "climate", "media_player", "cover", "lock",
                "scene", "script", "vacuum", "humidifier", "input_boolean"}

KIND = {"light": "light", "switch": "outlet", "input_boolean": "outlet", "fan": "fan",
        "climate": "thermostat", "media_player": "speaker", "cover": "blinds", "lock": "lock",
        "scene": "scene", "script": "scene", "vacuum": "vacuum", "humidifier": "fan"}

ON_STATES = {"on", "playing", "paused", "idle", "heat", "cool", "heat_cool", "auto", "dry",
             "fan_only", "open", "opening", "unlocked", "cleaning", "buffering"}

AREA_TEMPLATE = ("{% set ns = namespace(items=[]) %}{% for s in states %}"
                 "{% set ns.items = ns.items + [[s.entity_id, area_name(s.entity_id)]] %}"
                 "{% endfor %}{{ ns.items | tojson }}")


class HomeAssistant:
    def __init__(self, config: Config):
        self.url = os.environ.get("HOME_ASSISTANT_URL", "").rstrip("/")
        self.token = os.environ.get("HOME_ASSISTANT_TOKEN", "")

    @property
    def available(self) -> bool:
        return bool(self.url and self.token)

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        req = urllib.request.Request(
            self.url + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return raw

    def _areas(self) -> dict[str, str]:
        try:
            pairs = self._request("POST", "/api/template", {"template": AREA_TEMPLATE})
            if isinstance(pairs, str):
                pairs = json.loads(pairs)
            return {eid: area for eid, area in pairs if area}
        except Exception:
            return {}

    def devices(self) -> list[dict]:
        states = self._request("GET", "/api/states")
        areas = self._areas()
        out = []
        for s in states:
            eid = s["entity_id"]
            domain = eid.split(".", 1)[0]
            if domain not in CONTROLLABLE or s["state"] == "unavailable":
                continue
            a = s.get("attributes", {})
            dev = {
                "id": eid, "name": a.get("friendly_name", eid), "room": areas.get(eid, "Overig"),
                "kind": KIND.get(domain, "outlet"), "on": s["state"] in ON_STATES,
                "state": s["state"], "backend": "home_assistant",
            }
            if domain == "light" and a.get("brightness") is not None:
                dev["brightness"] = round(a["brightness"] / 255 * 100)
            if domain == "climate":
                dev["temperature"] = a.get("temperature")
                dev["current_temperature"] = a.get("current_temperature")
            if domain == "media_player":
                if a.get("volume_level") is not None:
                    dev["volume"] = round(a["volume_level"] * 100)
                dev["media"] = a.get("media_title")
            out.append(dev)
        return out

    def control(self, entity_id: str, action: str, value: Any = None) -> dict:
        domain = entity_id.split(".", 1)[0]
        data: dict[str, Any] = {"entity_id": entity_id}
        service_domain = domain
        if action in ("turn_on", "turn_off", "toggle"):
            service = action
            if domain == "cover":
                service = {"turn_on": "open_cover", "turn_off": "close_cover", "toggle": "toggle"}[action]
            elif domain == "lock":
                service = {"turn_on": "unlock", "turn_off": "lock", "toggle": "lock"}[action]
            elif domain in ("scene", "script"):
                service = "turn_on"
        elif action == "activate":
            service = "turn_on"
        elif action == "set_brightness":
            service, data["brightness_pct"] = "turn_on", int(float(value))
        elif action == "set_temperature":
            service_domain, service, data["temperature"] = "climate", "set_temperature", float(value)
        elif action == "set_volume":
            service_domain, service = "media_player", "volume_set"
            data["volume_level"] = max(0.0, min(1.0, float(value) / 100))
        elif action in ("play", "pause", "stop", "next", "previous"):
            service_domain = "media_player"
            service = {"play": "media_play", "pause": "media_pause", "stop": "media_stop",
                       "next": "media_next_track", "previous": "media_previous_track"}[action]
        elif action in ("open", "close"):
            service_domain, service = "cover", f"{action}_cover"
        elif action in ("lock", "unlock"):
            service_domain, service = "lock", action
        else:
            raise ValueError(f"Actie {action} niet ondersteund voor {entity_id}")
        self._request("POST", f"/api/services/{service_domain}/{service}", data)
        return {"ok": True, "device": entity_id, "service": f"{service_domain}.{service}", **(
            {"value": value} if value is not None else {})}
