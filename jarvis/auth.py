"""Toegang met pincode, zodat alleen jij Jarvis vanaf je telefoon kunt bedienen."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
from pathlib import Path

from .config import Config

MAX_FAILURES = 5
LOCKOUT_SECONDS = 300
SESSION_DAYS = 365


def _is_loopback(host: str) -> bool:
    return host in {"127.0.0.1", "localhost", "::1"}


class Auth:
    def __init__(self, config: Config):
        self.config = config
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        self.sessions_path = config.data_dir / "sessions.json"
        self.pin = (config.pin or "").strip()
        if self.pin and not (self.pin.isdigit() and 4 <= len(self.pin) <= 8):
            raise ValueError("De pincode moet uit 4 tot 8 cijfers bestaan.")
        self.generated_pin = False
        if not self.pin and not _is_loopback(config.host):
            # Bereikbaar vanaf het netwerk zonder pincode? Dan maken we er zelf een.
            pin_path = config.data_dir / "pin"
            if pin_path.exists():
                self.pin = pin_path.read_text().strip()
            else:
                self.pin = f"{secrets.randbelow(10**6):06d}"
                pin_path.write_text(self.pin)
                pin_path.chmod(0o600)
            self.generated_pin = True
        self._sessions = self._load()

    @property
    def enabled(self) -> bool:
        return bool(self.pin)

    # --- sessies -------------------------------------------------------------
    @staticmethod
    def _hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _load(self) -> dict[str, float]:
        try:
            data = json.loads(Path(self.sessions_path).read_text())
            now = time.time()
            return {h: exp for h, exp in data.items() if exp > now}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        self.sessions_path.write_text(json.dumps(self._sessions))
        self.sessions_path.chmod(0o600)

    def valid(self, token: str | None) -> bool:
        if not self.enabled:
            return True
        if not token:
            return False
        exp = self._sessions.get(self._hash(token))
        return bool(exp and exp > time.time())

    def logout(self, token: str | None) -> None:
        if token:
            with self._lock:
                self._sessions.pop(self._hash(token), None)
                self._save()

    # --- inloggen ------------------------------------------------------------
    def locked_for(self, client: str) -> int:
        now = time.time()
        recent = [t for t in self._failures.get(client, []) if now - t < LOCKOUT_SECONDS]
        self._failures[client] = recent
        if len(recent) >= MAX_FAILURES:
            return int(LOCKOUT_SECONDS - (now - recent[0])) + 1
        return 0

    def login(self, pin: str, client: str) -> str | None:
        """Geeft een sessietoken terug bij de juiste pincode, anders None."""
        with self._lock:
            if self.locked_for(client):
                return None
            if not hmac.compare_digest(str(pin).strip().encode(), self.pin.encode()):
                self._failures.setdefault(client, []).append(time.time())
                return None
            self._failures.pop(client, None)
            token = secrets.token_urlsafe(32)
            self._sessions[self._hash(token)] = time.time() + SESSION_DAYS * 86400
            self._save()
            return token
