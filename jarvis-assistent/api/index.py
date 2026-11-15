"""Startpunt voor Vercel: alle verzoeken komen hier binnen (zie vercel.json).

Vercel's Python-runtime gebruikt de klasse `handler` (een BaseHTTPRequestHandler).
We hergebruiken de handler van de gewone Jarvis-webserver.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from jarvis.auth import Auth  # noqa: E402
from jarvis.brain import Jarvis  # noqa: E402
from jarvis.config import Config  # noqa: E402
from jarvis.mcp_server import McpEndpoint, load_token  # noqa: E402
from jarvis.web import make_handler  # noqa: E402

_config = Config()
_config.cloud = True
_jarvis = Jarvis(_config)
_auth = Auth(_config)
_mcp = McpEndpoint(_jarvis, load_token(_jarvis)) if _config.connector else None
_Base = make_handler(_jarvis, _auth, _mcp)


class handler(_Base):  # noqa: N801  (Vercel zoekt naar precies deze naam)
    """Ververst het geheugen bij elk verzoek: een andere server kan het net hebben aangepast."""

    def _fresh(self):
        try:
            _jarvis.memory.reload()
        except Exception:  # opslag even onbereikbaar: werk met wat we hebben
            pass

    def do_GET(self):
        self._fresh()
        super().do_GET()

    def do_POST(self):
        self._fresh()
        super().do_POST()
