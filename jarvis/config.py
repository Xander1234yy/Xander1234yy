"""Configuratie voor JARVIS, in te stellen via omgevingsvariabelen."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "ja", "on"}


@dataclass
class Config:
    model: str = field(default_factory=lambda: os.environ.get("JARVIS_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.environ.get("JARVIS_EFFORT", "medium"))
    user_title: str = field(default_factory=lambda: os.environ.get("JARVIS_USER_TITLE", "meesterbrein"))
    language: str = field(default_factory=lambda: os.environ.get("JARVIS_LANGUAGE", "nl"))
    city: str = field(default_factory=lambda: os.environ.get("JARVIS_CITY", "Amsterdam"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("JARVIS_DATA_DIR", Path.home() / ".jarvis"))
    )
    web_search: bool = field(default_factory=lambda: _bool("JARVIS_WEB_SEARCH", True))
    allow_shell: bool = field(default_factory=lambda: _bool("JARVIS_ALLOW_SHELL", False))
    history_turns: int = field(default_factory=lambda: int(os.environ.get("JARVIS_HISTORY_TURNS", "20")))
    host: str = field(default_factory=lambda: os.environ.get("JARVIS_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("JARVIS_PORT", "8000")))

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
