"""Tests voor de Vercel-versie: ondertekende sessies, opslag in (nep-)Upstash en het startpunt."""
from __future__ import annotations

import importlib.util
import json
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def upstash():
    store: dict[str, str] = {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _reply(self, result):
            body = json.dumps({"result": result}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            assert self.headers["Authorization"] == "Bearer kv-token"
            self._reply(store.get(self.path.split("/get/", 1)[1]))

        def do_POST(self):
            key = self.path.split("/set/", 1)[1]
            store[key] = self.rfile.read(int(self.headers["Content-Length"])).decode()
            self._reply("OK")

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", store
    srv.shutdown()


@pytest.fixture
def cloud(tmp_path, monkeypatch, upstash):
    url, store = upstash
    for k, v in {"VERCEL": "1", "JARVIS_DATA_DIR": str(tmp_path), "JARVIS_PIN": "2468", "JARVIS_SECRET": "x" * 40,
                 "JARVIS_CONNECTOR": "1", "JARVIS_MCP_TOKEN": "m" * 30, "ANTHROPIC_API_KEY": "test",
                 "KV_REST_API_URL": url, "KV_REST_API_TOKEN": "kv-token"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("HOME_ASSISTANT_URL", raising=False)
    spec = importlib.util.spec_from_file_location("vercel_index", ROOT / "api" / "index.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), mod.handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", mod, store
    srv.shutdown()


def call(base, path, body=None, cookie=None, host=None):
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    if host:
        headers["Host"] = host
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}"), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), e.headers


def test_signed_session_works_across_instances(cloud):
    base, mod, _ = cloud
    assert call(base, "/api/devices")[0] == 401
    status, _, headers = call(base, "/api/login", {"pin": "2468"})
    assert status == 200 and "Secure" not in headers["Set-Cookie"]  # lokaal http; op Vercel via X-Forwarded-Proto
    cookie = headers["Set-Cookie"].split(";")[0]
    assert call(base, "/api/devices", cookie=cookie)[0] == 200
    from jarvis.auth import Auth
    assert Auth(mod._config).valid(cookie.split("=", 1)[1])  # een andere server accepteert hem ook
    assert not Auth(mod._config).valid(cookie.split("=", 1)[1][:-1] + "0")


def test_memory_lives_in_redis(cloud):
    _, mod, store = cloud
    mod._jarvis.memory.add_todo("Band oppompen")
    assert "Band oppompen" in store["jarvis:memory"]
    from jarvis.memory import open_memory
    assert open_memory(Path("/nergens")).todos()[0]["text"] == "Band oppompen"


def test_phone_url_and_connector(cloud):
    base, _, _ = cloud
    cookie = call(base, "/api/login", {"pin": "2468"})[2]["Set-Cookie"].split(";")[0]
    assert call(base, "/api/phone", cookie=cookie, host="jarvis.vercel.app")[1]["url"] == "https://jarvis.vercel.app"
    status, reply, _ = call(base, "/mcp/" + "m" * 30, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert status == 200 and len(reply["result"]["tools"]) == 5


def test_cloud_requires_pin_and_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("JARVIS_PIN", raising=False)
    from jarvis.auth import Auth
    from jarvis.config import Config
    with pytest.raises(ValueError, match="JARVIS_PIN"):
        Auth(Config())
    monkeypatch.setenv("JARVIS_PIN", "1234")
    monkeypatch.setenv("JARVIS_SECRET", "kort")
    with pytest.raises(ValueError, match="JARVIS_SECRET"):
        Auth(Config())
