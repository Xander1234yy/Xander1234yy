"""Startpunt: python -m jarvis [chat|voice|web]."""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import time

from .brain import Jarvis
from .config import Config

CYAN, DIM, RESET = "\033[96m", "\033[2m", "\033[0m"
BANNER = rf"""{CYAN}
     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝{RESET}
{DIM}  Just A Rather Very Intelligent System{RESET}
"""


def confirm_in_terminal(command: str) -> bool:
    answer = input(f"{DIM}JARVIS wil uitvoeren:{RESET} {command}\n  Toestaan? [j/N] ")
    return answer.strip().lower() in {"j", "ja", "y", "yes"}


def chat(jarvis: Jarvis) -> None:
    print(BANNER)
    title = jarvis.config.user_title
    print(f"{CYAN}JARVIS:{RESET} Goedendag, {title}. Waarmee kan ik u van dienst zijn?")
    print(f"{DIM}  (/reset wist het gesprek, /exit sluit af){RESET}\n")

    def reminder_loop():
        while True:
            for r in jarvis.due_reminders():
                print(f"\n{CYAN}⏰ JARVIS:{RESET} Herinnering, {title}: {r['text']}\n> ", end="", flush=True)
            time.sleep(10)

    threading.Thread(target=reminder_loop, daemon=True).start()
    while True:
        try:
            text = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{CYAN}JARVIS:{RESET} Tot ziens, {title}.")
            return
        if not text:
            continue
        if text in {"/exit", "/quit", "exit", "quit"}:
            print(f"{CYAN}JARVIS:{RESET} Tot ziens, {title}.")
            return
        if text == "/reset":
            jarvis.reset()
            print(f"{DIM}  Gesprek gewist.{RESET}")
            continue
        reply = jarvis.ask(text, on_tool=lambda name, args: print(f"{DIM}  ⚙ {name}{RESET}"))
        print(f"{CYAN}JARVIS:{RESET} {reply}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jarvis", description="Je persoonlijke AI-assistent.")
    parser.add_argument("mode", nargs="?", default="chat", choices=["chat", "voice", "web"],
                        help="chat (terminal, standaard), voice (microfoon) of web (HUD in browser)")
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
    confirm = confirm_in_terminal if sys.stdin.isatty() and args.mode != "web" else (lambda _c: False)
    jarvis = Jarvis(config, confirm=confirm)

    if args.query:
        print(jarvis.ask(args.query))
    elif args.mode == "chat":
        chat(jarvis)
    elif args.mode == "voice":
        from .voice import Voice
        Voice(jarvis, wake_word=not args.no_wake_word).run()
    else:
        from .web import serve
        serve(jarvis)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
