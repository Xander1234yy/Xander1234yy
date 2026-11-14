"""Tests voor de webapp: pincode, sessies en app-bestanden."""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from jarvis.brain import Jarvis
from jarvis.config import Config
from jarvis.web import build_server


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JARVIS_CAST", "0")
    monkeypatch.delenv("HOME_ASSISTANT_URL", raising=False)
    cfg = Config()
    cfg.host, cfg.port, cfg.pin = "127.0.0.1", 0, "4321"
    httpd, auth = build_server(Jarvis(cfg, client=object()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


def call(base, path, body=None, cookie=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}"), r.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), e.headers


def test_requires_pin(server):
    assert call(server, "/api/session")[1] == {"auth": True, "ok": False, "pin_length": 4}
    assert call(server, "/api/devices")[0] == 401
    assert call(server, "/api/chat", {"message": "hoi"})[0] == 401


def test_login_flow(server):
    assert call(server, "/api/login", {"pin": "0000"})[0] == 401
    status, _, headers = call(server, "/api/login", {"pin": "4321"})
    assert status == 200
    set_cookie = headers["Set-Cookie"]
    assert "HttpOnly" in set_cookie and "SameSite=Strict" in set_cookie
    cookie = set_cookie.split(";")[0]
    assert call(server, "/api/session", cookie=cookie)[1]["ok"] is True
    assert call(server, "/api/devices", cookie=cookie)[0] == 200
    call(server, "/api/logout", {}, cookie=cookie)
    assert call(server, "/api/devices", cookie=cookie)[0] == 401


def test_lockout_after_too_many_attempts(server):
    for _ in range(5):
        call(server, "/api/login", {"pin": "1111"})
    assert call(server, "/api/login", {"pin": "4321"})[0] == 429


def test_app_files_are_public(server):
    for path in ("/", "/manifest.webmanifest", "/sw.js", "/icon-180.png"):
        with urllib.request.urlopen(server + path) as r:
            assert r.status == 200


def test_auto_pin_when_exposed(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    from jarvis.auth import Auth
    cfg = Config()
    cfg.host = "0.0.0.0"
    a = Auth(cfg)
    assert a.enabled and len(a.pin) == 6 and a.generated_pin
    assert Auth(cfg).pin == a.pin  # blijft hetzelfde na herstart
    cfg.host, cfg.pin = "127.0.0.1", "abc"
    with pytest.raises(ValueError):
        Auth(cfg)
