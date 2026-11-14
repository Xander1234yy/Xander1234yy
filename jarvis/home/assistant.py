"""Google Assistant SDK: stuurt tekstopdrachten naar je eigen Google-account.

Zo bedient JARVIS alles wat aan je Google Home-app gekoppeld is, ook apparaten
van andere merken (Hue, IKEA, Tuya, Nest, tv's ...), precies alsof je
"Hey Google, ..." zegt.

Vereist: gassist-text, google-auth-oauthlib (zie requirements-home.txt) en een
eenmalige koppeling via `python -m jarvis koppel-google <client_secret.json>`.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

from ..config import Config

SCOPES = ["https://www.googleapis.com/auth/assistant-sdk-prototype"]
LOCALES = {"nl": "nl-NL", "en": "en-US", "de": "de-DE", "fr": "fr-FR"}


class GoogleAssistant:
    def __init__(self, config: Config):
        self.token_path = Path(os.environ.get("GOOGLE_ASSISTANT_TOKEN",
                                              config.data_dir / "google_assistant_token.json"))
        self.language = LOCALES.get(config.language, "nl-NL")
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self.token_path.exists()

    def _credentials(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)
        if not creds.valid and creds.refresh_token:
            creds.refresh(Request())
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
        return creds

    def send(self, text: str) -> str:
        try:
            from gassist_text import TextAssistant
        except ImportError as exc:
            raise RuntimeError("Installeer eerst: pip install -r requirements-home.txt") from exc
        with self._lock, TextAssistant(self._credentials(), self.language) as assistant:
            result = assistant.assist(text)
        reply = result[0] if isinstance(result, tuple) else result
        return reply or "Opdracht verstuurd (Google gaf geen gesproken antwoord)."

    def link(self, client_secret: str) -> Path:
        """Eenmalige OAuth-koppeling: opent je browser om in te loggen bij Google."""
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(client_secret, SCOPES)
        creds = flow.run_local_server(port=0, prompt="consent")
        self.token_path.parent.mkdir(parents=True, exist_ok=True)
        self.token_path.write_text(creds.to_json(), encoding="utf-8")
        os.chmod(self.token_path, 0o600)
        return self.token_path
