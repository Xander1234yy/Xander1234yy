"""Startpunt: python -m jarvis [chat|voice|web|apparaten|koppel-google]."""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time

from .brain import Jarvis
from .config import Config

BOLD, DIM, RESET = "\033[1m", "\033[2m", "\033[0m"


def confirm_in_terminal(command: str) -> bool:
    answer = input(f"{DIM}Jarvis wil uitvoeren:{RESET} {command}\n  Toestaan? [j/N] ")
    return answer.strip().lower() in {"j", "ja", "y", "yes"}


def chat(jarvis: Jarvis) -> None:
    title = jarvis.config.user_title
    print(f"\n{BOLD}Jarvis{RESET}  {DIM}/reset wist het gesprek · /exit sluit af{RESET}\n")
    print(f"{BOLD}Jarvis{RESET}  Hoi {title}, waarmee kan ik helpen?\n")

    def reminder_loop():
        while True:
            for r in jarvis.due_reminders():
                print(f"\n{BOLD}Herinnering{RESET}  {r['text']}\n› ", end="", flush=True)
            time.sleep(10)

    threading.Thread(target=reminder_loop, daemon=True).start()
    while True:
        try:
            text = input("› ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{BOLD}Jarvis{RESET}  Tot later.")
            return
        if not text:
            continue
        if text in {"/exit", "/quit", "exit", "quit"}:
            print(f"{BOLD}Jarvis{RESET}  Tot later.")
            return
        if text == "/reset":
            jarvis.reset()
            print(f"{DIM}Gesprek gewist.{RESET}")
            continue
        reply = jarvis.ask(text, on_tool=lambda name, args: print(f"{DIM}  · {name}{RESET}"))
        print(f"{BOLD}Jarvis{RESET}  {reply}\n")


def list_devices(jarvis: Jarvis) -> None:
    home = jarvis.home
    for name, ok in home.backends.items():
        print(f"  {'●' if ok else '○'} {name.replace('_', ' ')}")
    devices = home.devices()
    if not devices:
        print(f"\n{DIM}Geen apparaten gevonden. Zie de README onder 'Google Home koppelen'.{RESET}")
    for room in sorted({d["room"] for d in devices}):
        print(f"\n{BOLD}{room}{RESET}")
        for d in (d for d in devices if d["room"] == room):
            print(f"  {'●' if d['on'] else '○'} {d['name']:<28} {DIM}{d['state']}  ({d['id']}){RESET}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jarvis", description="Je persoonlijke assistent.")
    parser.add_argument("mode", nargs="?", default="chat",
                        choices=["chat", "voice", "web", "apparaten", "koppel-google"],
                        help="chat (standaard), voice, web, apparaten (lijst smart home) of koppel-google")
    parser.add_argument("client_secret", nargs="?", help="koppel-google: pad naar client_secret.json")
    parser.add_argument("--no-wake-word", action="store_true", help="spraakmodus: luister zonder 'Jarvis'")
    parser.add_argument("--port", type=int, help="poort voor de webmodus")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("-q", "--query", help="stel één vraag en sluit af")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    config = Config()
    if args.port:
        config.port = args.port

    if args.mode == "koppel-google":
        from .home.assistant import GoogleAssistant
        if not args.client_secret:
            parser.error("geef het pad naar je client_secret.json mee")
        path = GoogleAssistant(config).link(args.client_secret)
        print(f"Gekoppeld. Token opgeslagen in {path}")
        return 0

    confirm = confirm_in_terminal if sys.stdin.isatty() and args.mode != "web" else (lambda _c: False)
    jarvis = Jarvis(config, confirm=confirm)

    if args.query:
        print(jarvis.ask(args.query))
    elif args.mode == "chat":
        chat(jarvis)
    elif args.mode == "apparaten":
        list_devices(jarvis)
    elif args.mode == "voice":
        from .voice import Voice
        Voice(jarvis, wake_word=not args.no_wake_word).run()
    else:
        from .web import serve
        serve(jarvis)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
