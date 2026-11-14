"""Smart-home-tests tegen een nagebootste Home Assistant-server."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from jarvis.config import Config
from jarvis.home import SmartHome

STATES = [
    {"entity_id": "light.woonkamer", "state": "on",
     "attributes": {"friendly_name": "Woonkamerlamp", "brightness": 128}},
    {"entity_id": "climate.nest", "state": "heat",
     "attributes": {"friendly_name": "Nest", "temperature": 20.5, "current_temperature": 19.8}},
    {"entity_id": "media_player.keuken", "state": "playing",
     "attributes": {"friendly_name": "Keukenspeaker", "volume_level": 0.4, "media_title": "Jazz"}},
    {"entity_id": "sensor.temp", "state": "19", "attributes": {"friendly_name": "Sensor"}},
    {"entity_id": "switch.kapot", "state": "unavailable", "attributes": {}},
]


@pytest.fixture
def ha(tmp_path, monkeypatch):
    calls = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, payload):
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            assert self.headers["Authorization"] == "Bearer geheim"
            self._send(STATES)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/api/template":
                return self._send([["light.woonkamer", "Woonkamer"], ["climate.nest", "Woonkamer"]])
            calls.append((self.path, body))
            self._send([])

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JARVIS_CAST", "0")
    monkeypatch.setenv("HOME_ASSISTANT_URL", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("HOME_ASSISTANT_TOKEN", "geheim")
    yield SmartHome(Config()), calls
    srv.shutdown()


def test_devices(ha):
    home, _ = ha
    devs = {d["id"]: d for d in home.devices()}
    assert set(devs) == {"light.woonkamer", "climate.nest", "media_player.keuken"}
    assert devs["light.woonkamer"]["brightness"] == 50
    assert devs["light.woonkamer"]["room"] == "Woonkamer"
    assert devs["media_player.keuken"]["room"] == "Overig"
    assert devs["media_player.keuken"]["volume"] == 40


def test_control_by_name(ha):
    home, calls = ha
    home.control("woonkamerlamp", "set_brightness", 30)
    home.control("Nest", "set_temperature", 21)
    home.control("keukenspeaker", "pause")
    assert calls == [
        ("/api/services/light/turn_on", {"entity_id": "light.woonkamer", "brightness_pct": 30}),
        ("/api/services/climate/set_temperature", {"entity_id": "climate.nest", "temperature": 21.0}),
        ("/api/services/media_player/media_pause", {"entity_id": "media_player.keuken"}),
    ]


def test_unknown_device_falls_back_to_google_assistant(ha, monkeypatch):
    home, _ = ha
    sent = []
    monkeypatch.setattr(type(home.assistant), "available", property(lambda self: True))
    monkeypatch.setattr(home.assistant, "send", lambda text: sent.append(text) or "Oké, de slaapkamerlamp staat aan.")
    result = home.control("slaapkamerlamp", "turn_on")
    assert sent == ["zet slaapkamerlamp aan"]
    assert "slaapkamerlamp" in result["google_assistant"]


def test_nothing_linked(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JARVIS_CAST", "0")
    monkeypatch.delenv("HOME_ASSISTANT_URL", raising=False)
    home = SmartHome(Config())
    assert not home.configured
    with pytest.raises(LookupError):
        home.control("lamp", "turn_on")
    with pytest.raises(RuntimeError, match="koppel-google"):
        home.command("doe alle lampen uit")
