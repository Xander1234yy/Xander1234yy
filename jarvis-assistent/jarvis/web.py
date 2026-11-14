"""Webapp voor Jarvis: een kleine HTTP(S)-server (alleen standaardbibliotheek) met een JSON-API.

Werkt op je computer én op je telefoon (installeerbaar als app via "Zet op beginscherm").
"""
from __future__ import annotations

import json
import logging
import socket
import ssl
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources

from .auth import Auth
from .brain import Jarvis
from .mcp_server import McpEndpoint, load_token

log = logging.getLogger("jarvis.web")

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
    "/icon-180.png": ("icon-180.png", "image/png"),
    "/icon-192.png": ("icon-192.png", "image/png"),
    "/icon-512.png": ("icon-512.png", "image/png"),
}
PUBLIC_API = {"/api/login", "/api/session"}
COOKIE = "jarvis_session"
MAX_BODY = 64 * 1024


def lan_ip() -> str | None:
    """Het adres van deze computer op je thuisnetwerk (er wordt niets verstuurd)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def make_handler(jarvis: Jarvis, auth: Auth, mcp: McpEndpoint | None = None):
    static_dir = resources.files("jarvis").joinpath("static")
    files = {path: (static_dir.joinpath(name).read_bytes(), ctype) for path, (name, ctype) in STATIC.items()}
    https = bool(jarvis.config.cert_file)

    class Handler(BaseHTTPRequestHandler):
        server_version = "Jarvis/1.3"

        def log_message(self, fmt, *args):
            log.debug(fmt, *args)

        # --- hulpjes ------------------------------------------------------------
        def _token(self) -> str | None:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            return cookie[COOKIE].value if COOKIE in cookie else None

        def _secure(self) -> bool:
            return https or self.headers.get("X-Forwarded-Proto", "") == "https"

        def _send(self, status: int, body: bytes, ctype: str, headers: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict, headers: dict | None = None) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8",
                       {"Cache-Control": "no-store", **(headers or {})})

        def _cookie(self, value: str, max_age: int) -> dict:
            parts = [f"{COOKIE}={value}", "Path=/", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
            if self._secure():
                parts.append("Secure")
            return {"Set-Cookie": "; ".join(parts)}

        def _authorized(self) -> bool:
            if auth.valid(self._token()):
                return True
            self._json(401, {"error": "inloggen vereist"})
            return False

        # --- GET ----------------------------------------------------------------
        def _mcp_other(self):
            if mcp and mcp.matches(self.path.split("?", 1)[0]):
                return self._send(405, b"", "text/plain", {"Allow": "POST"})
            self._json(404, {"error": "niet gevonden"})

        do_DELETE = _mcp_other

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if mcp and mcp.matches(path):
                return self._mcp_other()
            if path in files:
                body, ctype = files[path]
                cache = "no-cache" if path in ("/", "/index.html", "/sw.js") else "public, max-age=86400"
                return self._send(200, body, ctype, {"Cache-Control": cache})
            if path == "/api/session":
                return self._json(200, {"auth": auth.enabled, "ok": auth.valid(self._token()),
                                        "pin_length": len(auth.pin)})
            if path.startswith("/api/") and not self._authorized():
                return
            cfg = jarvis.config
            if path == "/api/status":
                return self._json(200, {
                    "title": cfg.user_title, "language": cfg.language,
                    "reminders": jarvis.due_reminders(), "todos": jarvis.memory.todos(),
                })
            if path == "/api/devices":
                try:
                    return self._json(200, jarvis.home.summary())
                except Exception as exc:
                    return self._json(500, {"error": str(exc)})
            if path == "/api/phone":
                ip = lan_ip()
                scheme = "https" if https else "http"
                exposed = cfg.host not in ("127.0.0.1", "localhost", "::1")
                return self._json(200, {"url": f"{scheme}://{ip}:{cfg.port}" if ip and exposed else None,
                                        "https": https, "exposed": exposed})
            self._json(404, {"error": "niet gevonden"})

        # --- POST ---------------------------------------------------------------
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path.startswith("/mcp/"):
                if not (mcp and mcp.matches(path)):
                    return self._json(404, {"error": "niet gevonden"})
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if length > MAX_BODY:
                        return self._json(413, {"error": "te groot"})
                    message = json.loads(self.rfile.read(length) or b"null")
                except (ValueError, json.JSONDecodeError):
                    return self._json(400, {"jsonrpc": "2.0", "id": None,
                                            "error": {"code": -32700, "message": "Ongeldige JSON"}})
                reply = mcp.handle(message)
                if reply is None:
                    return self._send(202, b"", "text/plain")
                return self._json(200, reply)
            if "application/json" not in self.headers.get("Content-Type", ""):
                return self._json(415, {"error": "verwacht JSON"})
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length > MAX_BODY:
                    return self._json(413, {"error": "te groot"})
                data = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._json(400, {"error": "ongeldige JSON"})

            if path == "/api/login":
                client = self.client_address[0]
                wait = auth.locked_for(client)
                if wait:
                    return self._json(429, {"error": f"Te vaak geprobeerd. Wacht {wait // 60 + 1} minuten."})
                token = auth.login(str(data.get("pin", "")), client)
                if not token:
                    return self._json(401, {"error": "Onjuiste pincode"})
                return self._json(200, {"ok": True}, self._cookie(token, 365 * 86400))
            if path == "/api/logout":
                auth.logout(self._token())
                return self._json(200, {"ok": True}, self._cookie("", 0))

            if not self._authorized():
                return
            if path == "/api/chat":
                text = str(data.get("message", "")).strip()[:4000]
                if not text:
                    return self._json(400, {"error": "leeg bericht"})
                used: list[str] = []
                reply = jarvis.ask(text, on_tool=lambda name, _a: used.append(name))
                return self._json(200, {"reply": reply, "tools": used})
            if path == "/api/devices/control":
                try:
                    result = jarvis.home.control(str(data.get("device", "")), str(data.get("action", "")),
                                                 data.get("value"))
                    return self._json(200, {"ok": True, "result": result})
                except Exception as exc:
                    return self._json(400, {"ok": False, "error": str(exc)})
            if path == "/api/reset":
                jarvis.reset()
                return self._json(200, {"ok": True})
            self._json(404, {"error": "niet gevonden"})

    return Handler


def build_server(jarvis: Jarvis) -> tuple[ThreadingHTTPServer, Auth]:
    cfg = jarvis.config
    auth = Auth(cfg)
    mcp = McpEndpoint(jarvis, load_token(jarvis)) if cfg.connector else None
    httpd = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(jarvis, auth, mcp))
    httpd.mcp = mcp
    if cfg.cert_file:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cfg.cert_file, cfg.key_file or None)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd, auth


def serve(jarvis: Jarvis) -> None:
    cfg = jarvis.config
    httpd, auth = build_server(jarvis)
    scheme = "https" if cfg.cert_file else "http"
    print(f"\nJarvis draait.\n  Op deze computer:  {scheme}://127.0.0.1:{cfg.port}")
    if cfg.host in ("127.0.0.1", "localhost", "::1"):
        print("  Op je telefoon:    start met  python -m jarvis web --telefoon")
    else:
        ip = lan_ip()
        if ip:
            print(f"  Op je telefoon:    {scheme}://{ip}:{cfg.port}   (zelfde wifi)")
    if auth.enabled:
        print(f"  Pincode:           {auth.pin}" + (f"  (opgeslagen in {cfg.data_dir / 'pin'})" if auth.generated_pin else ""))
    if httpd.mcp:
        print(f"  Connector-pad:     /mcp/{httpd.mcp.token}")
        print("                     Zet je publieke https-adres ervoor (bv. via 'tailscale funnel --bg "
              f"{cfg.port}') en voeg dat toe als connector 'Jarvis' in claude.ai.")
    if scheme == "http" and cfg.host not in ("127.0.0.1", "localhost", "::1"):
        print("  Let op: de microfoon op je telefoon werkt alleen via https (zie README, 'Op je telefoon').")
    print("  Ctrl+C om te stoppen\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nJarvis gestopt.")
    finally:
        httpd.server_close()
