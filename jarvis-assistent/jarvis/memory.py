"""Persistent geheugen: feiten, notities, taken en herinneringen (JSON-bestand of Upstash Redis)."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any


def _empty() -> dict[str, Any]:
    return {"facts": {}, "notes": [], "todos": [], "reminders": []}


class Memory:
    """Bewaart alles in een JSON-bestand (op je eigen computer)."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self.data: dict[str, Any] = _empty()
        self.reload()

    def reload(self) -> None:
        if not self.path.exists():
            return
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            self.data = {**_empty(), **loaded}
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


class RedisMemory(Memory):
    """Bewaart alles in Upstash Redis (voor Vercel, waar geen vaste schijf is)."""

    KEY = "jarvis:memory"

    def __init__(self, url: str, token: str):
        self.url, self.token = url.rstrip("/"), token
        self._lock = threading.RLock()
        self.data = _empty()
        self.reload()

    def _request(self, method: str, path: str, body: bytes | None = None) -> Any:
        req = urllib.request.Request(self.url + path, data=body, method=method,
                                     headers={"Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")).get("result")

    def reload(self) -> None:
        raw = self._request("GET", f"/get/{self.KEY}")
        self.data = {**_empty(), **json.loads(raw)} if raw else _empty()

    def _save(self) -> None:
        self._request("POST", f"/set/{self.KEY}", json.dumps(self.data, ensure_ascii=False).encode("utf-8"))


def open_memory(data_dir: Path) -> Memory:
    """Kiest Redis als Vercel/Upstash is ingesteld, anders een bestand."""
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if url and token:
        return RedisMemory(url, token)
    return Memory(Path(data_dir) / "memory.json")
