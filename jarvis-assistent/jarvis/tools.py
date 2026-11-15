"""De vaardigheden van JARVIS: tooldefinities voor Claude plus hun implementaties."""
from __future__ import annotations

import ast
import datetime as dt
import json
import math
import operator
import os
import platform
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
import webbrowser
from typing import Any, Callable

from .config import Config
from .memory import Memory

WEATHER_CODES = {
    0: "helder", 1: "overwegend helder", 2: "half bewolkt", 3: "bewolkt",
    45: "mist", 48: "rijpmist", 51: "lichte motregen", 53: "motregen", 55: "zware motregen",
    61: "lichte regen", 63: "regen", 65: "zware regen", 66: "ijzel", 67: "zware ijzel",
    71: "lichte sneeuw", 73: "sneeuw", 75: "zware sneeuw", 77: "korrelsneeuw",
    80: "lichte buien", 81: "buien", 82: "zware buien", 85: "sneeuwbuien", 86: "zware sneeuwbuien",
    95: "onweer", 96: "onweer met hagel", 99: "zwaar onweer met hagel",
}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


TOOL_DEFINITIONS: list[dict] = [
    {
        "name": "get_time",
        "description": "Geeft de huidige datum, tijd en dag van de week, optioneel in een IANA-tijdzone (bv. 'America/New_York').",
        "input_schema": _obj({"timezone": {"type": "string"}}),
    },
    {
        "name": "get_weather",
        "description": "Actueel weer en verwachting voor de komende dagen in een plaats. Zonder plaats wordt de standaardstad gebruikt.",
        "input_schema": _obj({
            "location": {"type": "string", "description": "Plaatsnaam, bv. 'Utrecht'"},
            "days": {"type": "integer", "description": "Aantal dagen verwachting (1-7)", "minimum": 1, "maximum": 7},
        }),
    },
    {
        "name": "calculate",
        "description": "Rekent een wiskundige expressie exact uit (+ - * / // % **, sqrt, sin, cos, tan, log, pi, e, ...). Gebruik dit voor alle berekeningen.",
        "input_schema": _obj({"expression": {"type": "string"}}, ["expression"]),
    },
    {
        "name": "remember_fact",
        "description": "Slaat een blijvend feit over de gebruiker of de wereld op (bv. key='verjaardag', value='12 maart').",
        "input_schema": _obj({"key": {"type": "string"}, "value": {"type": "string"}}, ["key", "value"]),
    },
    {
        "name": "forget_fact",
        "description": "Verwijdert een eerder opgeslagen feit.",
        "input_schema": _obj({"key": {"type": "string"}}, ["key"]),
    },
    {
        "name": "notes",
        "description": "Beheert notities. action: 'add' (met text), 'search' (optioneel query; leeg = alles), 'delete' (met id).",
        "input_schema": _obj({
            "action": {"type": "string", "enum": ["add", "search", "delete"]},
            "text": {"type": "string"}, "query": {"type": "string"}, "id": {"type": "string"},
        }, ["action"]),
    },
    {
        "name": "todos",
        "description": "Beheert de takenlijst. action: 'add' (met text), 'list', 'complete' (met id).",
        "input_schema": _obj({
            "action": {"type": "string", "enum": ["add", "list", "complete"]},
            "text": {"type": "string"}, "id": {"type": "string"},
            "include_done": {"type": "boolean"},
        }, ["action"]),
    },
    {
        "name": "set_reminder",
        "description": "Zet een herinnering of timer. Geef óf 'in_minutes' óf 'at' (ISO 8601 lokale tijd, bv. '2026-11-15T09:30').",
        "input_schema": _obj({
            "text": {"type": "string"}, "in_minutes": {"type": "number"}, "at": {"type": "string"},
        }, ["text"]),
    },
    {
        "name": "list_reminders",
        "description": "Toont alle openstaande herinneringen.",
        "input_schema": _obj({}),
    },
    {
        "name": "open_url",
        "description": "Opent een website in de browser van de gebruiker (bv. YouTube, Google-zoekopdracht).",
        "input_schema": _obj({"url": {"type": "string"}}, ["url"]),
    },
    {
        "name": "system_status",
        "description": "Systeemdiagnose: besturingssysteem, CPU, geheugen, schijfruimte, batterij en uptime.",
        "input_schema": _obj({}),
    },
    {
        "name": "home_devices",
        "description": "Toont alle smart-home-apparaten (Google Home / Home Assistant / Nest-speakers en Chromecasts) met kamer en huidige status, en welke koppelingen actief zijn.",
        "input_schema": _obj({}),
    },
    {
        "name": "home_control",
        "description": "Bedient één smart-home-apparaat op naam of id. Werkt ook voor apparaten die alleen in de Google Home-app staan. Gebruik voor meerdere apparaten tegelijk of scènes liever google_home_command.",
        "input_schema": _obj({
            "device": {"type": "string", "description": "Naam of id, bv. 'Woonkamerlamp' of 'light.woonkamer'"},
            "action": {"type": "string", "enum": ["turn_on", "turn_off", "toggle", "set_brightness", "set_temperature",
                                                  "set_volume", "play", "pause", "stop", "next", "previous",
                                                  "open", "close", "lock", "unlock", "activate"]},
            "value": {"type": "number", "description": "Helderheid/volume in procent, of temperatuur in °C"},
        }, ["device", "action"]),
    },
    {
        "name": "google_home_command",
        "description": "Stuurt een opdracht in gewone taal naar Google Assistant, precies alsof de gebruiker 'Hey Google' zegt. Bedient alles in de Google Home-app: kamers, groepen, routines, scènes, kleuren, thermostaat, tv's. Bv. 'zet alle lampen in de woonkamer op 30 procent warm wit'.",
        "input_schema": _obj({"command": {"type": "string"}}, ["command"]),
    },
    {
        "name": "run_shell",
        "description": "Voert een shell-commando uit op de computer van de gebruiker en geeft de uitvoer terug. Alleen beschikbaar als de gebruiker dit heeft ingeschakeld.",
        "input_schema": _obj({"command": {"type": "string"}}, ["command"]),
    },
]


# --- veilige rekenmachine -------------------------------------------------
_BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_MATH_NAMES: dict[str, Any] = {
    name: getattr(math, name) for name in (
        "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log10", "log2", "exp",
        "floor", "ceil", "factorial", "pi", "e", "tau", "radians", "degrees", "hypot",
    )
}
_MATH_NAMES.update({"abs": abs, "round": round, "min": min, "max": max})


def safe_eval(expression: str) -> float | int:
    def ev(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 1000:
                raise ValueError("exponent te groot")
            return _BIN_OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Name) and node.id in _MATH_NAMES:
            return _MATH_NAMES[node.id]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _MATH_NAMES:
            return _MATH_NAMES[node.func.id](*[ev(a) for a in node.args])
        raise ValueError(f"niet toegestaan in expressie: {ast.dump(node)[:60]}")

    return ev(ast.parse(expression.replace("^", "**"), mode="eval"))


def _http_json(url: str, timeout: float = 10) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "jarvis-assistant/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class ToolBox:
    """Voert tool-aanroepen van Claude uit."""

    def __init__(self, config: Config, memory: Memory, confirm: Callable[[str], bool] | None = None,
                 home: Any = None):
        self.config = config
        self.memory = memory
        self.home = home
        self.confirm = confirm  # vraagt toestemming voor gevoelige acties (shell)

    @property
    def definitions(self) -> list[dict]:
        defs = [d for d in TOOL_DEFINITIONS if d["name"] != "run_shell" or self.config.allow_shell]
        return defs

    def run(self, name: str, args: dict) -> str:
        handler = getattr(self, f"_t_{name}", None)
        if handler is None:
            raise ValueError(f"Onbekende tool: {name}")
        result = handler(**(args or {}))
        return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)

    # --- implementaties -----------------------------------------------------
    def _t_get_time(self, timezone: str | None = None) -> dict:
        if timezone:
            from zoneinfo import ZoneInfo
            now = dt.datetime.now(ZoneInfo(timezone))
        else:
            now = dt.datetime.now().astimezone()
        return {"iso": now.isoformat(timespec="seconds"), "weekday": now.strftime("%A"),
                "timezone": str(now.tzinfo)}

    def _t_get_weather(self, location: str | None = None, days: int = 3) -> dict:
        place = location or self.config.city
        geo = _http_json(
            "https://geocoding-api.open-meteo.com/v1/search?"
            + urllib.parse.urlencode({"name": place, "count": 1, "language": self.config.language})
        )
        if not geo.get("results"):
            return {"error": f"Plaats '{place}' niet gevonden"}
        g = geo["results"][0]
        params = {
            "latitude": g["latitude"], "longitude": g["longitude"], "timezone": "auto",
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": max(1, min(int(days), 7)),
        }
        w = _http_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params))
        cur = w["current"]
        daily = w["daily"]
        return {
            "location": f"{g['name']}, {g.get('country', '')}",
            "now": {
                "temp_c": cur["temperature_2m"], "feels_like_c": cur["apparent_temperature"],
                "humidity_pct": cur["relative_humidity_2m"], "wind_kmh": cur["wind_speed_10m"],
                "precip_mm": cur["precipitation"], "conditions": WEATHER_CODES.get(cur["weather_code"], "?"),
            },
            "forecast": [
                {"date": daily["time"][i], "min_c": daily["temperature_2m_min"][i],
                 "max_c": daily["temperature_2m_max"][i],
                 "rain_chance_pct": daily["precipitation_probability_max"][i],
                 "conditions": WEATHER_CODES.get(daily["weather_code"][i], "?")}
                for i in range(len(daily["time"]))
            ],
        }

    def _t_calculate(self, expression: str) -> dict:
        return {"expression": expression, "result": safe_eval(expression)}

    def _t_remember_fact(self, key: str, value: str) -> str:
        self.memory.remember(key, value)
        return f"Opgeslagen: {key} = {value}"

    def _t_forget_fact(self, key: str) -> str:
        return "Vergeten." if self.memory.forget(key) else "Dat feit kende ik niet."

    def _t_notes(self, action: str, text: str = "", query: str = "", id: str = "") -> Any:
        if action == "add":
            if not text:
                raise ValueError("text is verplicht bij add")
            return self.memory.add_note(text)
        if action == "search":
            return self.memory.search_notes(query)
        if action == "delete":
            return "Verwijderd." if self.memory.delete_note(id) else "Notitie niet gevonden."
        raise ValueError(f"onbekende actie {action}")

    def _t_todos(self, action: str, text: str = "", id: str = "", include_done: bool = False) -> Any:
        if action == "add":
            if not text:
                raise ValueError("text is verplicht bij add")
            return self.memory.add_todo(text)
        if action == "list":
            return self.memory.todos(include_done)
        if action == "complete":
            return "Afgevinkt." if self.memory.complete_todo(id) else "Taak niet gevonden."
        raise ValueError(f"onbekende actie {action}")

    def _t_set_reminder(self, text: str, in_minutes: float | None = None, at: str | None = None) -> dict:
        if in_minutes is not None:
            due = time.time() + float(in_minutes) * 60
        elif at:
            when = dt.datetime.fromisoformat(at)
            if when.tzinfo is None:
                when = when.astimezone()
            due = when.timestamp()
        else:
            raise ValueError("geef in_minutes of at")
        rem = self.memory.add_reminder(text, due)
        return {**rem, "due_local": dt.datetime.fromtimestamp(due).isoformat(timespec="minutes")}

    def _t_list_reminders(self) -> list[dict]:
        return [
            {**r, "due_local": dt.datetime.fromtimestamp(r["due"]).isoformat(timespec="minutes")}
            for r in self.memory.pending_reminders()
        ]

    def _t_open_url(self, url: str) -> str:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        opened = webbrowser.open(url)
        return f"Geopend: {url}" if opened else f"Kon geen browser openen; link: {url}"

    def _t_system_status(self) -> dict:
        info: dict[str, Any] = {
            "os": f"{platform.system()} {platform.release()}",
            "machine": platform.machine(), "python": platform.python_version(),
            "cpu_count": os.cpu_count(),
        }
        total, used, free = shutil.disk_usage(os.path.expanduser("~"))
        info["disk"] = {"total_gb": round(total / 1e9, 1), "free_gb": round(free / 1e9, 1),
                        "used_pct": round(used / total * 100, 1)}
        try:
            import psutil  # optioneel
            vm = psutil.virtual_memory()
            info["cpu_pct"] = psutil.cpu_percent(interval=0.3)
            info["memory"] = {"total_gb": round(vm.total / 1e9, 1), "used_pct": vm.percent}
            info["uptime_h"] = round((time.time() - psutil.boot_time()) / 3600, 1)
            bat = psutil.sensors_battery()
            if bat:
                info["battery"] = {"pct": bat.percent, "charging": bat.power_plugged}
        except ImportError:
            if hasattr(os, "getloadavg"):
                info["load_avg"] = os.getloadavg()
        return info

    def _require_home(self):
        if self.home is None:
            raise RuntimeError("Smart home is niet beschikbaar.")
        return self.home

    def _t_home_devices(self) -> dict:
        home = self._require_home()
        if not home.configured:
            return {"backends": home.backends,
                    "hint": "Nog niets gekoppeld. Zie de README: 'python -m jarvis koppel-google' of Home Assistant instellen."}
        return home.summary()

    def _t_home_control(self, device: str, action: str, value: float | None = None) -> dict:
        return self._require_home().control(device, action, value)

    def _t_google_home_command(self, command: str) -> dict:
        return self._require_home().command(command)

    def _t_run_shell(self, command: str) -> dict:
        if not self.config.allow_shell:
            raise PermissionError("Shell-toegang is uitgeschakeld (JARVIS_ALLOW_SHELL=1 om aan te zetten).")
        if self.confirm is not None and not self.confirm(command):
            return {"declined": True, "message": "De gebruiker heeft dit commando geweigerd."}
        proc = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60)
        return {"exit_code": proc.returncode, "stdout": proc.stdout[-4000:], "stderr": proc.stderr[-2000:]}
