"""Tests voor de MCP-connector van Jarvis."""
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
def mcp(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JARVIS_CAST", "0")
    monkeypatch.delenv("HOME_ASSISTANT_URL", raising=False)
    cfg = Config()
    cfg.host, cfg.port, cfg.connector = "127.0.0.1", 0, True
    httpd, auth = build_server(Jarvis(cfg, client=object()))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", httpd.mcp.token, auth
    httpd.shutdown()


def rpc(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, None


def test_wrong_token_is_hidden(mcp):
    base, _, _ = mcp
    assert rpc(f"{base}/mcp/fout", {"jsonrpc": "2.0", "id": 1, "method": "ping"})[0] == 404


def test_handshake_and_tools(mcp):
    base, token, _ = mcp
    url = f"{base}/mcp/{token}"
    status, init = rpc(url, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                             "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}}})
    assert status == 200 and init["result"]["protocolVersion"] == "2025-06-18"
    assert init["result"]["capabilities"]["tools"] is not None
    assert rpc(url, {"jsonrpc": "2.0", "method": "notifications/initialized"})[0] == 202
    names = [t["name"] for t in rpc(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})[1]["result"]["tools"]]
    assert names == ["home_devices", "home_control", "google_home_command", "get_weather"]


def test_tool_calls(mcp):
    base, token, _ = mcp
    url = f"{base}/mcp/{token}"
    res = rpc(url, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "home_devices", "arguments": {}}})[1]["result"]
    assert res["isError"] is False and res["structuredContent"]["devices"] == []
    res = rpc(url, {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                    "params": {"name": "home_control", "arguments": {"device": "lamp", "action": "turn_on"}}})[1]["result"]
    assert res["isError"] is True and "niet gevonden" in res["content"][0]["text"]
    err = rpc(url, {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "rm_rf", "arguments": {}}})[1]
    assert err["error"]["code"] == -32602


def test_connector_forces_pin(mcp):
    _, _, auth = mcp
    assert auth.enabled and len(auth.pin) == 6
