"""Persistent geheugen: feiten, notities, taken en herinneringen in één JSON-bestand."""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any


class Memory:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self.data: dict[str, Any] = {"facts": {}, "notes": [], "todos": [], "reminders": []}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                self.data.update(loaded)
            except (json.JSONDecodeError, OSError):
                backup = self.path.with_suffix(".corrupt.json")
                self.path.replace(backup)

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    # --- feiten -------------------------------------------------------
    def remember(self, key: str, value: str) -> None:
        with self._lock:
            self.data["facts"][key.strip().lower()] = value
            self._save()

    def forget(self, key: str) -> bool:
        with self._lock:
            removed = self.data["facts"].pop(key.strip().lower(), None) is not None
            self._save()
            return removed

    def facts(self) -> dict[str, str]:
        return dict(self.data["facts"])

    # --- notities -----------------------------------------------------
    def add_note(self, text: str) -> dict:
        with self._lock:
            note = {"id": uuid.uuid4().hex[:6], "text": text, "created": time.time()}
            self.data["notes"].append(note)
            self._save()
            return note

    def search_notes(self, query: str = "") -> list[dict]:
        q = query.lower()
        return [n for n in self.data["notes"] if q in n["text"].lower()]

    def delete_note(self, note_id: str) -> bool:
        with self._lock:
            before = len(self.data["notes"])
            self.data["notes"] = [n for n in self.data["notes"] if n["id"] != note_id]
            self._save()
            return len(self.data["notes"]) < before

    # --- taken --------------------------------------------------------
    def add_todo(self, text: str) -> dict:
        with self._lock:
            todo = {"id": uuid.uuid4().hex[:6], "text": text, "done": False, "created": time.time()}
            self.data["todos"].append(todo)
            self._save()
            return todo

    def complete_todo(self, todo_id: str) -> bool:
        with self._lock:
            for t in self.data["todos"]:
                if t["id"] == todo_id:
                    t["done"] = True
                    self._save()
                    return True
            return False

    def todos(self, include_done: bool = False) -> list[dict]:
        return [t for t in self.data["todos"] if include_done or not t["done"]]

    # --- herinneringen ------------------------------------------------
    def add_reminder(self, text: str, due: float) -> dict:
        with self._lock:
            rem = {"id": uuid.uuid4().hex[:6], "text": text, "due": due, "fired": False}
            self.data["reminders"].append(rem)
            self._save()
            return rem

    def pending_reminders(self) -> list[dict]:
        return [r for r in self.data["reminders"] if not r["fired"]]

    def pop_due_reminders(self, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        with self._lock:
            due = [r for r in self.data["reminders"] if not r["fired"] and r["due"] <= now]
            for r in due:
                r["fired"] = True
            if due:
                self._save()
            return due
