"""Tests zonder netwerk: tools, geheugen en de agentlus met een nep-client."""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from jarvis.brain import Jarvis
from jarvis.config import Config
from jarvis.memory import Memory
from jarvis.tools import ToolBox, safe_eval


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JARVIS_CAST", "0")
    monkeypatch.delenv("HOME_ASSISTANT_URL", raising=False)
    return Config()


def test_safe_eval():
    assert safe_eval("2+3*4") == 14
    assert safe_eval("2^10") == 1024
    assert round(safe_eval("sqrt(16) + pi"), 4) == 7.1416
    with pytest.raises(ValueError):
        safe_eval("__import__('os').system('ls')")


def test_memory_persists(tmp_path):
    m = Memory(tmp_path / "m.json")
    m.remember("Naam", "Xander")
    m.add_todo("boodschappen")
    m2 = Memory(tmp_path / "m.json")
    assert m2.facts() == {"naam": "Xander"}
    assert m2.todos()[0]["text"] == "boodschappen"


def test_reminders_fire_once(tmp_path):
    m = Memory(tmp_path / "m.json")
    m.add_reminder("thee", time.time() - 1)
    assert [r["text"] for r in m.pop_due_reminders()] == ["thee"]
    assert m.pop_due_reminders() == []


def test_toolbox(cfg):
    tb = ToolBox(cfg, Memory(cfg.data_dir / "m.json"))
    assert '"result": 6' in tb.run("calculate", {"expression": "1+2+3"})
    tb.run("notes", {"action": "add", "text": "wachtwoord wifi op koelkast"})
    assert "koelkast" in tb.run("notes", {"action": "search", "query": "wifi"})
    assert "run_shell" not in [d["name"] for d in tb.definitions]
    with pytest.raises(PermissionError):
        tb.run("run_shell", {"command": "ls"})


class FakeClient:
    """Speelt eerst een tool-aanroep af, daarna een tekstantwoord."""

    def __init__(self):
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            block = SimpleNamespace(type="tool_use", id="t1", name="calculate", input={"expression": "6*7"})
            return SimpleNamespace(stop_reason="tool_use", content=[block])
        result = kwargs["messages"][-1]["content"][0]
        assert result["type"] == "tool_result" and "42" in result["content"]
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Dat is 42, meesterbrein.")])


def test_agent_loop(cfg):
    client = FakeClient()
    j = Jarvis(cfg, client=client)
    tools_used = []
    assert j.ask("Wat is 6 keer 7?", on_tool=lambda n, a: tools_used.append(n)) == "Dat is 42, meesterbrein."
    assert tools_used == ["calculate"]
    first = client.calls[0]
    assert first["model"] == "claude-opus-5-5"
    assert any(t.get("name") == "web_search" for t in first["tools"])
    assert len(j.messages) == 4
