"""Google Cast: Nest-speakers, Nest Hubs, Chromecasts en tv's op het lokale netwerk.

Vereist het optionele pakket `pychromecast` (zie requirements-home.txt).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from ..config import Config

log = logging.getLogger("jarvis.home.cast")


class CastBackend:
    CACHE_SECONDS = 300

    def __init__(self, config: Config):
        self.enabled = os.environ.get("JARVIS_CAST", "1").lower() not in {"0", "false", "nee", "off"}
        self._casts: dict[str, Any] = {}
        self._scanned = 0.0
        self._lock = threading.Lock()
        try:
            import pychromecast  # noqa: F401
            self._lib = True
        except ImportError:
            self._lib = False

    @property
    def available(self) -> bool:
        return self.enabled and self._lib

    def _discover(self) -> dict[str, Any]:
        with self._lock:
            if self._casts and time.time() - self._scanned < self.CACHE_SECONDS:
                return self._casts
            import pychromecast
            casts, browser = pychromecast.get_chromecasts(timeout=5)
            try:
                browser.stop_discovery()
            except Exception:
                pass
            found = {}
            for cc in casts:
                try:
                    cc.wait(timeout=5)
                except Exception as exc:
                    log.debug("cast wait faalde: %s", exc)
                found[f"cast:{cc.uuid}"] = cc
            self._casts, self._scanned = found, time.time()
            return found

    @staticmethod
    def _name(cc) -> str:
        info = getattr(cc, "cast_info", None)
        return getattr(info, "friendly_name", None) or getattr(cc, "name", "Cast-apparaat")

    def devices(self) -> list[dict]:
        out = []
        for cid, cc in self._discover().items():
            info = getattr(cc, "cast_info", None)
            cast_type = getattr(info, "cast_type", None) or getattr(cc, "cast_type", "cast")
            model = getattr(info, "model_name", None) or getattr(cc, "model_name", "")
            status = getattr(cc, "status", None)
            app = getattr(status, "display_name", None) if status else None
            idle = getattr(cc, "is_idle", True)
            out.append({
                "id": cid, "name": self._name(cc), "room": "Speakers & tv's",
                "kind": "tv" if cast_type == "cast" and "hub" not in model.lower() else "speaker",
                "on": not idle, "state": app or "inactief", "model": model,
                "volume": round((status.volume_level if status else 0) * 100),
                "backend": "cast",
            })
        return out

    def control(self, cast_id: str, action: str, value: Any = None) -> dict:
        cc = self._discover().get(cast_id)
        if cc is None:
            raise LookupError(f"Cast-apparaat {cast_id} niet (meer) gevonden")
        mc = cc.media_controller
        if action == "set_volume":
            cc.set_volume(max(0.0, min(1.0, float(value) / 100)))
        elif action in ("play", "turn_on"):
            mc.play()
        elif action == "pause":
            mc.pause()
        elif action in ("stop", "turn_off"):
            cc.quit_app()
        elif action == "toggle":
            cc.quit_app() if not cc.is_idle else mc.play()
        elif action == "next":
            mc.queue_next()
        elif action == "previous":
            mc.queue_prev()
        else:
            raise ValueError(f"Actie {action} kan niet op een Cast-apparaat")
        return {"ok": True, "device": self._name(cc), "action": action}
