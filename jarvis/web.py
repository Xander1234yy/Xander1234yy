"""Web-HUD voor JARVIS: een kleine HTTP-server (alleen standaardbibliotheek) met een JSON-API."""
from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources

from .brain import Jarvis

log = logging.getLogger("jarvis.web")


def make_handler(jarvis: Jarvis):
    index_html = resources.files("jarvis").joinpath("static/index.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        server_version = "JARVIS/1.0"

        def log_message(self, fmt, *args):  # stiller dan de standaard
            log.debug(fmt, *args)

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(index_html)))
                self.end_headers()
                self.wfile.write(index_html)
            elif self.path == "/api/status":
                cfg = jarvis.config
                self._json(200, {
                    "title": cfg.user_title, "language": cfg.language, "model": cfg.model,
                    "reminders": jarvis.due_reminders(),
                    "todos": jarvis.memory.todos(), "facts": jarvis.memory.facts(),
                })
            else:
                self._json(404, {"error": "niet gevonden"})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "ongeldige JSON"})

            if self.path == "/api/chat":
                text = str(data.get("message", "")).strip()
                if not text:
                    return self._json(400, {"error": "leeg bericht"})
                used: list[str] = []
                reply = jarvis.ask(text, on_tool=lambda name, _a: used.append(name))
                return self._json(200, {"reply": reply, "tools": used})
            if self.path == "/api/reset":
                jarvis.reset()
                return self._json(200, {"ok": True})
            self._json(404, {"error": "niet gevonden"})

    return Handler


def serve(jarvis: Jarvis) -> None:
    cfg = jarvis.config
    httpd = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(jarvis))
    print(f"JARVIS HUD online op http://{cfg.host}:{cfg.port}  (Ctrl+C om te stoppen)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nJARVIS gaat offline.")
    finally:
        httpd.server_close()
