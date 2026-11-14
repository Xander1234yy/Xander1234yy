"""Het brein van JARVIS: een Claude-agentlus met tools, geheugen en webzoekfunctie."""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
from typing import Callable

import anthropic

from .config import Config
from .memory import Memory
from .tools import ToolBox

log = logging.getLogger("jarvis")

SYSTEM_PROMPT = """Je bent J.A.R.V.I.S. (Just A Rather Very Intelligent System), de persoonlijke AI-butler van de gebruiker.

Persoonlijkheid:
- Beleefd, kalm, droog-geestig en uiterst competent, als een Britse butler met een vleugje ironie.
- Spreek de gebruiker aan met "{title}".
- Antwoord in de taal van de gebruiker (standaard: {language_name}).
- Houd antwoorden kort en spreekbaar: meestal 1-3 zinnen, want je antwoorden worden vaak hardop voorgelezen. Gebruik geen markdown-tabellen, en alleen opsommingen als er echt om een lijst wordt gevraagd.

Werkwijze:
- Gebruik je tools proactief: tijd, weer, rekenen, notities, taken, herinneringen, websites openen, systeemstatus{extra_tools}.
- Reken nooit uit je hoofd; gebruik altijd de rekentool.
- Zoek actuele informatie (nieuws, sport, koersen, feiten na je kennisdatum) op het web en noem kort je bron.
- Als de gebruiker iets persoonlijks vertelt dat later nuttig is (naam, voorkeuren, verjaardagen, afspraken), sla het op met remember_fact.
- Als een tool faalt, leg kort uit wat er misging en stel een alternatief voor.
- Verzin nooit resultaten van tools."""

LANGUAGE_NAMES = {"nl": "Nederlands", "en": "English", "de": "Deutsch", "fr": "Français"}


class Jarvis:
    def __init__(self, config: Config | None = None, client: anthropic.Anthropic | None = None,
                 confirm: Callable[[str], bool] | None = None):
        self.config = config or Config()
        self.memory = Memory(self.config.data_dir / "memory.json")
        self.tools = ToolBox(self.config, self.memory, confirm=confirm)
        self.client = client or anthropic.Anthropic()
        self.messages: list[dict] = []
        self._lock = threading.Lock()

    # --- prompt-opbouw --------------------------------------------------------
    def _system(self) -> str:
        extra = ", shell-commando's" if self.config.allow_shell else ""
        if self.config.web_search:
            extra += " en het web doorzoeken"
        return SYSTEM_PROMPT.format(
            title=self.config.user_title,
            language_name=LANGUAGE_NAMES.get(self.config.language, self.config.language),
            extra_tools=extra,
        )

    def _context_block(self) -> str:
        now = dt.datetime.now().astimezone()
        lines = [f"Huidige lokale tijd: {now.strftime('%A %d %B %Y, %H:%M')} ({now.tzinfo})",
                 f"Standaardlocatie: {self.config.city}"]
        facts = self.memory.facts()
        if facts:
            lines.append("Bekende feiten over de gebruiker: " + json.dumps(facts, ensure_ascii=False))
        return "<context>\n" + "\n".join(lines) + "\n</context>"

    def _tool_list(self) -> list[dict]:
        tools = list(self.tools.definitions)
        if self.config.web_search:
            tools.append({"type": "web_search_20260209", "name": "web_search", "max_uses": 5})
        return tools

    def _trim_history(self) -> None:
        """Houd de laatste N gebruikersbeurten; knip alleen op een gewone gebruikersvraag."""
        starts = [i for i, m in enumerate(self.messages)
                  if m["role"] == "user" and isinstance(m["content"], list)
                  and any(isinstance(b, dict) and b.get("type") == "text" for b in m["content"])]
        if len(starts) > self.config.history_turns:
            self.messages = self.messages[starts[-self.config.history_turns]:]

    # --- hoofdlus ------------------------------------------------------------
    def ask(self, text: str, on_tool: Callable[[str, dict], None] | None = None) -> str:
        with self._lock:
            return self._ask(text, on_tool)

    def _ask(self, text: str, on_tool: Callable[[str, dict], None] | None) -> str:
        self._trim_history()
        self.messages.append({"role": "user", "content": [
            {"type": "text", "text": self._context_block()},
            {"type": "text", "text": text},
        ]})

        for _ in range(12):  # veiligheidsgrens op het aantal agentstappen
            try:
                response = self.client.beta.messages.create(
                    model=self.config.model,
                    max_tokens=16000,
                    system=self._system(),
                    tools=self._tool_list(),
                    messages=self.messages,
                    thinking={"type": "adaptive"},
                    output_config={"effort": self.config.effort},
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    cache_control={"type": "ephemeral"},
                )
            except anthropic.AuthenticationError:
                self.messages.pop()
                return ("Mijn excuses, ik heb geen geldige API-sleutel. "
                        "Stel ANTHROPIC_API_KEY in of log in met 'ant auth login'.")
            except anthropic.RateLimitError:
                self.messages.pop()
                return "Ik word even overspoeld met verzoeken. Probeer het over een momentje opnieuw."
            except anthropic.APIConnectionError:
                self.messages.pop()
                return "Ik kan mijn servers niet bereiken. Controleer de internetverbinding."
            except anthropic.APIStatusError as exc:
                self.messages.pop()
                log.exception("API-fout")
                return f"Er ging iets mis aan de serverkant ({exc.status_code})."

            self.messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "refusal":
                return "Daar kan ik u helaas niet mee helpen."
            if response.stop_reason == "pause_turn":
                continue
            if response.stop_reason != "tool_use":
                return self._text_of(response) or "Tot uw dienst."

            results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                if on_tool:
                    on_tool(block.name, block.input)
                try:
                    output = self.tools.run(block.name, block.input)
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
                except Exception as exc:  # tool-fouten gaan terug naar Claude
                    log.warning("Tool %s faalde: %s", block.name, exc)
                    results.append({"type": "tool_result", "tool_use_id": block.id,
                                    "content": f"Fout: {exc}", "is_error": True})
            self.messages.append({"role": "user", "content": results})

        return "Dit verzoek kostte te veel stappen; kunt u het anders formuleren?"

    @staticmethod
    def _text_of(response) -> str:
        return "".join(b.text for b in response.content if b.type == "text").strip()

    def reset(self) -> None:
        with self._lock:
            self.messages.clear()

    def due_reminders(self) -> list[dict]:
        return self.memory.pop_due_reminders()
