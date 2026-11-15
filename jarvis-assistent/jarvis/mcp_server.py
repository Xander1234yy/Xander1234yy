"""MCP-aansluiting: maakt Jarvis een connector voor claude.ai.

Zo kan de telefoonversie van Jarvis (en Claude zelf) je echte Google Home-apparaten
bedienen via de Jarvis-server bij jou thuis. Spreekt het MCP "streamable HTTP"-protocol
(JSON-RPC via POST, antwoorden als JSON) met alleen de standaardbibliotheek.

Het adres bevat een geheime sleutel (/mcp/<sleutel>); wie de sleutel niet heeft, krijgt 404.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import secrets
from typing import Any

from .brain import Jarvis

log = logging.getLogger("jarvis.mcp")

SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]

TOOLS: list[dict] = [
    {
        "name": "home_devices",
        "title": "Apparaten thuis",
        "description": "Alle smart-home-apparaten met kamer en huidige status, plus welke koppelingen actief zijn.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "home_control",
        "title": "Apparaat bedienen",
        "description": "Bedient één apparaat op naam of id. Werkt ook voor apparaten die alleen in de Google Home-app staan.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device": {"type": "string", "description": "Naam of id van het apparaat"},
                "action": {"type": "string", "enum": [
                    "turn_on", "turn_off", "toggle", "set_brightness", "set_temperature", "set_volume",
                    "play", "pause", "stop", "next", "previous", "open", "close", "lock", "unlock", "activate"]},
                "value": {"type": "number", "description": "Helderheid/volume in procent of temperatuur in °C"},
            },
            "required": ["device", "action"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
    {
        "name": "google_home_command",
        "title": "Opdracht aan Google Home",
        "description": "Stuurt een opdracht in gewone taal naar Google Assistant, alsof je 'Hey Google' zegt. "
                       "Voor kamers, groepen, scènes, routines en kleuren.",
        "inputSchema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
    {
        "name": "get_weather",
        "title": "Weer",
        "description": "Actueel weer en verwachting voor een plaats (standaard de ingestelde stad).",
        "inputSchema": {
            "type": "object",
            "properties": {"location": {"type": "string"}, "days": {"type": "integer", "minimum": 1, "maximum": 7}},
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "ask_jarvis",
        "title": "Vraag aan Jarvis thuis",
        "description": "Stelt een vraag aan Jarvis op de computer thuis, die op het web kan zoeken en al zijn tools heeft "
                       "(actueel nieuws, sport, koersen, openingstijden, feiten). Geeft het antwoord als tekst.",
        "inputSchema": {
            "type": "object",
            "properties": {"question": {"type": "string"}},
            "required": ["question"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
    },
]


def load_token(jarvis: Jarvis) -> str:
    env = os.environ.get("JARVIS_MCP_TOKEN", "").strip()
    if env:
        if len(env) < 24:
            raise ValueError("JARVIS_MCP_TOKEN moet minstens 24 tekens lang zijn.")
        return env
    path = jarvis.config.data_dir / "mcp_token"
    if path.exists():
        return path.read_text().strip()
    token = secrets.token_urlsafe(24)
    path.write_text(token)
    path.chmod(0o600)
    return token


class McpEndpoint:
    def __init__(self, jarvis: Jarvis, token: str):
        self.jarvis = jarvis
        self.token = token

    def matches(self, path: str) -> bool:
        if not path.startswith("/mcp/"):
            return False
        return hmac.compare_digest(path[len("/mcp/"):].strip("/").encode(), self.token.encode())

    # --- tools --------------------------------------------------------------
    def _call(self, name: str, args: dict) -> Any:
        home = self.jarvis.home
        if name == "home_devices":
            return home.summary()
        if name == "home_control":
            return home.control(str(args.get("device", "")), str(args.get("action", "")), args.get("value"))
        if name == "google_home_command":
            return home.command(str(args.get("command", "")))
        if name == "get_weather":
            return json.loads(self.jarvis.tools.run("get_weather", {k: v for k, v in args.items() if v is not None}))
        if name == "ask_jarvis":
            question = str(args.get("question", "")).strip()[:4000]
            if not question:
                raise ValueError("Geen vraag meegegeven")
            return {"answer": self.jarvis.ask(question)}
        raise KeyError(name)

    # --- JSON-RPC -----------------------------------------------------------
    def handle(self, message: Any) -> Any:
        """Verwerkt één JSON-RPC-bericht (of een lijst). Geeft None terug bij alleen notificaties."""
        if isinstance(message, list):
            replies = [r for r in (self._one(m) for m in message) if r is not None]
            return replies or None
        return self._one(message)

    def _one(self, msg: Any) -> dict | None:
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Ongeldig verzoek"}}
        mid, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
        if mid is None:  # notificatie, zoals notifications/initialized
            return None

        def ok(result: dict) -> dict:
            return {"jsonrpc": "2.0", "id": mid, "result": result}

        if method == "initialize":
            asked = params.get("protocolVersion")
            return ok({
                "protocolVersion": asked if asked in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "jarvis", "title": "Jarvis", "version": "1.3.0"},
                "instructions": "Bedient de smart-home-apparaten van de gebruiker via Jarvis thuis.",
            })
        if method == "ping":
            return ok({})
        if method == "tools/list":
            return ok({"tools": TOOLS})
        if method == "tools/call":
            name = params.get("name")
            if name not in {t["name"] for t in TOOLS}:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"Onbekende tool: {name}"}}
            try:
                data = self._call(name, params.get("arguments") or {})
                structured = data if isinstance(data, dict) else {"result": data}
                return ok({"content": [{"type": "text", "text": json.dumps(structured, ensure_ascii=False, default=str)}],
                           "structuredContent": structured, "isError": False})
            except Exception as exc:  # toolfouten gaan als resultaat terug, niet als protocolfout
                log.warning("MCP-tool %s faalde: %s", name, exc)
                return ok({"content": [{"type": "text", "text": str(exc)}], "isError": True})
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"Onbekende methode: {method}"}}
